import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/errors';

// Admin-only surfaces (delete accounts, audit log).
// Runs after requireAuth, which has already confirmed the account exists and
// is active and loaded its role fresh from the database on this request — so a
// role change or deactivation takes effect immediately, with no second lookup.
export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.role !== 'admin') {
    next(forbidden('Admin access required.'));
    return;
  }
  next();
};
