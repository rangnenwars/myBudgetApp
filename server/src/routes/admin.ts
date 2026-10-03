import { Router } from 'express';
import { z } from 'zod';
import { count, desc, eq, ilike, or } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam, likeContains } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { requireStaff } from '../middleware/requireStaff';
import { recordAdminAction } from '../lib/auditLog';
import { revokeAllRefreshTokens } from '../lib/session';
import { badRequest, notFound, forbidden } from '../lib/errors';

const router = Router();
router.use(requireAuth);

const patchSchema = z
  .object({
    role: z.enum(['user', 'admin', 'support', 'system_manager']).optional(),
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
  deactivatedAt: user.deactivatedAt,
  lastLoginAt: user.lastLoginAt,
  emailVerified: user.emailVerifiedAt != null,
});

const getActorEmail = async (actorId: number) => {
  const [actor] = await db.select({ email: users.email }).from(users).where(eq(users.id, actorId));
  return actor?.email ?? 'unknown';
};

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

// Newest accounts first, one page at a time, optionally filtered by a name or
// email search done in the database — the list never loads every account.
// X-Total-Count carries how many match in all.
router.get(
  '/',
  requireStaff,
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const where = q.q ? or(ilike(users.name, likeContains(q.q)), ilike(users.email, likeContains(q.q))) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select().from(users).where(where).orderBy(desc(users.createdAt), desc(users.id)).limit(q.limit).offset(q.offset),
      db.select({ total: count() }).from(users).where(where),
    ]);
    res.setHeader('X-Total-Count', String(total));
    res.json(rows.map(toAdminUserResponse));
  })
);

router.patch(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    if (id === req.userId) throw badRequest('Use your own account to change your own settings.');

    const body = patchSchema.parse(req.body);

    // Support can only flip isActive — never role or tier. Checked after
    // the zod parse (so a malformed body still fails as a 400 first) but
    // before touching the database.
    if (req.role === 'support' && (body.role !== undefined || body.tier !== undefined)) {
      throw forbidden('Support accounts can only activate or deactivate a user.');
    }

    const [target] = await db.select({ id: users.id, email: users.email, role: users.role, tier: users.tier, isActive: users.isActive }).from(users).where(eq(users.id, id));
    if (!target) throw notFound('User not found.');
    // Support can't touch other staff — otherwise it could lock out an admin.
    if (req.role === 'support' && target.role !== 'user') {
      throw forbidden('Support accounts can only activate or deactivate regular users.');
    }

    const patch: Partial<typeof users.$inferInsert> = { ...body, updatedAt: new Date() };
    if (body.isActive !== undefined) {
      patch.deactivatedAt = body.isActive ? null : new Date();
    }

    const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
    // Deactivation ends every session now, not when tokens expire.
    if (body.isActive === false) await revokeAllRefreshTokens(id);

    const changes: string[] = [];
    if (body.role !== undefined) changes.push(`role: ${target.role} -> ${body.role}`);
    if (body.tier !== undefined) changes.push(`tier: ${target.tier} -> ${body.tier}`);
    if (body.isActive !== undefined) changes.push(`isActive: ${target.isActive} -> ${body.isActive}`);
    await recordAdminAction({
      actorId: req.userId!,
      actorEmail: await getActorEmail(req.userId!),
      targetId: id,
      targetEmail: target.email,
      action: 'account_updated',
      details: changes.join(', '),
    });

    res.json(toAdminUserResponse(updated));
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    if (id === req.userId) throw badRequest('You cannot delete your own account.');

    const [target] = await db.select({ id: users.id, email: users.email, role: users.role }).from(users).where(eq(users.id, id));
    if (!target) throw notFound('User not found.');

    // Logged before the delete, not after: targetId is a real FK
    // (ON DELETE SET NULL) — it has to reference a row that still exists
    // at insert time. Postgres nulls it out automatically once the delete
    // below fires; targetEmail keeps the entry readable either way.
    await recordAdminAction({
      actorId: req.userId!,
      actorEmail: await getActorEmail(req.userId!),
      targetId: id,
      targetEmail: target.email,
      action: 'account_deleted',
      details: `role was: ${target.role}`,
    });

    await db.delete(users).where(eq(users.id, id));

    res.status(204).send();
  })
);

export default router;
