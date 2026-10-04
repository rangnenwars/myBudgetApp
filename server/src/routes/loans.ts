import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { loans, transactions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { isoDate, money, idParam } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { badRequest, notFound } from '../lib/errors';
import { recomputeBudgetClass } from '../lib/budgetClass';
import { computePartPayment } from '../calculations';
import { loanEmiMiddleware, monthStart } from '../lib/loanEmiExpenses';
import { localToday } from '../lib/clock';

const router = Router();
router.use(requireAuth, loanEmiMiddleware);

const payEmiSchema = z.object({
  date: isoDate(),
});

const partPaymentSchema = payEmiSchema.extend({
  amount: money(),
});

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  principal: money(),
  outstanding: z.coerce.number().min(0).max(9_999_999_999.99, 'Amount is too large.'),
  emi: money(),
  // Annual %, numeric(5,2).
  interest_rate: z.coerce.number().min(0).max(99.99, 'Interest rate must be under 100%.').nullish(),
  tenure_months: z.coerce.number().int().min(1).max(600).nullish(),
  start_date: isoDate('start_date').nullish(),
  loan_type: optionalText(40),
  lender: optionalText(80),
  note: optionalText(500),
  counts_as_expense: z.boolean().optional(),
});

const OPTIONAL_FIELDS = ['interest_rate', 'tenure_months', 'start_date', 'loan_type', 'lender', 'note'] as const;

const updateSchema = createSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(loans).where(and(eq(loans.userId, req.userId!), eq(loans.is_active, true))).orderBy(desc(loans.id));
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [row] = await db
      .insert(loans)
      .values({
        userId: req.userId!,
        name: body.name,
        principal: body.principal,
        outstanding: body.outstanding,
        emi: body.emi,
        interest_rate: body.interest_rate ?? null,
        tenure_months: body.tenure_months ?? null,
        start_date: body.start_date ?? null,
        loan_type: body.loan_type ?? null,
        lender: body.lender ?? null,
        note: body.note ?? null,
        counts_as_expense: body.counts_as_expense ?? true,
      })
      .returning();
    res.status(201).json(row);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = updateSchema.parse(req.body);

    const updateData: { [K in keyof typeof loans.$inferInsert]?: (typeof loans.$inferInsert)[K] | SQL } = { updated_at: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.principal !== undefined) updateData.principal = body.principal;
    if (body.outstanding !== undefined) updateData.outstanding = body.outstanding;
    if (body.emi !== undefined) updateData.emi = body.emi;
    for (const field of OPTIONAL_FIELDS) {
      if (body[field] !== undefined) (updateData as Record<string, unknown>)[field] = body[field] ?? null;
    }
    if (body.counts_as_expense !== undefined) {
      updateData.counts_as_expense = body.counts_as_expense;
      // Switching a loan back on must not back-fill the months it was off (the
      // toggle only ever applies going forward): unless this month was already
      // posted, restart posting from the current month.
      if (body.counts_as_expense) {
        const today = localToday();
        const currentStart = monthStart(today.year, today.month);
        updateData.emi_expensed_through = sql`CASE WHEN ${loans.emi_expensed_through} >= ${currentStart} THEN ${loans.emi_expensed_through} ELSE NULL END`;
      }
    }

    const row = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(loans)
        .where(and(eq(loans.id, id), eq(loans.userId, req.userId!)))
        .for('update');
      if (!before) throw notFound('Loan not found.');

      const [updated] = await tx.update(loans).set(updateData).where(eq(loans.id, id)).returning();

      // This month's EMI was already posted as an expense from the old values;
      // correcting the loan must correct that entry too, or Home and Reports
      // keep showing the stale figure. (Earlier months are history and stay.)
      if (updated.counts_as_expense && (updated.emi !== before.emi || updated.name !== before.name)) {
        const today = localToday();
        const thisMonth = monthStart(today.year, today.month);
        await tx
          .update(transactions)
          .set({ amount: Math.min(updated.emi, updated.outstanding > 0 ? updated.outstanding : updated.emi), note: `EMI - ${updated.name}` })
          .where(
            and(
              eq(transactions.userId, req.userId!),
              eq(transactions.category, 'loan_emi'),
              eq(transactions.date, thisMonth),
              eq(transactions.note, `EMI - ${before.name}`)
            )
          );
      }
      return updated;
    });
    await recomputeBudgetClass(req.userId!);
    res.json(row);
  })
);

// Marks one EMI as paid on a loan that does NOT count as an expense (e.g.
// money borrowed from family): lowers the outstanding balance by min(emi,
// outstanding) so the final instalment can't overshoot, and logs no expense.
// Counted loans are refused — their EMI is posted and the balance paid down
// automatically each month (lib/loanEmiExpenses.ts), so a manual tap would
// reduce it twice. Either way the debt remains a liability in Reports.
router.post(
  '/:id/pay-emi',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    payEmiSchema.parse(req.body);

    const [loan] = await db
      .select()
      .from(loans)
      .where(and(eq(loans.id, id), eq(loans.userId, req.userId!), eq(loans.is_active, true)));
    if (!loan) throw notFound('Loan not found.');
    if (loan.counts_as_expense) {
      throw badRequest("This loan's EMI is recorded and its balance reduced automatically every month.");
    }
    if (loan.outstanding <= 0) throw badRequest('This loan is already fully paid.');

    const payment = Math.min(loan.emi, loan.outstanding);
    const nextOutstanding = Math.round((loan.outstanding - payment) * 100) / 100;
    const [updatedLoan] = await db
      .update(loans)
      .set({ outstanding: nextOutstanding, updated_at: new Date() })
      .where(and(eq(loans.id, id), eq(loans.outstanding, loan.outstanding)))
      .returning();
    if (!updatedLoan) throw badRequest('This loan changed while paying — please try again.');

    res.status(201).json({ loan: updatedLoan });
  })
);

// Records a part payment (prepayment): lowers `outstanding` by `amount` and
// scales the EMI down by the same ratio so the remaining tenure is unchanged
// (see computePartPayment). Same expense rule as pay-emi — a transaction is
// logged only when the loan counts as an expense. A payment equal to the
// outstanding balance closes the loan and keeps the EMI as it was.
router.post(
  '/:id/part-payment',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = partPaymentSchema.parse(req.body);
    const [y, m] = body.date.split('-').map(Number);

    const result = await db.transaction(async (tx) => {
      const [loan] = await tx
        .select()
        .from(loans)
        .where(and(eq(loans.id, id), eq(loans.userId, req.userId!), eq(loans.is_active, true)))
        // Row lock: concurrent part payments (or a pay-emi) would otherwise
        // compute from the same outstanding and one reduction would be lost.
        .for('update');
      if (!loan) throw notFound('Loan not found.');
      if (loan.outstanding <= 0) throw badRequest('This loan is already fully paid.');
      if (body.amount > loan.outstanding) {
        throw badRequest(`A part payment can't exceed the outstanding balance (${loan.outstanding}).`);
      }

      const next = computePartPayment(loan, body.amount);
      const [updatedLoan] = await tx
        .update(loans)
        .set({ outstanding: next.outstanding, emi: next.emi, updated_at: new Date() })
        .where(eq(loans.id, id))
        .returning();

      if (!loan.counts_as_expense) return { loan: updatedLoan, transaction: null };

      const [transaction] = await tx
        .insert(transactions)
        .values({
          userId: req.userId!,
          category: 'loan_part_payment',
          amount: body.amount,
          type: 'expense',
          subcategory: null,
          note: `Part payment - ${loan.name}`,
          date: body.date,
          month: m,
          year: y,
        })
        .returning();

      return { loan: updatedLoan, transaction };
    });

    if (result.transaction) await recomputeBudgetClass(req.userId!);
    res.status(201).json(result);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const [deleted] = await db
      .delete(loans)
      .where(and(eq(loans.id, id), eq(loans.userId, req.userId!)))
      .returning({ id: loans.id });
    if (!deleted) throw notFound('Loan not found.');
    res.status(204).send();
  })
);

export default router;
