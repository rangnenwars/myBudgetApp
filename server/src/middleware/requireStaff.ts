import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';

const STAFF_ROLES = new Set(['admin', 'support']);

// Gate for the account-management surface (GET/PATCH /admin/users), shared
// by admin and support alike — support is restricted to a subset of PATCH
// fields at the route level (routes/admin.ts), not here. Same fresh-DB-
// lookup reasoning as requireAdmin.ts: a role change or deactivation takes
// effect immediately instead of waiting for the access token to expire.
export const requireStaff = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const [user] = await db.select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, req.userId!));
  if (!user || !user.isActive) throw unauthorized('Account no longer active.');
  if (!STAFF_ROLES.has(user.role)) throw forbidden('Staff access required.');
  req.role = user.role;
  next();
});
