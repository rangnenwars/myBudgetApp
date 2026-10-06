import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../lib/errors';

// Feature access (routes/adminFeatures.ts): admin and system_manager decide
// which user gets which optional feature; support can see it but not change it.
const VIEW_ROLES = new Set(['admin', 'system_manager', 'support']);
const MANAGE_ROLES = new Set(['admin', 'system_manager']);

// Runs after requireAuth, which loaded the role fresh from the database on
// this request — so a role change takes effect immediately.
export const requireFeatureViewer = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.role || !VIEW_ROLES.has(req.role)) {
    next(forbidden('Staff access required.'));
    return;
  }
  next();
};

export const requireFeatureManager = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.role || !MANAGE_ROLES.has(req.role)) {
    next(forbidden('Only an admin or system manager can change feature access.'));
    return;
  }
  next();
};
