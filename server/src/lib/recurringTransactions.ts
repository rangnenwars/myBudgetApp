import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db/client';
import { recurringTransactions, transactions } from '../db/schema';
import { recomputeBudgetClass } from './budgetClass';
import { MAX_CATCH_UP_MONTHS, monthStart } from './loanEmiExpenses';
import { localToday } from './clock';
import { badRequest } from './errors';

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
/**
 * A rule that can still post: no end date, or its next entry falls on or before
 * the end date. Once the last entry before `ends_on` is posted, next_due moves
 * past it and the rule is expired.
 */
export const activeRuleFilter = () => or(isNull(recurringTransactions.ends_on), gte(recurringTransactions.ends_on, recurringTransactions.next_due))!;

/** Rules of the user with an entry due today or earlier (and not past their end date). */
export const rulesDueFilter = (userId: number, now: Date = new Date()) =>
  and(eq(recurringTransactions.userId, userId), lte(recurringTransactions.next_due, todayLocal(now)), activeRuleFilter())!;

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
      // Catching up never goes past the end date, however long the app sat unopened.
      const cap = rule.ends_on && rule.ends_on < today ? rule.ends_on : today;
      for (;;) {
        const next = addMonths(y, m, step);
        const date = postingDate(next.year, next.month, rule.day_of_month);
        if (date > cap) break;
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

/** How far ahead an end date may be set (years), so a typo like 2926 is a 400. */
const MAX_END_YEARS = 30;

/**
 * Turns the request's `ends_on` / `no_end` into rule columns. A new repeat must
 * say which (`required`); an edit may leave both out to keep what the rule has.
 * `after` is the earliest allowed end date (the entry's own date for a new repeat).
 */
export const endFields = (
  body: { ends_on?: string; no_end?: boolean },
  opts: { required: boolean; after?: string; now?: Date }
): { ends_on?: string | null; no_end?: boolean } => {
  if (body.ends_on !== undefined && body.no_end) throw badRequest('Choose either an end date or no end date, not both.');
  if (body.ends_on !== undefined) {
    if (opts.after && body.ends_on < opts.after) throw badRequest("The end date can't be before the first entry.");
    const today = localToday(opts.now ?? new Date());
    if (body.ends_on > `${today.year + MAX_END_YEARS}-12-31`) throw badRequest(`The end date can be at most ${MAX_END_YEARS} years away.`);
    return { ends_on: body.ends_on, no_end: false };
  }
  if (body.no_end) return { ends_on: null, no_end: true };
  if (opts.required) throw badRequest('Choose when this repeat ends: set an end date or pick No end date.');
  return {};
};
