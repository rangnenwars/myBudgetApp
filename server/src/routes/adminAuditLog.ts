import { Router } from 'express';
import { desc } from 'drizzle-orm';
import { db } from '../db/client';
import { adminAuditLog } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';

const router = Router();
router.use(requireAuth, requireAdmin);

// Admin-only, not support — this is a record of what staff did, not an
// account-management action itself. Account metadata only (actor/target
// email, which field changed), never anything from transactions/loans/
// investments/goals.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(100);
    res.json(rows);
  })
);

export default router;
