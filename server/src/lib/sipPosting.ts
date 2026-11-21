import { NextFunction, Request, Response } from 'express';
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { investments, transactions } from '../db/schema';
import { recomputeBudgetClass } from './budgetClass';
import { addMonths, localToday } from './clock';
import { applySip, sipMonthStart, sipMonthsDue } from '../../../utils/sip';

// An investment with a SIP adds its amount to Transactions on the SIP day every month, and each one
// also raises the investment (invested and value) by the same amount, the way a loan's EMI is posted
// and pays the loan down (lib/loanEmiExpenses.ts). Missing months are posted lazily the next time the
// user's data is read, so nothing depends on a background process. `sip_posted_through` is the first
// day of the last month settled; posting is idempotent and the rows are locked while posting.
//
// The very first posting records the expense only: the "invested so far" the user already entered is
// today's figure, so adding the SIP to it would count this month's money twice. A SIP never posts
// history from before it was set up, and never dates anything in the future.

/** Investments of the user whose SIP still has a month to settle (its day has arrived and it is not yet posted). */
export const sipsDueFilter = (userId: number, now: Date = new Date()) => {
  const today = localToday(now);
  const currentStart = sipMonthStart(today.year, today.month);
  const prev = addMonths(today.year, today.month, -1);
  const previousStart = sipMonthStart(prev.year, prev.month);
  const daysInMonth = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
  // The 29th to 31st land on the last day of a shorter month.
  const arrived = sql`least(${investments.sip_day}, ${daysInMonth}) <= ${today.day}`;
  return and(
    eq(investments.userId, userId),
    isNotNull(investments.sip_amount),
    or(
      and(isNull(investments.sip_posted_through), arrived),
      // A whole earlier month is still missing: due whatever day it is now.
      lt(investments.sip_posted_through, previousStart),
      // Last month is settled, this month's day has arrived.
      and(lt(investments.sip_posted_through, currentStart), arrived)
    )
  )!;
};

/**
 * Posts every missing SIP month for the user's investments. Returns how many transactions were added.
 * `knownDue` skips the cheap "anything due?" check when the caller has just done it.
 */
export const postDueSips = async (userId: number, now: Date = new Date(), knownDue = false): Promise<number> => {
  const today = localToday(now);
  const dueFilter = sipsDueFilter(userId, now);

  if (!knownDue) {
    const [pending] = await db.select({ id: investments.id }).from(investments).where(dueFilter).limit(1);
    if (!pending) return 0;
  }

  const posted = await db.transaction(async (tx) => {
    // Re-selected under a row lock: a request that got here first has already moved sip_posted_through.
    const due = await tx.select().from(investments).where(dueFilter).for('update');
    let count = 0;
    for (const inv of due) {
      if (inv.sip_amount == null || inv.sip_day == null || inv.sip_category == null) continue;
      const firstPosting = inv.sip_posted_through == null;
      const months = sipMonthsDue(inv.sip_posted_through, inv.sip_day, inv.sip_ends_on, today.iso);
      if (months.length === 0) continue;

      let amount = inv.amount;
      let value = inv.current_value;
      let returns = inv.returns_percent;
      for (const m of months) {
        if (m.post) {
          await tx.insert(transactions).values({
            userId,
            category: inv.sip_category,
            amount: inv.sip_amount,
            type: 'expense',
            subcategory: null,
            note: `SIP - ${inv.name}`,
            date: m.date,
            month: m.month,
            year: m.year,
          });
          count++;
          if (!firstPosting) {
            const next = applySip(amount, value, inv.sip_amount);
            amount = next.amount;
            value = next.current_value;
            returns = next.returns_percent;
          }
        }
      }
      const last = months[months.length - 1];
      await tx
        .update(investments)
        .set({
          sip_posted_through: sipMonthStart(last.year, last.month),
          amount,
          current_value: value,
          returns_percent: returns,
          ...(amount !== inv.amount && { updated_at: new Date() }),
        })
        .where(eq(investments.id, inv.id));
    }
    return count;
  });

  if (posted > 0) await recomputeBudgetClass(userId);
  return posted;
};

/** Runs after requireAuth on the investments routes, so the list always shows the SIPs that are due. */
export const sipMiddleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    await postDueSips(req.userId!);
    next();
  } catch (err) {
    next(err);
  }
};
