import { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorized } from '../lib/errors';
import { asyncHandler } from '../lib/asyncHandler';

const SYSTEM_METRICS_ROLES = new Set(['admin', 'system_manager']);

// Gate for the read-only, aggregate-only surface (GET /system/metrics).
// Deliberately separate from requireStaff/requireAdmin: a system_manager
// never gets access to the per-account list or its actions, and this route
// never selects a row from transactions/loans/investments/goals — counts
// and dates only. Same fresh-DB-lookup reasoning as requireAdmin.ts.
export const requireSystemManager = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const [user] = await db.select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, req.userId!));
  if (!user || !user.isActive) throw unauthorized('Account no longer active.');
  if (!SYSTEM_METRICS_ROLES.has(user.role)) throw forbidden('System manager access required.');
  req.role = user.role;
  next();
});
