import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { transactions } from '../db/schema';
import { generateMonthRange, MonthKey } from '../calculations';

/** All of a user's transactions falling within [startMonth/startYear, endMonth/endYear], inclusive. */
export const getTransactionsInRange = async (
  userId: number,
  startMonth: number,
  startYear: number,
  endMonth: number,
  endYear: number
) => {
  const wanted = new Set<string>(generateMonthRange(startMonth, startYear, endMonth, endYear).map((p: MonthKey) => `${p.year}-${p.month}`));
  const rows = await db.select().from(transactions).where(eq(transactions.userId, userId)).orderBy(desc(transactions.date), desc(transactions.id));
  return rows.filter((r) => wanted.has(`${r.year}-${r.month}`));
};
