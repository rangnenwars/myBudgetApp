import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client';
import { investments, savingsGoals, loans, netWorthSnapshots, accounts } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { computeNetWorth } from '../calculations';
import { localToday } from '../lib/clock';
import { getUserFeatures } from '../lib/features';

const router = Router();
router.use(requireAuth);

router.post(
  '/snapshot',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    // A feature that's switched off for the user doesn't count: net worth
    // only adds up what they can see. Its data is kept and counts again once
    // it's back on.
    const on = new Set(await getUserFeatures(userId));
    const [userInvestments, userGoals, userLoans, userAccounts] = await Promise.all([
      on.has('investments') ? db.select().from(investments).where(eq(investments.userId, userId)) : [],
      on.has('goals') ? db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)) : [],
      on.has('loans') ? db.select().from(loans).where(eq(loans.userId, userId)) : [],
      db.select().from(accounts).where(eq(accounts.userId, userId)),
    ]);

    const netWorth = computeNetWorth(userInvestments, userGoals, userLoans, userAccounts);
    const today = localToday();

    const [row] = await db
      .insert(netWorthSnapshots)
      .values({ userId, month: today.month, year: today.year, netWorth })
      .onConflictDoUpdate({
        target: [netWorthSnapshots.userId, netWorthSnapshots.year, netWorthSnapshots.month],
        set: { netWorth, recordedAt: new Date() },
      })
      .returning();

    res.json(row);
  })
);

router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({ month: netWorthSnapshots.month, year: netWorthSnapshots.year, netWorth: netWorthSnapshots.netWorth })
      .from(netWorthSnapshots)
      .where(eq(netWorthSnapshots.userId, req.userId!))
      .orderBy(asc(netWorthSnapshots.year), asc(netWorthSnapshots.month));
    res.json(rows);
  })
);

export default router;
