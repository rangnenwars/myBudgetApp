import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { loans, savingsGoals } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { autoPostMiddleware } from '../lib/autoPost';
import { getTotalsInRange, forEachTransactionBatch } from '../lib/queries';
import { localToday, addMonths } from '../lib/clock';
import { getFreeMoneyDay } from '../lib/freeMoneyDay';
import {
  computeMonthSummary,
  computeMonthlySeries,
  computeCategoryBreakdown,
  generateMonthRange,
  transactionsToCsvRows,
  CSV_HEADER,
  simulateDebtPayoff,
  computeGoalETA,
} from '../calculations';

const router = Router();
router.use(requireAuth, autoPostMiddleware);

const rangeQuery = z.object({
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(2000).max(2100),
  endMonth: z.coerce.number().int().min(1).max(12),
  endYear: z.coerce.number().int().min(2000).max(2100),
});

const breakdownQuery = rangeQuery.extend({ type: z.enum(['income', 'expense']) });
const debtQuery = z.object({
  strategy: z.enum(['snowball', 'avalanche']).default('snowball'),
  extraPerMonth: z.coerce.number().min(0).default(0),
});

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const q = rangeQuery.parse(req.query);
    const rows = await getTotalsInRange(req.userId!, q.startMonth, q.startYear, q.endMonth, q.endYear);
    res.json(computeMonthSummary(rows));
  })
);

router.get(
  '/monthly-series',
  asyncHandler(async (req, res) => {
    const q = rangeQuery.parse(req.query);
    const rows = await getTotalsInRange(req.userId!, q.startMonth, q.startYear, q.endMonth, q.endYear);
    const range = generateMonthRange(q.startMonth, q.startYear, q.endMonth, q.endYear);
    res.json(computeMonthlySeries(rows, range));
  })
);

router.get(
  '/category-breakdown',
  asyncHandler(async (req, res) => {
    const q = breakdownQuery.parse(req.query);
    const rows = await getTotalsInRange(req.userId!, q.startMonth, q.startYear, q.endMonth, q.endYear);
    res.json(computeCategoryBreakdown(rows, q.type));
  })
);

router.get(
  '/export.csv',
  asyncHandler(async (req, res) => {
    const q = rangeQuery.parse(req.query);
    const filename = `mybudget-${q.startYear}-${String(q.startMonth).padStart(2, '0')}_to_${q.endYear}-${String(q.endMonth).padStart(2, '0')}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Streamed 1,000 rows at a time, so a multi-year export never sits in memory whole.
    res.write(CSV_HEADER);
    await forEachTransactionBatch(req.userId!, q.startMonth, q.startYear, q.endMonth, q.endYear, (rows) => {
      res.write('\n' + transactionsToCsvRows(rows).join('\n'));
    });
    res.end();
  })
);

router.get(
  '/debt-payoff',
  requireFeature('loans'),
  asyncHandler(async (req, res) => {
    const q = debtQuery.parse(req.query);
    const userLoans = await db.select().from(loans).where(and(eq(loans.userId, req.userId!), eq(loans.is_active, true)));
    res.json(simulateDebtPayoff(userLoans, q.strategy, q.extraPerMonth));
  })
);

router.get(
  '/goal-eta',
  requireFeature('goals'),
  asyncHandler(async (req, res) => {
    const today = localToday();
    const start = addMonths(today.year, today.month, -2);
    const range = generateMonthRange(start.month, start.year, today.month, today.year);
    const rows = await getTotalsInRange(req.userId!, start.month, start.year, today.month, today.year);
    const series = computeMonthlySeries(rows, range);
    const avgMonthlySavings = series.length ? series.reduce((s, p) => s + p.net, 0) / series.length : 0;

    const userGoals = await db.select().from(savingsGoals).where(eq(savingsGoals.userId, req.userId!));
    const results = userGoals.map((g) => ({ goalId: g.id, name: g.name, ...computeGoalETA(g, avgMonthlySavings) }));
    res.json({ avgMonthlySavings, goals: results });
  })
);

router.get(
  '/free-money-day',
  asyncHandler(async (req, res) => {
    res.json(await getFreeMoneyDay(req.userId!));
  })
);

export default router;
