import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { issueReports, userFeatures } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { activeFeature } from '../lib/features';
import { FEATURES, FEATURE_KEYS, featureLabel, featurePrice, priceLabel } from '../../../constants/features';

// The signed-in user's own view of the optional features. They can't switch
// anything here — staff decide (routes/adminFeatures.ts) — only see what's on
// and ask for a feature they don't have.
const router = Router();
router.use(requireAuth);

const keyParam = z.object({ key: z.enum(FEATURE_KEYS) });
const requestBody = z.object({ paid: z.boolean().optional() }).default({});

// Where a user pays for a priced feature (UPI id). Unset = they're told to ask their admin.
const paymentUpiId = () => process.env.PAYMENT_UPI_ID?.trim() || null;

const loadOwn = async (userId: number) => {
  const rows = await db.select({ row: userFeatures, active: sql<boolean>`(${activeFeature()})` }).from(userFeatures).where(eq(userFeatures.userId, userId));
  const byKey = new Map(rows.map((r) => [r.row.featureKey, r]));
  return FEATURES.map((f) => {
    const found = byKey.get(f.key);
    const on = found?.active === true;
    return {
      key: f.key,
      label: f.label,
      description: f.description,
      price: f.price,
      period: f.period,
      upiId: f.price > 0 ? paymentUpiId() : null,
      on,
      // When the paid period ends; null for access with no end.
      expiresAt: on ? found?.row.expiresAt ?? null : null,
      // Access that was on and has run out: shown as "Access ended", can be asked for again.
      ended: !on && found?.row.status === 'on',
      requested: !on && found?.row.requestedAt != null,
    };
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
    const { paid } = requestBody.parse(req.body);

    await db.transaction(async (tx) => {
      // Make sure a row exists to lock, so two taps at once can't file two requests.
      await tx.insert(userFeatures).values({ userId, featureKey: key, status: 'off', source: 'request' }).onConflictDoNothing();
      const [row] = await tx
        .select()
        .from(userFeatures)
        .where(and(eq(userFeatures.userId, userId), eq(userFeatures.featureKey, key)))
        .for('update');
      const [{ n }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(userFeatures)
        .where(and(eq(userFeatures.userId, userId), eq(userFeatures.featureKey, key), activeFeature()));
      if (n > 0 || row?.requestedAt) return;

      const label = featureLabel(key);
      const price = featurePrice(key);
      const [issue] = await tx
        .insert(issueReports)
        .values({
          userId,
          category: 'other',
          severity: 'low',
          screen: key,
          title: `Access request: ${label}`,
          description: paid
            ? `Asked for ${label} to be switched on for their account, and says they paid (${priceLabel(price.price, price.period)}). Check the payment before switching on.`
            : `Asked for ${label} to be switched on for their account.`,
        })
        .returning({ id: issueReports.id });

      const now = new Date();
      await tx
        .update(userFeatures)
        .set({ requestedAt: now, requestIssueId: issue.id, requestPaid: paid === true, updatedAt: now })
        .where(and(eq(userFeatures.userId, userId), eq(userFeatures.featureKey, key)));
    });

    const features = await loadOwn(userId);
    res.json(features.find((f) => f.key === key));
  })
);

export default router;
