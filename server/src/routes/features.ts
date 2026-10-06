import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { issueReports, userFeatures } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { FEATURES, FEATURE_KEYS, featureLabel } from '../../../constants/features';

// The signed-in user's own view of the optional features. They can't switch
// anything here — staff decide (routes/adminFeatures.ts) — only see what's on
// and ask for a feature they don't have.
const router = Router();
router.use(requireAuth);

const keyParam = z.object({ key: z.enum(FEATURE_KEYS) });

const loadOwn = async (userId: number) => {
  const rows = await db.select().from(userFeatures).where(eq(userFeatures.userId, userId));
  const byKey = new Map(rows.map((r) => [r.featureKey, r]));
  return FEATURES.map((f) => {
    const row = byKey.get(f.key);
    const on = row?.status === 'on';
    return { key: f.key, label: f.label, description: f.description, on, requested: !on && row?.requestedAt != null };
  });
};

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await loadOwn(req.userId!));
  })
);

// One request per feature: asking again while one is waiting changes nothing.
// The request is also filed as a "Report a problem" entry so it reaches staff
// in the nightly digest; switching the feature on or refusing it closes that entry.
router.post(
  '/:key/request',
  asyncHandler(async (req, res) => {
    const { key } = keyParam.parse(req.params);
    const userId = req.userId!;

    await db.transaction(async (tx) => {
      // Make sure a row exists to lock, so two taps at once can't file two requests.
      await tx.insert(userFeatures).values({ userId, featureKey: key, status: 'off', source: 'request' }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(userFeatures)
        .where(and(eq(userFeatures.userId, userId), eq(userFeatures.featureKey, key)))
        .for('update');
      if (row?.status === 'on' || row?.requestedAt) return;

      const label = featureLabel(key);
      const [issue] = await tx
        .insert(issueReports)
        .values({
          userId,
          category: 'other',
          severity: 'low',
          screen: key,
          title: `Access request: ${label}`,
          description: `Asked for ${label} to be switched on for their account.`,
        })
        .returning({ id: issueReports.id });

      const now = new Date();
      await tx
        .update(userFeatures)
        .set({ requestedAt: now, requestIssueId: issue.id, updatedAt: now })
        .where(and(eq(userFeatures.userId, userId), eq(userFeatures.featureKey, key)));
    });

    const features = await loadOwn(userId);
    res.json(features.find((f) => f.key === key));
  })
);

export default router;
