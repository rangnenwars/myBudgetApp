import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { categories, freeMoneySnapshots, loans, recurringTransactions, transactions } from '../db/schema';
import { addMonths, localToday } from './clock';
import { getTotalsInRange } from './queries';
import { hasFeature } from './features';
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

export const INCOME_MONTHS = 3;

/**
 * Income used for the calculation, from what the user has told the app:
 * 1. the average of the last 3 full months, counting only months since the
 *    user's first entry — a tracked month with no income counts as ₹0, so an
 *    irregular earner isn't shown a month's income they didn't get. Repeating
 *    income is already in these months once it has posted;
 * 2. otherwise (no full month tracked yet, or nothing earned in it) their
 *    repeating income entries;
 * 3. otherwise what they have logged this month so far, so a brand-new account
 *    with a salary entered today still gets an answer.
 */
const monthlyIncome = async (userId: number, repeating: number, today: { year: number; month: number }) => {
  const [first] = await db
    .select({ year: transactions.year, month: transactions.month })
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(asc(transactions.year), asc(transactions.month))
    .limit(1);
  const firstIndex = first ? first.year * 12 + first.month : Infinity;
  const start = addMonths(today.year, today.month, -INCOME_MONTHS);
  const end = addMonths(today.year, today.month, -1);
  const tracked = Math.min(INCOME_MONTHS, Math.max(0, end.year * 12 + end.month - Math.max(firstIndex, start.year * 12 + start.month) + 1));
  if (tracked > 0) {
    const rows = await getTotalsInRange(userId, start.month, start.year, end.month, end.year);
    const earned = rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
    if (earned > 0) return { amount: earned / tracked, source: 'average' as const };
  }

  if (repeating > 0) return { amount: repeating, source: 'repeating' as const };

  const thisMonth = await getTotalsInRange(userId, today.month, today.year, today.month, today.year);
  const soFar = thisMonth.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  return { amount: soFar, source: soFar > 0 ? ('this_month' as const) : ('average' as const) };
};

export const getFreeMoneyDay = async (userId: number) => {
  const today = localToday();
  const daysInMonth = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();

  const rules = await db
    .select({ rule: recurringTransactions, label: categories.label })
    .from(recurringTransactions)
    .innerJoin(categories, eq(categories.key, recurringTransactions.category))
    .where(eq(recurringTransactions.userId, userId));
  const loansOn = await hasFeature(userId, 'loans');
  const userLoans = await db
    .select()
    .from(loans)
    .where(and(eq(loans.userId, userId), eq(loans.is_active, true), gt(loans.outstanding, 0)));
  // With Loans switched off, EMIs that are still posted as expenses every
  // month (lib/loanEmiExpenses.ts) are still paid, so they still count — but
  // unnamed, and not offered for a part payment, since the user can't open them.
  const activeLoans = loansOn ? userLoans : [];
  const countedLoans = loansOn ? userLoans : userLoans.filter((l) => l.counts_as_expense);

  const repeatingIncome = rules
    .filter((r) => r.rule.type === 'income')
    .reduce((s, r) => s + monthlyEquivalent(r.rule.amount, r.rule.frequency), 0);
  const income = await monthlyIncome(userId, repeatingIncome, today);

  const items: Commitment[] = [
    ...countedLoans.map((l) => ({ kind: 'loan' as const, label: loansOn ? l.name : 'Loan EMI', amount: Math.min(l.emi, l.outstanding) })),
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
