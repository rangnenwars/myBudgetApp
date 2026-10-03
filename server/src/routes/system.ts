import { Router } from 'express';
import { sql, SQL } from 'drizzle-orm';
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

    // Two queries in all (was 13): every user count in one pass over users
    // with FILTER, and the usage counts as scalar subqueries in another.
    const n = (cond: SQL) => sql<number>`count(*) filter (where ${cond})::int`;
    const [u] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: n(sql`${users.isActive}`),
        inactive: n(sql`not ${users.isActive}`),
        signups30: n(sql`${users.createdAt} >= ${last30}`),
        loggedIn30: n(sql`${users.lastLoginAt} >= ${last30}`),
        loggedIn7: n(sql`${users.lastLoginAt} >= ${last7}`),
        role_user: n(sql`${users.role} = 'user'`),
        role_admin: n(sql`${users.role} = 'admin'`),
        role_support: n(sql`${users.role} = 'support'`),
        role_system_manager: n(sql`${users.role} = 'system_manager'`),
        tier_standard: n(sql`${users.tier} = 'standard'`),
        tier_pro: n(sql`${users.tier} = 'pro'`),
      })
      .from(users);
    const { total, active, inactive, signups30, loggedIn30, loggedIn7 } = u;
    const byRole = Object.fromEntries(ROLES.map((r) => [r, u[`role_${r}` as keyof typeof u]]));
    const byTier = Object.fromEntries(TIERS.map((t) => [t, u[`tier_${t}` as keyof typeof u]]));

    const countOf = (table: typeof transactions | typeof loans | typeof investments | typeof savingsGoals) => sql<number>`(select count(*)::int from ${table})`;
    const [{ txCount, loanCount, investmentCount, goalCount, customCategoryCount }] = await db.execute<{
      txCount: number;
      loanCount: number;
      investmentCount: number;
      goalCount: number;
      customCategoryCount: number;
    }>(sql`select ${countOf(transactions)} as "txCount", ${countOf(loans)} as "loanCount", ${countOf(investments)} as "investmentCount",
      ${countOf(savingsGoals)} as "goalCount", (select count(*)::int from ${categories} where ${categories.userId} is not null) as "customCategoryCount"`).then((r) => r.rows);

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
