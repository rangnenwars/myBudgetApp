import { Router } from 'express';
import { z } from 'zod';
import { and, eq, isNull, or, sql, gte, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { budgets, categories, transactions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { autoPostMiddleware } from '../lib/autoPost';
import { badRequest, notFound } from '../lib/errors';
import { money } from '../lib/validation';
import { localToday, monthsDateRange } from '../lib/clock';

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
