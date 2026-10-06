import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { and, eq, desc, gte, ilike, inArray, isNull, lt, lte, or, sql, SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { transactions, categories, recurringTransactions, people, peopleLedger } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { monthsDateRange } from '../lib/clock';
import { isoDate, idParam, money, optionalText, likeContains } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { autoPostMiddleware } from '../lib/autoPost';
import { NO_REPEAT_CATEGORIES, NO_REPEAT_MESSAGE, ruleScheduleFor } from '../lib/recurringTransactions';
import { badRequest, conflict, notFound } from '../lib/errors';
import { recomputeBudgetClass } from '../lib/budgetClass';
import { splitEqually } from '../calculations';
import { getTransactionsInRange } from '../lib/queries';

const router = Router();
router.use(requireAuth, autoPostMiddleware);

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

const UNFILTERED_LIMIT = 5000;

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  // Opaque to the client: "<date>_<id>" of the last row of the previous page.
  cursor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}_\d+$/, 'Invalid cursor.')
    .optional(),
  q: z.string().trim().max(100).optional(),
  type: z.enum(['income', 'expense']).optional(),
  category: z.string().min(1).optional(),
  from: isoDate('from').optional(),
  to: isoDate('to').optional(),
});

const baseSchema = z.object({
  amount: money(),
  type: z.enum(['income', 'expense']),
  category_key: z.string().min(1).max(64),
  subcategory: optionalText(100),
  note: optionalText(500),
  date: isoDate(),
});

// Create-only: also save a rule that posts the same entry again every
// month/quarter/year on the entry's day of the month
// (lib/recurringTransactions.ts). repeat_monthly: true is kept as shorthand
// for repeat_frequency: 'monthly'.
const createSchema = baseSchema.extend({
  repeat_monthly: z.boolean().optional(),
  repeat_frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
});

const updateSchema = baseSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

/**
 * Shared by POST and PATCH — a category key existing at all isn't enough:
 * custom categories belong to a single account, and an income category
 * can't hold an expense (or vice versa), or reports would mis-total it.
 */
const assertValidCategory = async (categoryKey: string, userId: number, type: 'income' | 'expense') => {
  const [category] = await db
    .select({ type: categories.type })
    .from(categories)
    .where(and(eq(categories.key, categoryKey), or(isNull(categories.userId), eq(categories.userId, userId))));
  if (!category) throw badRequest('Invalid category.');
  if (category.type !== type) throw badRequest(`That category is for ${category.type}, not ${type}.`);
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = monthYearQuery.parse(req.query);
    const conditions = [eq(transactions.userId, req.userId!)];
    // Month/year filters as date ranges so they use idx_transactions_user_date.
    if (q.year != null) {
      const range = q.month != null ? monthsDateRange(q.year, q.month) : monthsDateRange(q.year, 1, q.year, 12);
      conditions.push(gte(transactions.date, range.from), lt(transactions.date, range.toExclusive));
    } else if (q.month != null) {
      conditions.push(eq(transactions.month, q.month)); // that month in any year — rare, unindexed is fine
    }

    // Unfiltered, this is the caller's whole history; capped so one request
    // can't pull an unbounded result set into memory. The app pages through
    // history with GET /transactions/page instead.
    const rows = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(UNFILTERED_LIMIT);
    res.json(rows);
  })
);

// Newest-first page of the user's transactions with optional search and
// filters — what the Transactions screen uses instead of loading everything.
// Keyset pagination on (date, id), served by idx_transactions_user_date.
router.get(
  '/page',
  asyncHandler(async (req, res) => {
    const q = pageQuery.parse(req.query);
    const conditions: SQL[] = [eq(transactions.userId, req.userId!)];
    if (q.type) conditions.push(eq(transactions.type, q.type));
    if (q.category) conditions.push(eq(transactions.category, q.category));
    if (q.from) conditions.push(gte(transactions.date, q.from));
    if (q.to) conditions.push(lte(transactions.date, q.to));
    if (q.cursor) {
      const [cursorDate, cursorId] = q.cursor.split('_');
      conditions.push(sql`(${transactions.date}, ${transactions.id}) < (${cursorDate}::date, ${Number(cursorId)})`);
    }
    if (q.q) {
      const pattern = likeContains(q.q);
      const matches: SQL[] = [ilike(transactions.note, pattern), ilike(transactions.subcategory, pattern), ilike(categories.label, pattern)];
      const asNumber = Number(q.q);
      if (q.q !== '' && Number.isFinite(asNumber)) matches.push(eq(transactions.amount, asNumber));
      conditions.push(or(...matches)!);
    }

    const rows = await db
      .select({ txn: transactions })
      .from(transactions)
      .innerJoin(categories, eq(categories.key, transactions.category))
      .where(and(...conditions))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(q.limit + 1);

    const items = rows.slice(0, q.limit).map((r) => r.txn);
    const last = items[items.length - 1];
    res.json({ items, nextCursor: rows.length > q.limit && last ? `${last.date}_${last.id}` : null });
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

    await assertValidCategory(body.category_key, req.userId!, body.type);
    const repeatFrequency = body.repeat_frequency ?? (body.repeat_monthly ? 'monthly' : undefined);

    if (repeatFrequency) {
      if (NO_REPEAT_CATEGORIES.has(body.category_key)) throw badRequest(NO_REPEAT_MESSAGE);
      // Same guard as POST /recurring, so a double tap can't make every period post twice.
      const [duplicate] = await db
        .select({ id: recurringTransactions.id })
        .from(recurringTransactions)
        .where(
          and(
            eq(recurringTransactions.userId, req.userId!),
            eq(recurringTransactions.type, body.type),
            eq(recurringTransactions.category, body.category_key),
            eq(recurringTransactions.amount, body.amount)
          )
        );
      if (duplicate) throw conflict('An entry with this category and amount already repeats.');
    }

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

      if (repeatFrequency) {
        await tx.insert(recurringTransactions).values({
          userId: req.userId!,
          category: body.category_key,
          type: body.type,
          amount: body.amount,
          note: body.note?.trim() || null,
          ...ruleScheduleFor(body.date, repeatFrequency),
        });
      }
      return created;
    });

    await recomputeBudgetClass(req.userId!);
    res.status(201).json(row);
  })
);

// One payment shared across categories (the Add transaction "Split" switch): a
// separate entry per line so budgets and reports see each category's share,
// all saved together or not at all, and tagged with one split_group.
const splitSchema = z.object({
  type: z.enum(['income', 'expense']),
  date: isoDate(),
  note: optionalText(500),
  total: money(),
  lines: z
    .array(z.object({ category_key: z.string().min(1).max(64), amount: money() }))
    .min(2, 'Split across at least two categories.')
    .max(20, 'At most 20 lines.'),
});

router.post(
  '/split',
  asyncHandler(async (req, res) => {
    const body = splitSchema.parse(req.body);

    const keys = body.lines.map((l) => l.category_key);
    if (new Set(keys).size !== keys.length) throw badRequest('Each category can appear only once.');
    const cents = (n: number) => Math.round(n * 100);
    const linesTotal = body.lines.reduce((s, l) => s + cents(l.amount), 0);
    if (linesTotal !== cents(body.total)) {
      throw badRequest(`The lines add up to ${linesTotal / 100}, but the total is ${body.total}.`);
    }
    for (const l of body.lines) await assertValidCategory(l.category_key, req.userId!, body.type);

    const [y, m] = body.date.split('-').map(Number);
    const splitGroup = crypto.randomUUID();
    const rows = await db
      .insert(transactions)
      .values(
        body.lines.map((l) => ({
          userId: req.userId!,
          category: l.category_key,
          amount: l.amount,
          type: body.type,
          subcategory: null,
          note: body.note ?? null,
          date: body.date,
          month: m,
          year: y,
          splitGroup,
        }))
      )
      .returning();

    await recomputeBudgetClass(req.userId!);
    res.status(201).json({ splitGroup, entries: rows });
  })
);

// A bill the user paid for several people (the "Split with people" option). Only
// the user's own share is spending, so it becomes the one transaction; each
// friend's share is a line in their People ledger ("owes you"). Equal splits are
// worked out in paise, and any leftover paise stay with the user so the parts
// always add up to the total.
const splitPeopleSchema = z.object({
  date: isoDate(),
  note: optionalText(500),
  category_key: z.string().min(1).max(64),
  total: money(),
  method: z.enum(['equal', 'custom']),
  people: z
    .array(z.object({ person_id: z.coerce.number().int().positive(), amount: money().optional() }))
    .min(1, 'Choose at least one person.')
    .max(20, 'At most 20 people.'),
});

router.post(
  '/split-people',
  asyncHandler(async (req, res) => {
    const body = splitPeopleSchema.parse(req.body);
    const ids = body.people.map((p) => p.person_id);
    if (new Set(ids).size !== ids.length) throw badRequest('Each person can appear only once.');
    await assertValidCategory(body.category_key, req.userId!, 'expense');

    const toCents = (n: number) => Math.round(n * 100);
    const totalCents = toCents(body.total);
    let shares: number[];
    if (body.method === 'equal') {
      const friendCents = toCents(splitEqually(body.total, ids.length).friendShare);
      shares = ids.map(() => friendCents);
    } else {
      if (body.people.some((p) => p.amount == null)) throw badRequest("Enter each person's share.");
      shares = body.people.map((p) => toCents(p.amount!));
    }
    const friendsCents = shares.reduce((a, b) => a + b, 0);
    if (friendsCents > totalCents) {
      throw badRequest(`The shares add up to ${friendsCents / 100}, which is more than the total ${body.total}.`);
    }
    if (shares.some((c) => c <= 0)) throw badRequest('Each share must be at least one paisa.');
    const myCents = totalCents - friendsCents;

    const result = await db.transaction(async (tx) => {
      const found = await tx
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(and(eq(people.userId, req.userId!), inArray(people.id, ids)));
      if (found.length !== ids.length) throw notFound('Person not found.');
      const nameOf = new Map(found.map((f) => [f.id, f.name]));
      const [y, m] = body.date.split('-').map(Number);

      let mine = null;
      if (myCents > 0) {
        [mine] = await tx
          .insert(transactions)
          .values({
            userId: req.userId!,
            category: body.category_key,
            amount: myCents / 100,
            type: 'expense',
            subcategory: null,
            note: (body.note ?? `Split with ${ids.map((id) => nameOf.get(id)).join(', ')}`).slice(0, 500),
            date: body.date,
            month: m,
            year: y,
          })
          .returning();
      }

      const [category] = await tx.select({ label: categories.label }).from(categories).where(eq(categories.key, body.category_key));
      const ledgerNote = body.note ?? `Split: ${category?.label ?? 'shared bill'}`;
      await tx.insert(peopleLedger).values(
        ids.map((id, i) => ({
          userId: req.userId!,
          personId: id,
          kind: 'split_share' as const,
          amount: shares[i] / 100,
          date: body.date,
          note: ledgerNote,
          transactionId: mine?.id ?? null,
        }))
      );
      return {
        transaction: mine,
        myShare: myCents / 100,
        shares: ids.map((id, i) => ({ personId: id, name: nameOf.get(id)!, amount: shares[i] / 100 })),
      };
    });

    await recomputeBudgetClass(req.userId!);
    res.status(201).json(result);
  })
);

// Several entries in one all-or-nothing write (the Input Expenses screen):
// either every row is saved or none is, so a failure halfway can't leave a
// partial batch that the user then re-submits as duplicates.
const batchSchema = z.object({ entries: z.array(baseSchema).min(1, 'Add at least one entry.').max(50, 'At most 50 entries at once.') });

router.post(
  '/batch',
  asyncHandler(async (req, res) => {
    const { entries } = batchSchema.parse(req.body);
    for (const e of entries) await assertValidCategory(e.category_key, req.userId!, e.type);

    const rows = await db
      .insert(transactions)
      .values(
        entries.map((e) => {
          const [y, m] = e.date.split('-').map(Number);
          return {
            userId: req.userId!,
            category: e.category_key,
            amount: e.amount,
            type: e.type,
            subcategory: e.subcategory ?? null,
            note: e.note ?? null,
            date: e.date,
            month: m,
            year: y,
          };
        })
      )
      .returning();

    await recomputeBudgetClass(req.userId!);
    res.status(201).json(rows);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = updateSchema.parse(req.body);

    if (body.category_key !== undefined || body.type !== undefined) {
      // Check the pair the row will end up with, not just the fields sent.
      const [current] = await db
        .select({ type: transactions.type, category: transactions.category })
        .from(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, req.userId!)));
      if (!current) throw notFound('Transaction not found.');
      await assertValidCategory(body.category_key ?? current.category, req.userId!, body.type ?? current.type);
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

// `stop_repeat=true` also removes the repeating rule this entry belongs to (same
// type, category and amount), so deleting a repeating entry leaves nothing behind
// — otherwise the rule lives on, keeps posting, and blocks re-adding the entry
// with "already repeats".
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const stopRepeat = req.query.stop_repeat === 'true';
    const deleted = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(transactions)
        .where(and(eq(transactions.id, id), eq(transactions.userId, req.userId!)))
        .returning({ type: transactions.type, category: transactions.category, amount: transactions.amount });
      if (row && stopRepeat) {
        await tx
          .delete(recurringTransactions)
          .where(
            and(
              eq(recurringTransactions.userId, req.userId!),
              eq(recurringTransactions.type, row.type),
              eq(recurringTransactions.category, row.category),
              eq(recurringTransactions.amount, row.amount)
            )
          );
      }
      return row;
    });
    if (!deleted) throw notFound('Transaction not found.');
    // Same as POST/PATCH: removing an expense can change the budget class.
    await recomputeBudgetClass(req.userId!);
    res.status(204).send();
  })
);

export default router;
