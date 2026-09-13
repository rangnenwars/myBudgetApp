import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';

// Runs after requireAuth. Looks the role up fresh from the database on
// every request (rather than trusting a JWT claim) so a role change or
// deactivation via PATCH /admin/users/:id takes effect immediately on the
// low-traffic admin surface, instead of waiting for the access token to expire.
export const requireAdmin = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const [user] = await db.select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, req.userId!));
  if (!user || !user.isActive) throw unauthorized('Account no longer active.');
  if (user.role !== 'admin') throw forbidden('Admin access required.');
  req.role = user.role;
  next();
});
