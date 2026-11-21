import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { tourOutcomes } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { num } from '../lib/validation';
import { requireAuth } from '../middleware/auth';

// How the first-time tour ended for the signed-in person. Counts only, for System metrics: it never
// stores what anyone did in the app. The first outcome for a person is kept; replays record nothing.
const router = Router();
router.use(requireAuth);

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
