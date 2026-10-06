import { and, eq, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { recurringTransactions, transactions } from '../db/schema';
import { recomputeBudgetClass } from './budgetClass';
import { MAX_CATCH_UP_MONTHS, monthStart } from './loanEmiExpenses';
import { localToday } from './clock';

// A repeating rule posts its amount again every month, quarter or year after
// the user's original entry, on the rule's day_of_month. Same lazy approach
// as loan EMIs: anything due is posted the next time the user's data is read,
// so nothing needs a background job. `posted_through` (first day of the last
// period posted) records how far posting has got, `next_due` is the date the
// next entry falls on, and the rule rows are locked while posting so parallel
// requests can't double-post.

export type RepeatFrequency = 'monthly' | 'quarterly' | 'yearly';

export const FREQUENCY_MONTHS: Record<RepeatFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

const pad = (n: number) => String(n).padStart(2, '0');

const addMonths = (year: number, month: number, n: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

/** The posting date for `day` in the given month, falling back to the month's last day (31 → 30 Apr, 28/29 Feb). */
export const postingDate = (year: number, month: number, day: number): string => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, lastDay))}`;
};

/** When the entry after the period starting at `periodStart` (YYYY-MM-01) is due. */
export const nextDueAfter = (periodStart: string, frequency: RepeatFrequency, day: number): string => {
  const [y, m] = periodStart.split('-').map(Number);
  const next = addMonths(y, m, FREQUENCY_MONTHS[frequency]);
  return postingDate(next.year, next.month, day);
};

/** Rule fields for a new repeat of an entry dated `entryDate`: it repeats on that entry's day of the month. */
export const ruleScheduleFor = (entryDate: string, frequency: RepeatFrequency) => {
  const [y, m, d] = entryDate.split('-').map(Number);
  const postedThrough = monthStart(y, m);
  return { frequency, day_of_month: d, posted_through: postedThrough, next_due: nextDueAfter(postedThrough, frequency, d) };
};

// Loan EMIs come from the loan itself (lib/loanEmiExpenses.ts). A repeating
// Loan EMI entry would be a second copy of the same payment — counted twice
// in spending and in the free-money day — so it can't be created.
export const NO_REPEAT_CATEGORIES = new Set(['loan_emi']);
export const NO_REPEAT_MESSAGE = "A Loan EMI can't be set to repeat. Add the loan under Loans instead; its EMI is added every month automatically.";

const todayLocal = (now: Date): string => localToday(now).iso;

/** Posts any due entries for the user's repeating rules. Returns how many transactions were created. */
/** Rules of the user with an entry due today or earlier. */
export const rulesDueFilter = (userId: number, now: Date = new Date()) =>
  and(eq(recurringTransactions.userId, userId), lte(recurringTransactions.next_due, todayLocal(now)))!;

export const postDueRecurring = async (userId: number, now: Date = new Date(), knownDue = false): Promise<number> => {
  const today = todayLocal(now);
  const dueFilter = rulesDueFilter(userId, now);

  if (!knownDue) {
    const [pending] = await db.select({ id: recurringTransactions.id }).from(recurringTransactions).where(dueFilter).limit(1);
    if (!pending) return 0;
  }

  const posted = await db.transaction(async (tx) => {
    // Re-selected under a row lock: a concurrent request that got here first
    // has already advanced next_due, so its rules no longer match.
    const due = await tx.select().from(recurringTransactions).where(dueFilter).for('update');
    let count = 0;
    for (const rule of due) {
      const frequency = rule.frequency as RepeatFrequency;
      const step = FREQUENCY_MONTHS[frequency];
      let [y, m] = rule.posted_through.split('-').map(Number);
      const periods: { year: number; month: number; date: string }[] = [];
      for (;;) {
        const next = addMonths(y, m, step);
        const date = postingDate(next.year, next.month, rule.day_of_month);
        if (date > today) break;
        periods.push({ ...next, date });
        ({ year: y, month: m } = next);
      }
      // A rule left untouched for years only back-fills the most recent stretch.
      for (const { year, month, date } of periods.slice(-Math.ceil(MAX_CATCH_UP_MONTHS / step))) {
        await tx.insert(transactions).values({
          userId,
          category: rule.category,
          amount: rule.amount,
          type: rule.type,
          subcategory: null,
          note: rule.note ?? `Repeats ${frequency}`,
          date,
          month,
          year,
        });
        count++;
      }
      const postedThrough = monthStart(y, m);
      await tx
        .update(recurringTransactions)
        .set({ posted_through: postedThrough, next_due: nextDueAfter(postedThrough, frequency, rule.day_of_month) })
        .where(eq(recurringTransactions.id, rule.id));
    }
    return count;
  });

  if (posted > 0) await recomputeBudgetClass(userId);
  return posted;
};
