import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { loanPayments, loans, transactions } from '../db/schema';
import { badRequest, notFound } from './errors';
import { recomputeBudgetClass } from './budgetClass';
import { undoPartPayment } from '../calculations';

export interface DeletedPartPayment {
  loan: typeof loans.$inferSelect;
  /** True when the matching expense entry was found and removed. False for a loan that logs no expense, or an old payment whose entry could not be found. */
  expenseRemoved: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Permanently deletes one part payment and undoes what it did, all or nothing:
 * the balance and EMI go back, the expense entry it logged is removed, and the
 * balance shown on later rows in the payments list is moved by the same amount.
 * EMI rows are posted automatically each month and cannot be deleted here.
 */
export const deletePartPayment = async (userId: number, loanId: number, paymentId: number): Promise<DeletedPartPayment> => {
  const result = await db.transaction(async (tx) => {
    // Same row lock as part-payment and pay-emi, so a payment made at the same moment cannot be lost.
    const [loan] = await tx
      .select()
      .from(loans)
      .where(and(eq(loans.id, loanId), eq(loans.userId, userId), eq(loans.is_active, true)))
      .for('update');
    if (!loan) throw notFound('Loan not found.');

    const [payment] = await tx
      .select()
      .from(loanPayments)
      .where(and(eq(loanPayments.id, paymentId), eq(loanPayments.loanId, loanId), eq(loanPayments.userId, userId)));
    if (!payment) throw notFound('Payment not found.');
    if (payment.kind !== 'part_payment') {
      throw badRequest('EMIs are posted automatically and cannot be deleted. Only part payments can.');
    }

    const [later] = await tx
      .select({ id: loanPayments.id })
      .from(loanPayments)
      .where(and(eq(loanPayments.loanId, loanId), eq(loanPayments.kind, 'part_payment'), gt(loanPayments.id, payment.id)))
      .limit(1);

    const restored = undoPartPayment(loan, payment.amount, { emiBefore: payment.emiBefore, isLatest: !later });
    if (restored.outstanding > 9_999_999_999.99) throw badRequest('Restoring this payment would make the balance too large.');

    const [updatedLoan] = await tx
      .update(loans)
      .set({ outstanding: restored.outstanding, emi: restored.emi, updated_at: new Date() })
      .where(eq(loans.id, loanId))
      .returning();

    // Rows added after this one recorded the balance at their time, which was lower by this amount.
    await tx
      .update(loanPayments)
      .set({ balanceAfter: sql`${loanPayments.balanceAfter} + ${payment.amount}` })
      .where(and(eq(loanPayments.loanId, loanId), gt(loanPayments.id, payment.id), sql`${loanPayments.balanceAfter} is not null`));

    // The expense entry this payment logged. New payments carry a link to it; older ones are matched
    // by what they wrote (category, amount, date, note) and only when exactly one entry fits.
    let expenseRemoved = false;
    if (payment.transactionId != null) {
      const gone = await tx.delete(transactions).where(and(eq(transactions.id, payment.transactionId), eq(transactions.userId, userId))).returning({ id: transactions.id });
      expenseRemoved = gone.length > 0;
    } else if (loan.counts_as_expense) {
      const candidates = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.category, 'loan_part_payment'),
            eq(transactions.amount, payment.amount),
            eq(transactions.date, payment.date),
            eq(transactions.note, `Part payment - ${loan.name}`)
          )
        );
      if (candidates.length === 1) {
        await tx.delete(transactions).where(eq(transactions.id, candidates[0].id));
        expenseRemoved = true;
      }
    }

    await tx.delete(loanPayments).where(eq(loanPayments.id, payment.id));
    return { loan: updatedLoan, expenseRemoved };
  });

  if (result.expenseRemoved) await recomputeBudgetClass(userId);
  return { ...result, loan: { ...result.loan, outstanding: round2(result.loan.outstanding) } };
};
