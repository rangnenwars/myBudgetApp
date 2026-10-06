import { and, desc, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, freeMoneySnapshots, loans, recurringTransactions } from '../db/schema';
import { addMonths, localToday } from './clock';
import { getTotalsInRange } from './queries';
import { computeFreeMoneyDay, monthlyEquivalent } from '../calculations';

export interface Commitment {
  kind: 'loan' | 'repeating';
  label: string;
  /** Monthly amount. */
  amount: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Monday of the week containing the YYYY-MM-DD date. */
export const weekStartOf = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/**
 * Income used for the calculation: the user's repeating income entries if they
 * have any (what they've told the app to expect), otherwise their average over
 * the last three full months.
 */
const monthlyIncome = async (userId: number, repeating: number, today: { year: number; month: number }) => {
  if (repeating > 0) return { amount: repeating, source: 'repeating' as const };
  const start = addMonths(today.year, today.month, -3);
  const end = addMonths(today.year, today.month, -1);
  const rows = await getTotalsInRange(userId, start.month, start.year, end.month, end.year);
  const byMonth = new Map<string, number>();
  for (const r of rows) if (r.type === 'income') byMonth.set(`${r.year}-${r.month}`, (byMonth.get(`${r.year}-${r.month}`) ?? 0) + r.amount);
  const total = [...byMonth.values()].reduce((s, v) => s + v, 0);
  return { amount: byMonth.size ? total / byMonth.size : 0, source: 'average' as const };
};

export const getFreeMoneyDay = async (userId: number) => {
  const today = localToday();
  const daysInMonth = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();

  const rules = await db
    .select({ rule: recurringTransactions, label: categories.label })
    .from(recurringTransactions)
    .innerJoin(categories, eq(categories.key, recurringTransactions.category))
    .where(eq(recurringTransactions.userId, userId));
  const activeLoans = await db
    .select()
    .from(loans)
    .where(and(eq(loans.userId, userId), eq(loans.is_active, true), gt(loans.outstanding, 0)));

  const repeatingIncome = rules
    .filter((r) => r.rule.type === 'income')
    .reduce((s, r) => s + monthlyEquivalent(r.rule.amount, r.rule.frequency), 0);
  const income = await monthlyIncome(userId, repeatingIncome, today);

  const items: Commitment[] = [
    ...activeLoans.map((l) => ({ kind: 'loan' as const, label: l.name, amount: Math.min(l.emi, l.outstanding) })),
    ...rules
      .filter((r) => r.rule.type === 'expense')
      .map((r) => ({ kind: 'repeating' as const, label: r.rule.note?.trim() || r.label, amount: monthlyEquivalent(r.rule.amount, r.rule.frequency) })),
  ].sort((a, b) => b.amount - a.amount);
  const committed = items.reduce((s, i) => s + i.amount, 0);

  const result = computeFreeMoneyDay(income.amount, committed, daysInMonth);

  // This week's first reading is kept, so next week can say how the day moved.
  const weekStart = weekStartOf(today.iso);
  let previous: { weekStart: string; day: number } | null = null;
  let daysEarlier: number | null = null;
  if (result.status !== 'no_income') {
    await db.insert(freeMoneySnapshots).values({ userId, weekStart, income: income.amount, committed }).onConflictDoNothing();
    const [prev] = await db
      .select()
      .from(freeMoneySnapshots)
      .where(and(eq(freeMoneySnapshots.userId, userId), lt(freeMoneySnapshots.weekStart, weekStart)))
      .orderBy(desc(freeMoneySnapshots.weekStart))
      .limit(1);
    if (prev) {
      // Last week's share, laid over this month's length, so the two days are comparable.
      const before = computeFreeMoneyDay(prev.income, prev.committed, daysInMonth);
      if (before.day != null && result.day != null) {
        previous = { weekStart: prev.weekStart, day: before.day };
        daysEarlier = before.day - result.day;
      }
    }
  }

  return {
    year: today.year,
    month: today.month,
    daysInMonth,
    income: income.amount,
    incomeSource: income.source,
    committed,
    items,
    ...result,
    freeDate: result.day != null && result.day > 0 && result.status === 'ok' ? `${today.year}-${pad(today.month)}-${pad(result.day)}` : null,
    previous,
    daysEarlier,
    loans: activeLoans.map((l) => ({ id: l.id, name: l.name, emi: l.emi, outstanding: l.outstanding, interest_rate: l.interest_rate })),
  };
};
