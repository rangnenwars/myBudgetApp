import { Router } from 'express';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client';
import { investments, savingsGoals, loans, netWorthSnapshots } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { computeNetWorth } from '../calculations';

const router = Router();
router.use(requireAuth);

router.post(
  '/snapshot',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const [userInvestments, userGoals, userLoans] = await Promise.all([
      db.select().from(investments).where(eq(investments.userId, userId)),
      db.select().from(savingsGoals).where(eq(savingsGoals.userId, userId)),
      db.select().from(loans).where(eq(loans.userId, userId)),
    ]);

    const netWorth = computeNetWorth(userInvestments, userGoals, userLoans);
    const now = new Date();

    const [row] = await db
      .insert(netWorthSnapshots)
      .values({ userId, month: now.getMonth() + 1, year: now.getFullYear(), netWorth })
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
