import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, count } from 'drizzle-orm';
import { db } from '../db/client';
import { savingsGoals } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { notFound } from '../lib/errors';

const router = Router();
router.use(requireAuth);

const GOAL_COLORS = ['#10B981', '#60A5FA', '#F59E0B', '#A78BFA', '#F472B6'];

const createSchema = z.object({
  name: z.string().trim().min(1),
  target_amount: z.coerce.number().positive(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    target_amount: z.coerce.number().positive().optional(),
    saved_amount: z.coerce.number().min(0).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(savingsGoals).where(eq(savingsGoals.userId, req.userId!)).orderBy(desc(savingsGoals.id));
    res.json(rows);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [{ existing }] = await db.select({ existing: count() }).from(savingsGoals).where(eq(savingsGoals.userId, req.userId!));

    const [row] = await db
      .insert(savingsGoals)
      .values({
        userId: req.userId!,
        name: body.name,
        target_amount: body.target_amount,
        color: GOAL_COLORS[existing % GOAL_COLORS.length],
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

    const updateData: Partial<typeof savingsGoals.$inferInsert> = { updated_at: new Date() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.target_amount !== undefined) updateData.target_amount = body.target_amount;
    if (body.saved_amount !== undefined) updateData.saved_amount = body.saved_amount;

    const [row] = await db
      .update(savingsGoals)
      .set(updateData)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, req.userId!)))
      .returning();
    if (!row) throw notFound('Goal not found.');
    res.json(row);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [deleted] = await db
      .delete(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, req.userId!)))
      .returning({ id: savingsGoals.id });
    if (!deleted) throw notFound('Goal not found.');
    res.status(204).send();
  })
);

export default router;
