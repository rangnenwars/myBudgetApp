import { Router } from 'express';
import { z } from 'zod';
import { desc, lt } from 'drizzle-orm';
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
const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  // id of the last entry already shown; the next page is older than it.
  before: z.coerce.number().int().positive().optional(),
});

// Newest first, a page at a time (keyset on id, which grows with createdAt).
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = pageQuery.parse(req.query);
    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(q.before ? lt(adminAuditLog.id, q.before) : undefined)
      .orderBy(desc(adminAuditLog.id))
      .limit(q.limit);
    res.json(rows);
  })
);

export default router;
