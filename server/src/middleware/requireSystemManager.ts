import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/errors';

const SYSTEM_METRICS_ROLES = new Set(['admin', 'system_manager']);

// Read-only, aggregate-only surface (GET /system/metrics) — never the per-account list.
// Runs after requireAuth, which has already confirmed the account exists and
// is active and loaded its role fresh from the database on this request — so a
// role change or deactivation takes effect immediately, with no second lookup.
export const requireSystemManager = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.role || !SYSTEM_METRICS_ROLES.has(req.role)) {
    next(forbidden('System manager access required.'));
    return;
  }
  next();
};
