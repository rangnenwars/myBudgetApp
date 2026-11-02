import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { autoPostMiddleware } from '../lib/autoPost';
import { getForecast } from '../lib/forecast';

// Plan ahead: the next 12 months from repeating entries, loans and recent
// spending. Read-only; only for users an admin has switched it on for.
const router = Router();
router.use(requireAuth, requireFeature('forecast'), autoPostMiddleware);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getForecast(req.userId!));
  })
);

export default router;
