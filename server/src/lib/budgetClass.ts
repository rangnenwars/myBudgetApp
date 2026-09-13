import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { transactions, users } from '../db/schema';
import { classifyLocal } from '../calculations';

/**
 * Recomputes budget class from a 3-month rolling average of expenses and
 * persists it on the user row. Server-side per the original spec — the
 * client-side `classifyLocal` estimate was only ever a placeholder for
 * having no server (see docs/PRO_FEATURES_DESIGN.md "Known deviations").
 */
export const recomputeBudgetClass = async (userId: number): Promise<string> => {
  const now = new Date();
  let total = 0;
  let months = 0;

  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    const [row] = await db
      .select({ total: sql<string | null>`sum(${transactions.amount})` })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.type, 'expense'), eq(transactions.month, month), eq(transactions.year, year)));

    const monthTotal = row?.total ? Number(row.total) : 0;
    if (monthTotal > 0) {
      total += monthTotal;
      months++;
    }
  }

  const avg = months > 0 ? total / months : 0;
  const budgetClass = classifyLocal(avg);
  await db.update(users).set({ budgetClass, updatedAt: new Date() }).where(eq(users.id, userId));
  return budgetClass;
};
