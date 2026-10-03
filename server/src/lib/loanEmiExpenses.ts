import { NextFunction, Request, Response } from 'express';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { db } from '../db/client';
import { loans, transactions } from '../db/schema';
import { recomputeBudgetClass } from './budgetClass';

// A loan that counts as an expense contributes its EMI to every month it is
// live. Rather than a scheduler, the missing months are posted lazily the next
// time the user's data is read (see loanEmiMiddleware), so nothing depends on a
// background process being up. Posting is idempotent: `emi_expensed_through`
// on the loan records how far it has got, and the loan rows are locked while
// posting so parallel requests can't double-post.

export const MAX_CATCH_UP_MONTHS = 24;

export const monthStart = (year: number, month: number): string => `${year}-${String(month).padStart(2, '0')}-01`;

/** Months (oldest first) that still need an EMI posted, given how far posting has got. A loan never posted before only gets the current month — its history isn't known. */
export const monthsToPost = (through: string | null, curYear: number, curMonth: number): { year: number; month: number }[] => {
  if (!through) return [{ year: curYear, month: curMonth }];
  let [y, m] = through.split('-').map(Number);
  const months: { year: number; month: number }[] = [];
  while (y < curYear || (y === curYear && m < curMonth)) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    months.push({ year: y, month: m });
  }
  return months.slice(-MAX_CATCH_UP_MONTHS);
};

/** Posts any missing monthly EMI expenses for the user's counted loans. Returns how many transactions were created. */
export const postDueLoanEmis = async (userId: number, now: Date = new Date()): Promise<number> => {
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1;
  const currentStart = monthStart(curYear, curMonth);

  const dueFilter = and(
    eq(loans.userId, userId),
    eq(loans.is_active, true),
    eq(loans.counts_as_expense, true),
    gt(loans.outstanding, 0),
    or(isNull(loans.emi_expensed_through), lt(loans.emi_expensed_through, currentStart))
  );

  const [pending] = await db.select({ id: loans.id }).from(loans).where(dueFilter).limit(1);
  if (!pending) return 0;

  const posted = await db.transaction(async (tx) => {
    // Re-selected under a row lock: a concurrent request that got here first
    // has already advanced emi_expensed_through, so its loans no longer match.
    const due = await tx.select().from(loans).where(dueFilter).for('update');
    let count = 0;
    for (const loan of due) {
      for (const { year, month } of monthsToPost(loan.emi_expensed_through, curYear, curMonth)) {
        await tx.insert(transactions).values({
          userId,
          category: 'loan_emi',
          amount: loan.emi,
          type: 'expense',
          subcategory: null,
          note: `EMI - ${loan.name}`,
          date: monthStart(year, month),
          month,
          year,
        });
        count++;
      }
      await tx.update(loans).set({ emi_expensed_through: currentStart }).where(eq(loans.id, loan.id));
    }
    return count;
  });

  if (posted > 0) await recomputeBudgetClass(userId);
  return posted;
};

/** Runs after requireAuth on every route that reads or reports on money, so transactions and totals always include the current month's EMIs. */
export const loanEmiMiddleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    await postDueLoanEmis(req.userId!);
    next();
  } catch (err) {
    next(err);
  }
};
