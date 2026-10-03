import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/errors';

const STAFF_ROLES = new Set(['admin', 'support']);

// Account-management surface (GET/PATCH /admin/users), shared by admin and support;
// support is restricted to a subset of PATCH fields at the route level (routes/admin.ts).
// Runs after requireAuth, which has already confirmed the account exists and
// is active and loaded its role fresh from the database on this request — so a
// role change or deactivation takes effect immediately, with no second lookup.
export const requireStaff = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.role || !STAFF_ROLES.has(req.role)) {
    next(forbidden('Staff access required.'));
    return;
  }
  next();
};
