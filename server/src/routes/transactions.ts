import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, isNull, or } from 'drizzle-orm';
import { db } from '../db/client';
import { transactions, categories, recurringTransactions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { loanEmiMiddleware, monthStart } from '../lib/loanEmiExpenses';
import { recurringMiddleware } from '../lib/recurringTransactions';
import { badRequest, notFound } from '../lib/errors';
import { recomputeBudgetClass } from '../lib/budgetClass';
import { getTransactionsInRange } from '../lib/queries';

const router = Router();
router.use(requireAuth, loanEmiMiddleware, recurringMiddleware);

const monthYearQuery = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

const rangeQuery = z.object({
  startMonth: z.coerce.number().int().min(1).max(12),
  startYear: z.coerce.number().int().min(2000).max(2100),
  endMonth: z.coerce.number().int().min(1).max(12),
  endYear: z.coerce.number().int().min(2000).max(2100),
});

const baseSchema = z.object({
  amount: z.coerce.number().positive(),
  type: z.enum(['income', 'expense']),
  category_key: z.string().min(1),
  subcategory: z.string().nullish(),
  note: z.string().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
});

// repeat_monthly is create-only: it also saves a rule that posts the same
// entry on the 1st of every following month (lib/recurringTransactions.ts).
const createSchema = baseSchema.extend({ repeat_monthly: z.boolean().optional() });

const updateSchema = baseSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

/** Shared by POST and PATCH — a category key existing at all isn't enough, since custom categories belong to a single account. */
const assertValidCategory = async (categoryKey: string, userId: number) => {
  const [category] = await db
    .select({ key: categories.key })
    .from(categories)
    .where(and(eq(categories.key, categoryKey), or(isNull(categories.userId), eq(categories.userId, userId))));
  if (!category) throw badRequest('Invalid category.');
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = monthYearQuery.parse(req.query);
    const conditions = [eq(transactions.userId, req.userId!)];
    if (q.month != null) conditions.push(eq(transactions.month, q.month));
    if (q.year != null) conditions.push(eq(transactions.year, q.year));

    const rows = await db.select().from(transactions).where(and(...conditions)).orderBy(desc(transactions.date), desc(transactions.id));
    res.json(rows);
  })
);

router.get(
  '/range',
  asyncHandler(async (req, res) => {
    const q = rangeQuery.parse(req.query);
    const rows = await getTransactionsInRange(req.userId!, q.startMonth, q.startYear, q.endMonth, q.endYear);
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [y, m] = body.date.split('-').map(Number);

    await assertValidCategory(body.category_key, req.userId!);

    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(transactions)
        .values({
          userId: req.userId!,
          category: body.category_key,
          amount: body.amount,
          type: body.type,
          subcategory: body.subcategory ?? null,
          note: body.note ?? null,
          date: body.date,
          month: m,
          year: y,
        })
        .returning();

      if (body.repeat_monthly) {
        await tx.insert(recurringTransactions).values({
          userId: req.userId!,
          category: body.category_key,
          type: body.type,
          amount: body.amount,
          note: body.note?.trim() || null,
          posted_through: monthStart(y, m),
        });
      }
      return created;
    });

    await recomputeBudgetClass(req.userId!);
    res.status(201).json(row);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = updateSchema.parse(req.body);

    if (body.category_key !== undefined) {
      await assertValidCategory(body.category_key, req.userId!);
    }

    const updateData: Partial<typeof transactions.$inferInsert> = {};
    if (body.amount !== undefined) updateData.amount = body.amount;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.category_key !== undefined) updateData.category = body.category_key;
    if (body.subcategory !== undefined) updateData.subcategory = body.subcategory ?? null;
    if (body.note !== undefined) updateData.note = body.note ?? null;
    if (body.date !== undefined) {
      const [y, m] = body.date.split('-').map(Number);
      updateData.date = body.date;
      updateData.month = m;
      updateData.year = y;
    }

    const [row] = await db
      .update(transactions)
      .set(updateData)
      .where(and(eq(transactions.id, id), eq(transactions.userId, req.userId!)))
      .returning();
    if (!row) throw notFound('Transaction not found.');

    // Amount/type/date can all shift which month a transaction counts
    // toward — recompute the same way POST does rather than leaving a
    // stale budgetClass behind.
    await recomputeBudgetClass(req.userId!);
    res.json(row);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.userId, req.userId!)))
      .returning({ id: transactions.id });
    if (!deleted) throw notFound('Transaction not found.');
    res.status(204).send();
  })
);

export default router;
