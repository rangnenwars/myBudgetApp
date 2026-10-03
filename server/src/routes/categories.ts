import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { budgets, categories } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { forbidden, notFound, conflict } from '../lib/errors';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40, 'Keep it under 40 characters'),
  type: z.enum(['income', 'expense']),
});

const renameSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40, 'Keep it under 40 characters'),
});

// A handful of colors to rotate through for custom categories, distinct
// from any single system category's color so a new one doesn't visually
// blend into an existing group.
const CUSTOM_PALETTE = ['#F472B6', '#60A5FA', '#34D399', '#FBBF24', '#A78BFA', '#F87171', '#38BDF8', '#FB923C'];

const toResponse = (row: typeof categories.$inferSelect) => ({
  key: row.key,
  label: row.label,
  icon: row.icon,
  color: row.color,
  group: row.group,
  type: row.type,
  isCustom: row.userId != null,
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(categories)
      .where(or(isNull(categories.userId), eq(categories.userId, req.userId!)))
      .orderBy(categories.id);
    res.json(rows.map(toResponse));
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);

    const [existing] = await db
      .select({ key: categories.key })
      .from(categories)
      .where(
        and(
          or(isNull(categories.userId), eq(categories.userId, req.userId!)),
          eq(categories.type, body.type),
          sql`lower(${categories.label}) = lower(${body.name})`
        )
      );
    if (existing) throw conflict(`"${body.name}" already exists.`);

    const key = `custom_${crypto.randomBytes(4).toString('hex')}`;
    const color = CUSTOM_PALETTE[Math.floor(Math.random() * CUSTOM_PALETTE.length)];

    const [row] = await db
      .insert(categories)
      .values({
        key,
        label: body.name,
        icon: '🏷️',
        color,
        group: 'Custom',
        type: body.type,
        userId: req.userId!,
      })
      .returning();

    res.status(201).json(toResponse(row));
  })
);

router.patch(
  '/:key',
  asyncHandler(async (req, res) => {
    const body = renameSchema.parse(req.body);
    const [row] = await db.select().from(categories).where(eq(categories.key, req.params.key));
    if (!row || (row.userId != null && row.userId !== req.userId)) throw notFound('Category not found.');
    if (row.userId == null) throw forbidden('System categories cannot be renamed.');

    // Same duplicate rule as POST: no two visible categories of one type share a name.
    const [clash] = await db
      .select({ key: categories.key })
      .from(categories)
      .where(
        and(
          or(isNull(categories.userId), eq(categories.userId, req.userId!)),
          eq(categories.type, row.type),
          sql`lower(${categories.label}) = lower(${body.name})`,
          ne(categories.key, row.key)
        )
      );
    if (clash) throw conflict(`"${body.name}" already exists.`);

    // The key (and therefore every transaction referencing it) is untouched —
    // only the display label changes.
    const [updated] = await db.update(categories).set({ label: body.name }).where(eq(categories.key, row.key)).returning();
    res.json(toResponse(updated));
  })
);

router.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(categories).where(eq(categories.key, req.params.key));
    if (!row || (row.userId != null && row.userId !== req.userId)) throw notFound('Category not found.');
    if (row.userId == null) throw forbidden('System categories cannot be deleted.');

    try {
      // A spending limit on the category goes with it; rolled back if the
      // category turns out to be in use and can't be deleted.
      await db.transaction(async (tx) => {
        await tx.delete(budgets).where(and(eq(budgets.userId, req.userId!), eq(budgets.categoryKey, row.key)));
        await tx.delete(categories).where(eq(categories.key, row.key));
      });
    } catch (err) {
      // Postgres foreign_key_violation — the category is still referenced
      // by at least one of the user's own transactions. Drizzle wraps the
      // real pg error (with .code) inside a DrizzleQueryError's .cause.
      const pgCode = (err as { code?: string; cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
      if (pgCode === '23503') {
        throw conflict('This category is used by existing transactions or repeating entries and cannot be deleted.');
      }
      throw err;
    }
    res.status(204).send();
  })
);

export default router;
