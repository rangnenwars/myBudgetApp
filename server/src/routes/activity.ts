import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { userActivity, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { ACTIVITY_RETENTION_DAYS, MAX_PAGES_PER_BATCH, recordPages } from '../lib/activity';
import { requireAuth } from '../middleware/auth';
import { activityLimiter } from '../middleware/rateLimit';

// What the app reports about itself, and what each person can see of their own sign-ins.
const router = Router();
router.use(requireAuth);

const pagesSchema = z.object({
  pages: z
    .array(z.object({ path: z.string().max(200), at: z.string().max(40).optional() }))
    .min(1)
    .max(MAX_PAGES_PER_BATCH, `At most ${MAX_PAGES_PER_BATCH} at a time.`),
});

// The app batches the pages a person opened and sends them every so often. Only known page patterns are kept
// (lib/activity.ts); the rest is dropped and counted. A person who has switched sharing off records nothing.
router.post(
  '/pages',
  activityLimiter,
  asyncHandler(async (req, res) => {
    const body = pagesSchema.parse(req.body);
    const [me] = await db.select({ share: users.shareActivity }).from(users).where(eq(users.id, req.userId!));
    if (!me?.share) {
      res.json({ recorded: 0, dropped: body.pages.length, sharing: false });
      return;
    }
    const result = await recordPages(req.userId!, req, body.pages);
    res.json({ ...result, sharing: true });
  })
);

// My sign-in history: sign-ins and sign-outs on my own account, newest first, so I can spot a stranger.
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({ kind: userActivity.kind, platform: userActivity.platform, location: userActivity.location, detail: userActivity.detail, at: userActivity.createdAt })
      .from(userActivity)
      .where(and(eq(userActivity.userId, req.userId!), inArray(userActivity.kind, ['login', 'logout']), gte(userActivity.createdAt, since)))
      .orderBy(desc(userActivity.createdAt), desc(userActivity.id))
      .limit(200);
    res.json(rows);
  })
);

export default router;
