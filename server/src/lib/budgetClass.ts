import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { transactions, users } from '../db/schema';
import { classifyLocal } from '../calculations';
import { localToday, addMonths, monthsDateRange } from './clock';

/**
 * Recomputes budget class from a 3-month rolling average of expenses and
 * persists it on the user row. Server-side per the original spec — the
 * client-side `classifyLocal` estimate was only ever a placeholder for
 * having no server (see docs/PRO_FEATURES_DESIGN.md "Known deviations").
 */
export const recomputeBudgetClass = async (userId: number): Promise<string> => {
  const today = localToday();
  const start = addMonths(today.year, today.month, -2);
  const { from, toExclusive } = monthsDateRange(start.year, start.month, today.year, today.month);

  // One query for all three months (was one per month), on the date index.
  const perMonth = await db
    .select({ total: sql<string>`sum(${transactions.amount})` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), eq(transactions.type, 'expense'), gte(transactions.date, from), lt(transactions.date, toExclusive)))
    .groupBy(sql`date_trunc('month', ${transactions.date})`);

  // Months with no expenses don't count toward the average.
  const totals = perMonth.map((r) => Number(r.total)).filter((t) => t > 0);
  const avg = totals.length > 0 ? totals.reduce((s, t) => s + t, 0) / totals.length : 0;
  const budgetClass = classifyLocal(avg);
  await db.update(users).set({ budgetClass, updatedAt: new Date() }).where(eq(users.id, userId));
  return budgetClass;
};
