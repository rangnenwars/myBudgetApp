import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { recurringTransactions, transactions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam, money, optionalText } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { nextDueAfter, NO_REPEAT_CATEGORIES, NO_REPEAT_MESSAGE, ruleScheduleFor, RepeatFrequency } from '../lib/recurringTransactions';

// New entries get a rule via POST /transactions with repeat_monthly: true (the
// entry and its rule are written together); POST here does the same for a
// transaction that already exists. This router also lists, edits and stops rules.
const router = Router();
router.use(requireAuth);

const frequencySchema = z.enum(['monthly', 'quarterly', 'yearly']);

const createSchema = z.object({
  transaction_id: z.coerce.number().int().positive(),
  frequency: frequencySchema.default('monthly'),
});

const updateSchema = z
  .object({
    amount: money().optional(),
    note: optionalText(500).optional(),
    frequency: frequencySchema.optional(),
    day_of_month: z.coerce.number().int().min(1).max(31).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(recurringTransactions).where(eq(recurringTransactions.userId, req.userId!)).orderBy(desc(recurringTransactions.id));
    res.json(rows);
  })
);

// Makes an existing transaction repeat (monthly by default): the rule copies
// its type, category, amount and note, repeats on the same day of the month,
// and the next entry is one period after it.
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
    if (NO_REPEAT_CATEGORIES.has(txn.category)) throw badRequest(NO_REPEAT_MESSAGE);

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
        ...ruleScheduleFor(txn.date, body.frequency),
      })
      .returning();
    res.status(201).json(row);
  })
);

// Changes apply to entries not yet posted; transactions already posted keep
// theirs. A new frequency or day counts on from the last period posted.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = updateSchema.parse(req.body);

    const updateData: Partial<typeof recurringTransactions.$inferInsert> = { updated_at: new Date() };
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.note !== undefined) updateData.note = body.note?.trim() || null;
    if (body.frequency !== undefined || body.day_of_month !== undefined) {
      const [current] = await db
        .select()
        .from(recurringTransactions)
        .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, req.userId!)));
      if (!current) throw notFound('Repeating entry not found.');
      const frequency = body.frequency ?? (current.frequency as RepeatFrequency);
      const day = body.day_of_month ?? current.day_of_month;
      updateData.frequency = frequency;
      updateData.day_of_month = day;
      updateData.next_due = nextDueAfter(current.posted_through, frequency, day);
    }

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
    const id = idParam(req);
    const [deleted] = await db
      .delete(recurringTransactions)
      .where(and(eq(recurringTransactions.id, id), eq(recurringTransactions.userId, req.userId!)))
      .returning({ id: recurringTransactions.id });
    if (!deleted) throw notFound('Repeating entry not found.');
    res.status(204).send();
  })
);

export default router;
