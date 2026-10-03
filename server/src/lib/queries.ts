import { and, eq, desc, gte, lt, sql, SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { transactions } from '../db/schema';
import { monthsDateRange } from './clock';
import type { TxnTotals } from '../calculations';

const rangeFilter = (userId: number, startMonth: number, startYear: number, endMonth: number, endYear: number): SQL => {
  const { from, toExclusive } = monthsDateRange(startYear, startMonth, endYear, endMonth);
  return and(eq(transactions.userId, userId), gte(transactions.date, from), lt(transactions.date, toExclusive))!;
};

/** All of a user's transactions within [start, end] months inclusive, newest first. Filtered in SQL on idx_transactions_user_date. */
export const getTransactionsInRange = async (userId: number, startMonth: number, startYear: number, endMonth: number, endYear: number) =>
  db
    .select()
    .from(transactions)
    .where(rangeFilter(userId, startMonth, startYear, endMonth, endYear))
    .orderBy(desc(transactions.date), desc(transactions.id));

/**
 * The same range, pre-summed by month, type and category in the database —
 * at most months × categories rows however many transactions there are. The
 * report calculations (computeMonthSummary, computeCategoryBreakdown,
 * computeMonthlySeries) accept these rows directly, so reports never load
 * individual transactions into memory.
 */
export const getTotalsInRange = async (
  userId: number,
  startMonth: number,
  startYear: number,
  endMonth: number,
  endYear: number
): Promise<TxnTotals[]> => {
  const rows = await db
    .select({
      year: transactions.year,
      month: transactions.month,
      type: transactions.type,
      category: transactions.category,
      amount: sql<string>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(rangeFilter(userId, startMonth, startYear, endMonth, endYear))
    .groupBy(transactions.year, transactions.month, transactions.type, transactions.category);
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
};

const EXPORT_BATCH = 1000;

/**
 * Calls `onBatch` with the range's transactions, newest first, 1,000 at a
 * time (keyset pagination on date, id) so an export of years of history is
 * never held in memory all at once.
 */
export const forEachTransactionBatch = async (
  userId: number,
  startMonth: number,
  startYear: number,
  endMonth: number,
  endYear: number,
  onBatch: (rows: (typeof transactions.$inferSelect)[]) => void | Promise<void>
) => {
  let cursor: { date: string; id: number } | null = null;
  for (;;) {
    const conditions: SQL[] = [rangeFilter(userId, startMonth, startYear, endMonth, endYear)];
    if (cursor) conditions.push(sql`(${transactions.date}, ${transactions.id}) < (${cursor.date}::date, ${cursor.id})`);
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(EXPORT_BATCH);
    if (rows.length === 0) return;
    await onBatch(rows);
    if (rows.length < EXPORT_BATCH) return;
    const last = rows[rows.length - 1];
    cursor = { date: last.date, id: last.id };
  }
};
