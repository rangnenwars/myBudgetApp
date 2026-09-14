import { Router } from 'express';
import { z } from 'zod';
import { and, eq, desc, count } from 'drizzle-orm';
import { db } from '../db/client';
import { savingsGoals, goalContributions } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { notFound, badRequest } from '../lib/errors';

const router = Router();
router.use(requireAuth);

const GOAL_COLORS = ['#10B981', '#60A5FA', '#F59E0B', '#A78BFA', '#F472B6'];

const deadlineSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'deadline must be YYYY-MM-DD').nullable().optional();

const createSchema = z.object({
  name: z.string().trim().min(1),
  target_amount: z.coerce.number().positive(),
  deadline: deadlineSchema,
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    target_amount: z.coerce.number().positive().optional(),
    saved_amount: z.coerce.number().min(0).optional(),
    deadline: deadlineSchema,
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Provide at least one field to update.' });

const contributionSchema = z.object({
  amount: z.coerce.number().positive(),
  type: z.enum(['add', 'remove']),
});

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
        deadline: body.deadline ?? null,
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
    if (body.deadline !== undefined) updateData.deadline = body.deadline ?? null;

    const [row] = await db
      .update(savingsGoals)
      .set(updateData)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, req.userId!)))
      .returning();
    if (!row) throw notFound('Goal not found.');
    res.json(row);
  })
);

// Adds or removes funds from a goal and records the action, atomically, so
// saved_amount and its history never drift apart. A 'remove' that would
// take saved_amount below zero is rejected here with a clear message
// instead of falling through to the DB's raw check-constraint error.
router.post(
  '/:id/contributions',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = contributionSchema.parse(req.body);

    const result = await db.transaction(async (tx) => {
      const [goal] = await tx
        .select()
        .from(savingsGoals)
        .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, req.userId!)));
      if (!goal) throw notFound('Goal not found.');

      const nextSaved = body.type === 'add' ? goal.saved_amount + body.amount : goal.saved_amount - body.amount;
      if (nextSaved < 0) {
        throw badRequest(`You can remove at most the amount currently saved (${goal.saved_amount}).`);
      }

      const [updatedGoal] = await tx
        .update(savingsGoals)
        .set({ saved_amount: nextSaved, updated_at: new Date() })
        .where(eq(savingsGoals.id, id))
        .returning();

      const [contribution] = await tx
        .insert(goalContributions)
        .values({ userId: req.userId!, goal_id: id, amount: body.amount, type: body.type })
        .returning();

      return { goal: updatedGoal, contribution };
    });

    res.status(201).json(result);
  })
);

router.get(
  '/:id/contributions',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [goal] = await db
      .select({ id: savingsGoals.id })
      .from(savingsGoals)
      .where(and(eq(savingsGoals.id, id), eq(savingsGoals.userId, req.userId!)));
    if (!goal) throw notFound('Goal not found.');

    const rows = await db
      .select()
      .from(goalContributions)
      .where(eq(goalContributions.goal_id, id))
      .orderBy(desc(goalContributions.created_at));
    res.json(rows);
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
