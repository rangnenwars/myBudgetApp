import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { badRequest, notFound } from '../lib/errors';

const router = Router();
router.use(requireAuth, requireAdmin);

const patchSchema = z
  .object({
    role: z.enum(['user', 'admin']).optional(),
    isActive: z.boolean().optional(),
    tier: z.enum(['standard', 'pro']).optional(),
  })
  .refine((b) => b.role !== undefined || b.isActive !== undefined || b.tier !== undefined, {
    message: 'Provide at least one of role, isActive, tier.',
  });

const toAdminUserResponse = (user: typeof users.$inferSelect) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  tier: user.tier,
  isActive: user.isActive,
  budgetClass: user.budgetClass,
  createdAt: user.createdAt,
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(users).orderBy(users.createdAt);
    res.json(rows.map(toAdminUserResponse));
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.userId) throw badRequest('Use your own account to change your own settings.');

    const body = patchSchema.parse(req.body);
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (!target) throw notFound('User not found.');

    const [updated] = await db
      .update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    res.json(toAdminUserResponse(updated));
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.userId) throw badRequest('You cannot delete your own account.');

    const [deleted] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    if (!deleted) throw notFound('User not found.');
    res.status(204).send();
  })
);

export default router;
