import { Router } from 'express';
import { z } from 'zod';
import { and, eq, inArray, isNull, or, sql, gte, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { budgets, categories, monthlyBudgets, transactions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { autoPostMiddleware } from '../lib/autoPost';
import { badRequest, notFound } from '../lib/errors';
import { money } from '../lib/validation';
import { addMonths, localToday, monthsDateRange } from '../lib/clock';
import { getTotalsInRange } from '../lib/queries';
import { computeOverallBudget, countsTowardBudget } from '../calculations';

// Per-category monthly spending limits. GET returns each limit with what has
// been spent against it in a month, plus an ok/warning/over status the app
// uses for alerts. The EMI/recurring middleware runs first so "spent"
// includes this month's automatic entries.
const router = Router();
router.use(requireAuth, autoPostMiddleware);

export const WARNING_RATIO = 0.8;

const monthQuery = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

const putSchema = z.object({ monthly_limit: money() });

const overallSchema = z.object({ amount: money(), include_commitments: z.boolean().optional() });

const statusFor = (ratio: number): 'ok' | 'warning' | 'over' => (ratio >= 1 ? 'over' : ratio >= WARNING_RATIO ? 'warning' : 'ok');

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = monthQuery.parse(req.query);
    const today = localToday();
    const month = q.month ?? today.month;
    const year = q.year ?? today.year;
    const range = monthsDateRange(year, month);

    // One query: every limit, left-joined to that month's expense total for its category.
    const rows = await db
      .select({
        category: budgets.categoryKey,
        monthly_limit: budgets.monthlyLimit,
        spent: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(budgets)
      .leftJoin(
        transactions,
        and(
          eq(transactions.userId, budgets.userId),
          eq(transactions.category, budgets.categoryKey),
          eq(transactions.type, 'expense'),
          gte(transactions.date, range.from),
          lt(transactions.date, range.toExclusive)
        )
      )
      .where(eq(budgets.userId, req.userId!))
      .groupBy(budgets.id);

    const result = rows
      .map((r) => {
        const spent = Number(r.spent);
        const ratio = spent / r.monthly_limit;
        return { category: r.category, monthly_limit: r.monthly_limit, spent, ratio: Math.round(ratio * 1000) / 1000, status: statusFor(ratio) };
      })
      .sort((a, b) => b.ratio - a.ratio);
    res.json(result);
  })
);

// The one overall monthly budget (registered before /:categoryKey so
// "overall" is never read as a category). GET also returns a suggested
// amount — average counted spending over the last 3 full months — so the
// app can offer it before a budget exists. No carry-over between months.
router.get(
  '/overall',
  asyncHandler(async (req, res) => {
    const q = monthQuery.parse(req.query);
    const today = localToday();
    const month = q.month ?? today.month;
    const year = q.year ?? today.year;
    const userId = req.userId!;

    const [budget] = await db.select().from(monthlyBudgets).where(eq(monthlyBudgets.userId, userId));
    const includeCommitments = budget?.includeCommitments ?? false;

    const start = addMonths(year, month, -3);
    const totals = (await getTotalsInRange(userId, start.month, start.year, month, year)).filter((t) => t.type === 'expense');
    const keys = [...new Set(totals.map((t) => t.category))];
    const groups = new Map(
      keys.length ? (await db.select({ key: categories.key, group: categories.group }).from(categories).where(inArray(categories.key, keys))).map((c) => [c.key, c.group]) : []
    );
    const counted = totals.filter((t) => countsTowardBudget(groups.get(t.category) ?? '', includeCommitments));

    const spent = counted.filter((t) => t.month === month && t.year === year).reduce((s, t) => s + t.amount, 0);
    const pastByMonth = new Map<string, number>();
    for (const t of counted) {
      if (t.month === month && t.year === year) continue;
      const k = `${t.year}-${t.month}`;
      pastByMonth.set(k, (pastByMonth.get(k) ?? 0) + t.amount);
    }
    const pastTotal = [...pastByMonth.values()].reduce((s, v) => s + v, 0);
    const suggested = pastByMonth.size ? Math.round(pastTotal / pastByMonth.size / 100) * 100 || null : null;

    // Only limits on categories that count toward the total are "set aside" from it.
    const limits = await db
      .select({ limit: budgets.monthlyLimit, group: categories.group })
      .from(budgets)
      .innerJoin(categories, eq(categories.key, budgets.categoryKey))
      .where(eq(budgets.userId, userId));
    const allocated = limits.filter((l) => countsTowardBudget(l.group, includeCommitments)).reduce((s, l) => s + l.limit, 0);

    const isCurrent = year === today.year && month === today.month;
    const isPast = year * 12 + month < today.year * 12 + today.month;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const progress = budget ? computeOverallBudget(budget.amount, spent, isCurrent ? today.day : isPast ? null : 1, daysInMonth) : null;

    res.json({
      month,
      year,
      amount: budget?.amount ?? null,
      include_commitments: includeCommitments,
      spent: Math.round(spent * 100) / 100,
      allocated,
      suggested,
      left: progress ? Math.round(progress.left * 100) / 100 : null,
      ratio: progress?.ratio ?? null,
      status: progress?.status ?? null,
      days_left: progress?.daysLeft ?? null,
      per_day: progress?.perDay ?? null,
    });
  })
);

router.put(
  '/overall',
  asyncHandler(async (req, res) => {
    const body = overallSchema.parse(req.body);
    const values = { amount: body.amount, includeCommitments: body.include_commitments ?? false, updatedAt: new Date() };
    const [row] = await db
      .insert(monthlyBudgets)
      .values({ userId: req.userId!, ...values })
      .onConflictDoUpdate({ target: monthlyBudgets.userId, set: values })
      .returning();
    res.json({ amount: row.amount, include_commitments: row.includeCommitments });
  })
);

router.delete(
  '/overall',
  asyncHandler(async (req, res) => {
    const [deleted] = await db.delete(monthlyBudgets).where(eq(monthlyBudgets.userId, req.userId!)).returning({ userId: monthlyBudgets.userId });
    if (!deleted) throw notFound('No monthly budget is set.');
    res.status(204).send();
  })
);

// Sets (creates or replaces) the limit for one expense category.
router.put(
  '/:categoryKey',
  asyncHandler(async (req, res) => {
    const body = putSchema.parse(req.body);
    const categoryKey = req.params.categoryKey;

    const [category] = await db
      .select({ type: categories.type })
      .from(categories)
      .where(and(eq(categories.key, categoryKey), or(isNull(categories.userId), eq(categories.userId, req.userId!))));
    if (!category) throw badRequest('Invalid category.');
    if (category.type !== 'expense') throw badRequest('Budgets can only be set on expense categories.');

    const [row] = await db
      .insert(budgets)
      .values({ userId: req.userId!, categoryKey, monthlyLimit: body.monthly_limit })
      .onConflictDoUpdate({ target: [budgets.userId, budgets.categoryKey], set: { monthlyLimit: body.monthly_limit } })
      .returning();
    res.json({ category: row.categoryKey, monthly_limit: row.monthlyLimit });
  })
);

router.delete(
  '/:categoryKey',
  asyncHandler(async (req, res) => {
    const [deleted] = await db
      .delete(budgets)
      .where(and(eq(budgets.userId, req.userId!), eq(budgets.categoryKey, req.params.categoryKey)))
      .returning({ id: budgets.id });
    if (!deleted) throw notFound('Budget not found.');
    res.status(204).send();
  })
);

export default router;
