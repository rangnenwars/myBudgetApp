import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { recurringTransactions, transactions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { conflict, notFound } from '../lib/errors';
import { monthStart } from '../lib/loanEmiExpenses';

// New entries get a rule via POST /transactions with repeat_monthly: true (the
// entry and its rule are written together); POST here does the same for a
// transaction that already exists. This router also lists, edits and stops rules.
const router = Router();
router.use(requireAuth);

const createSchema = z.object({ transaction_id: z.coerce.number().int().positive() });

const updateSchema = z
  .object({
    amount: z.coerce.number().positive().optional(),
    note: z.string().nullish(),
  })
  .refine((b) => b.amount !== undefined || b.note !== undefined, { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(recurringTransactions).where(eq(recurringTransactions.userId, req.userId!)).orderBy(desc(recurringTransactions.id));
    res.json(rows);
  })
);

// Makes an existing transaction repeat monthly: the rule copies its type,
// category, amount and note, and posting resumes from the month after it.
// An identical rule (same type, category and amount) is refused, so a
// double tap can't cause every month to post twice.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    const [txn] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, body.transaction_id), eq(transactions.userId, req.userId!)));
    if (!txn) throw notFound('Transaction not found.');

    const [duplicate] = await db
      .select({ id: recurringTransactions.id })
      .from(recurringTransactions)
      .where(
        and(
          eq(recurringTransactions.userId, req.userId!),
          eq(recurringTransactions.type, txn.type),
          eq(recurringTransactions.category, txn.category),
          eq(recurringTransactions.amount, txn.amount)
        )
      );
    if (duplicate) throw conflict('An entry with this category and amount already repeats monthly.');

    const [row] = await db
      .insert(recurringTransactions)
      .values({
        userId: req.userId!,
        category: txn.category,
        type: txn.type,
        amount: txn.amount,
        note: txn.note?.trim() || null,
        posted_through: monthStart(txn.year, txn.month),
      })
      .returning();
    res.status(201).json(row);
  })
);

// A new amount applies to months not yet posted; transactions already posted keep theirs.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = updateSchema.parse(req.body);

    const updateData: Partial<typeof recurringTransactions.$inferInsert> = { updated_at: new Date() };
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.note !== undefined) updateData.note = body.note?.trim() || null;

    const [row] = await db
      .update(recurringTransactions)
      .set(updateData)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, req.userId!)))
      .returning();
    if (!row) throw notFound('Repeating entry not found.');
    res.json(row);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(recurringTransactions)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, req.userId!)))
      .returning({ id: recurringTransactions.id });
    if (!deleted) throw notFound('Repeating entry not found.');
    res.status(204).send();
  })
);

export default router;
