import { NextFunction, Request, Response } from 'express';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { recurringTransactions, transactions } from '../db/schema';
import { recomputeBudgetClass } from './budgetClass';
import { monthStart, monthsToPost } from './loanEmiExpenses';

// A "repeat every month" rule posts its amount again on the 1st of each month
// after the user's original entry. Same lazy approach as loan EMIs: missing
// months are posted the next time the user's data is read, so nothing needs a
// background job. `posted_through` records how far posting has got and the
// rule rows are locked while posting, so parallel requests can't double-post.

/** Posts any missing monthly entries for the user's repeating rules. Returns how many transactions were created. */
export const postDueRecurring = async (userId: number, now: Date = new Date()): Promise<number> => {
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1;
  const currentStart = monthStart(curYear, curMonth);

  const dueFilter = and(eq(recurringTransactions.userId, userId), lt(recurringTransactions.posted_through, currentStart));

  const [pending] = await db.select({ id: recurringTransactions.id }).from(recurringTransactions).where(dueFilter).limit(1);
  if (!pending) return 0;

  const posted = await db.transaction(async (tx) => {
    // Re-selected under a row lock: a concurrent request that got here first
    // has already advanced posted_through, so its rules no longer match.
    const due = await tx.select().from(recurringTransactions).where(dueFilter).for('update');
    let count = 0;
    for (const rule of due) {
      for (const { year, month } of monthsToPost(rule.posted_through, curYear, curMonth)) {
        await tx.insert(transactions).values({
          userId,
          category: rule.category,
          amount: rule.amount,
          type: rule.type,
          subcategory: null,
          note: rule.note ?? 'Repeats monthly',
          date: monthStart(year, month),
          month,
          year,
        });
        count++;
      }
      await tx.update(recurringTransactions).set({ posted_through: currentStart }).where(eq(recurringTransactions.id, rule.id));
    }
    return count;
  });

  if (posted > 0) await recomputeBudgetClass(userId);
  return posted;
};

export const recurringMiddleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    await postDueRecurring(req.userId!);
    next();
  } catch (err) {
    next(err);
  }
};
