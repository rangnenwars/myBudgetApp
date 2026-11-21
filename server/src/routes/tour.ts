import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { tourOutcomes, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { num } from '../lib/validation';
import { requireAuth } from '../middleware/auth';

// How the first-time tour ended for the signed-in person. Counts only, for System metrics: it never
// stores what anyone did in the app. The first outcome for a person is kept; replays record nothing.
const router = Router();
router.use(requireAuth);

/** A new account sees the tour at its first sign-ins for this many days, on any device, until it has an outcome. */
export const TOUR_WINDOW_DAYS = 7;

// Whether this person should be shown the first-time tour: a customer account made in the last 7 days
// that has not finished or skipped it yet. The server decides so it works on any device, not only the one
// that signed up.
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const [me] = await db.select({ createdAt: users.createdAt, accountKind: users.accountKind }).from(users).where(eq(users.id, req.userId!));
    const [done] = await db.select({ userId: tourOutcomes.userId }).from(tourOutcomes).where(eq(tourOutcomes.userId, req.userId!));
    const recent = !!me && Date.now() - me.createdAt.getTime() < TOUR_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    res.json({ pending: !!me && me.accountKind === 'customer' && recent && !done });
  })
);

const outcomeSchema = z.object({
  outcome: z.enum(['finished', 'skipped']),
  step: num((n) => n.int().min(1).max(20)),
  language: z.enum(['en', 'hi']).default('en'),
});

router.post(
  '/outcome',
  asyncHandler(async (req, res) => {
    const body = outcomeSchema.parse(req.body);
    const rows = await db
      .insert(tourOutcomes)
      .values({ userId: req.userId!, outcome: body.outcome, step: body.step, language: body.language })
      .onConflictDoNothing()
      .returning({ userId: tourOutcomes.userId });
    res.status(rows.length ? 201 : 200).json({ recorded: rows.length > 0 });
  })
);

export default router;
