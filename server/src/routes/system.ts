import { Router } from 'express';
import { count, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { users, transactions, loans, investments, savingsGoals, categories } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireSystemManager } from '../middleware/requireSystemManager';

const router = Router();
router.use(requireAuth, requireSystemManager);

// Product-planning assumption, not a billed rate — see docs/DATABASE_DESIGN.md
// §8. There is no real payment processor wired up (docs/README.md "Known
// deviations"), so estimatedAnnualRevenueInr is always 0 today; this route
// exists so that stays visible as a number, not a silent gap.
const COST_PER_USER_PER_YEAR_INR = 100;
const ROLES = ['user', 'admin', 'support', 'system_manager'] as const;
const TIERS = ['standard', 'pro'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

// Every query below is a COUNT — this route never selects a row of
// transactions/loans/investments/goals, only how many exist. Same
// no-financial-disclosure invariant as /api/v1/admin/users.
router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const last30 = new Date(now.getTime() - 30 * DAY_MS);
    const last7 = new Date(now.getTime() - 7 * DAY_MS);

    const [[{ total }], [{ active }], [{ inactive }], [{ signups30 }], [{ loggedIn30 }], [{ loggedIn7 }]] = await Promise.all([
      db.select({ total: count() }).from(users),
      db.select({ active: count() }).from(users).where(eq(users.isActive, true)),
      db.select({ inactive: count() }).from(users).where(eq(users.isActive, false)),
      db.select({ signups30: count() }).from(users).where(gte(users.createdAt, last30)),
      db.select({ loggedIn30: count() }).from(users).where(gte(users.lastLoginAt, last30)),
      db.select({ loggedIn7: count() }).from(users).where(gte(users.lastLoginAt, last7)),
    ]);

    const roleRows = await db.select({ role: users.role, n: count() }).from(users).groupBy(users.role);
    const byRole = Object.fromEntries(ROLES.map((r) => [r, roleRows.find((row) => row.role === r)?.n ?? 0]));

    const tierRows = await db.select({ tier: users.tier, n: count() }).from(users).groupBy(users.tier);
    const byTier = Object.fromEntries(TIERS.map((t) => [t, tierRows.find((row) => row.tier === t)?.n ?? 0]));

    const [[{ txCount }], [{ loanCount }], [{ investmentCount }], [{ goalCount }], [{ customCategoryCount }]] = await Promise.all([
      db.select({ txCount: count() }).from(transactions),
      db.select({ loanCount: count() }).from(loans),
      db.select({ investmentCount: count() }).from(investments),
      db.select({ goalCount: count() }).from(savingsGoals),
      db.select({ customCategoryCount: count() }).from(categories).where(isNotNull(categories.userId)),
    ]);

    const proUsers = byTier.pro;
    const estimatedAnnualCostInr = active * COST_PER_USER_PER_YEAR_INR;
    const estimatedAnnualRevenueInr = 0; // no real billing — see comment above

    res.json({
      users: { total, active, inactive, byRole, byTier },
      signups: { last30Days: signups30 },
      engagement: { loggedInLast30Days: loggedIn30, loggedInLast7Days: loggedIn7 },
      usage: { transactions: txCount, loans: loanCount, investments: investmentCount, goals: goalCount, customCategories: customCategoryCount },
      finance: {
        costPerUserPerYearInr: COST_PER_USER_PER_YEAR_INR,
        estimatedAnnualCostInr,
        proUsers,
        estimatedAnnualRevenueInr,
        estimatedAnnualMarginInr: estimatedAnnualRevenueInr - estimatedAnnualCostInr,
        revenueNote: 'No real billing wired up yet — Pro is a test-mode toggle (docs/README.md).',
      },
    });
  })
);

export default router;
