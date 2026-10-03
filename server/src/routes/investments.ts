import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { investments } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam, money, MAX_AMOUNT } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { notFound } from '../lib/errors';
import { localToday } from '../lib/clock';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(40),
  amount: money(),
  // Can't be negative — an investment's worst case is worth nothing.
  current_value: z.coerce.number().min(0).max(MAX_AMOUNT, 'Amount is too large.').nullish(),
});

const updateSchema = createSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(investments).where(eq(investments.userId, req.userId!)).orderBy(desc(investments.id));
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    // Server owns the derived gain % — never trust a client-computed value for money math.
    const currentValue = body.current_value ?? body.amount;
    const returnsPercent = body.amount > 0 ? ((currentValue - body.amount) / body.amount) * 100 : 0;

    const [row] = await db
      .insert(investments)
      .values({
        userId: req.userId!,
        name: body.name,
        type: body.type,
        amount: body.amount,
        current_value: currentValue,
        returns_percent: returnsPercent,
        start_date: localToday().iso,
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

    const [existing] = await db.select().from(investments).where(and(eq(investments.id, id), eq(investments.userId, req.userId!)));
    if (!existing) throw notFound('Investment not found.');

    // Recomputed from whichever of amount/current_value actually changed —
    // never accepted from the client, same rule as POST.
    const amount = body.amount ?? existing.amount;
    const currentValue = body.current_value !== undefined ? (body.current_value ?? amount) : existing.current_value ?? amount;
    const returnsPercent = amount > 0 ? ((currentValue - amount) / amount) * 100 : 0;

    const updateData: Partial<typeof investments.$inferInsert> = { updated_at: new Date(), current_value: currentValue, returns_percent: returnsPercent };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.type !== undefined) updateData.type = body.type;
    if (body.amount !== undefined) updateData.amount = body.amount;

    const [row] = await db.update(investments).set(updateData).where(eq(investments.id, id)).returning();
    res.json(row);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const [deleted] = await db
      .delete(investments)
      .where(and(eq(investments.id, id), eq(investments.userId, req.userId!)))
      .returning({ id: investments.id });
    if (!deleted) throw notFound('Investment not found.');
    res.status(204).send();
  })
);

export default router;
