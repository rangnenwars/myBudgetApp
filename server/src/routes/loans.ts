import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { loans, transactions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { badRequest, notFound } from '../lib/errors';
import { recomputeBudgetClass } from '../lib/budgetClass';
import { computePartPayment } from '../calculations';
import { loanEmiMiddleware } from '../lib/loanEmiExpenses';

const router = Router();
router.use(requireAuth, loanEmiMiddleware);

const payEmiSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

const partPaymentSchema = payEmiSchema.extend({
  amount: z.coerce.number().positive(),
});

const createSchema = z.object({
  name: z.string().trim().min(1),
  principal: z.coerce.number().positive(),
  outstanding: z.coerce.number().min(0),
  emi: z.coerce.number().positive(),
  interest_rate: z.coerce.number().nullish(),
  counts_as_expense: z.boolean().optional(),
});

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
        counts_as_expense: body.counts_as_expense ?? true,
      })
      .returning();
    res.status(201).json(row);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = updateSchema.parse(req.body);

    const updateData: { [K in keyof typeof loans.$inferInsert]?: (typeof loans.$inferInsert)[K] | SQL } = { updated_at: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.principal !== undefined) updateData.principal = body.principal;
    if (body.outstanding !== undefined) updateData.outstanding = body.outstanding;
    if (body.emi !== undefined) updateData.emi = body.emi;
    if (body.interest_rate !== undefined) updateData.interest_rate = body.interest_rate ?? null;
    if (body.counts_as_expense !== undefined) {
      updateData.counts_as_expense = body.counts_as_expense;
      // Switching a loan back on must not back-fill the months it was off (the
      // toggle only ever applies going forward): unless this month was already
      // posted, restart posting from the current month.
      if (body.counts_as_expense) {
        const now = new Date();
        const currentStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
        updateData.emi_expensed_through = sql`CASE WHEN ${loans.emi_expensed_through} >= ${currentStart} THEN ${loans.emi_expensed_through} ELSE NULL END`;
      }
    }

    const [row] = await db
      .update(loans)
      .set(updateData)
      .where(and(eq(loans.id, id), eq(loans.userId, req.userId!)))
      .returning();
    if (!row) throw notFound('Loan not found.');
    res.json(row);
  })
);

// Marks one EMI as paid: lowers the outstanding balance by min(emi,
// outstanding) so the final instalment can't overshoot. It deliberately does
// NOT log an expense — a counted loan's EMI is already posted once a month by
// postDueLoanEmis (lib/loanEmiExpenses.ts), and a loan that isn't counted must
// stay out of expenses. Either way the debt remains a liability in Reports.
router.post(
  '/:id/pay-emi',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    payEmiSchema.parse(req.body);

    const [loan] = await db
      .select()
      .from(loans)
      .where(and(eq(loans.id, id), eq(loans.userId, req.userId!), eq(loans.is_active, true)));
    if (!loan) throw notFound('Loan not found.');
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
    const id = Number(req.params.id);
    const body = partPaymentSchema.parse(req.body);
    const [y, m] = body.date.split('-').map(Number);

    const result = await db.transaction(async (tx) => {
      const [loan] = await tx
        .select()
        .from(loans)
        .where(and(eq(loans.id, id), eq(loans.userId, req.userId!), eq(loans.is_active, true)));
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
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(loans)
      .where(and(eq(loans.id, id), eq(loans.userId, req.userId!)))
      .returning({ id: loans.id });
    if (!deleted) throw notFound('Loan not found.');
    res.status(204).send();
  })
);

export default router;
