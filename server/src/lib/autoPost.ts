import { NextFunction, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { loans, recurringTransactions } from '../db/schema';
import { loansDueFilter, postDueLoanEmis } from './loanEmiExpenses';
import { rulesDueFilter, postDueRecurring } from './recurringTransactions';

/**
 * Runs before every request that reads money (transactions, reports,
 * budgets): posts any due loan EMIs and repeating entries first, so totals
 * are complete. Almost always there is nothing due, so the common case is a
 * single indexed query answering both questions at once (it used to be one
 * query per kind); the posting functions only run when something is due.
 */
export const autoPostMiddleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const now = new Date();
    const result = await db.execute<{ loans_due: boolean; rules_due: boolean }>(
      sql`select exists(select 1 from ${loans} where ${loansDueFilter(userId, now)}) as loans_due,
                 exists(select 1 from ${recurringTransactions} where ${rulesDueFilter(userId, now)}) as rules_due`
    );
    const { loans_due, rules_due } = result.rows[0];
    if (loans_due) await postDueLoanEmis(userId, now, true);
    if (rules_due) await postDueRecurring(userId, now, true);
    next();
  } catch (err) {
    next(err);
  }
};
