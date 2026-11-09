import { Router } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { issueReports, userFeatures } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { activeFeature, getUserFeatures } from '../lib/features';
import { getAccess } from '../lib/access';
import { getPlan } from '../lib/plan';
import { loadPaymentDetails } from '../lib/paymentDetails';
import { FEATURES, FEATURE_KEYS, featureLabel, featurePrice, priceLabel } from '../../../constants/features';

// The signed-in user's own view of the optional features. They can't switch
// anything here — staff decide (routes/adminFeatures.ts) — only see what's on
// and ask for a feature they don't have.
const router = Router();
router.use(requireAuth);

const keyParam = z.object({ key: z.enum(FEATURE_KEYS) });
const requestBody = z.object({ paid: z.boolean().optional() }).default({});

const loadOwn = async (userId: number) => {
  const [rows, effective, plan, access, payment] = await Promise.all([
    db.select().from(userFeatures).where(eq(userFeatures.userId, userId)),
    getUserFeatures(userId),
    getPlan(),
    getAccess(userId),
    loadPaymentDetails(),
  ]);
  const byKey = new Map(rows.map((r) => [r.featureKey, r]));
  const on = new Set(effective);
  return FEATURES.map((f) => {
    const found = byKey.get(f.key);
    const isOn = on.has(f.key);
    // Included through the plan: it ends when the plan does. Switched on by hand: its own end date.
    const viaPlan = plan.enforced && access.state !== 'none' && plan.features.includes(f.key) && !(found?.source === 'admin' && found.status === 'on' && !found.denied && (found.expiresAt == null || found.expiresAt > new Date()));
    return {
      key: f.key,
      label: f.label,
      description: f.description,
      // The plan's price: one price covers every feature, set by an admin.
      price: plan.price_inr,
      period: plan.period,
      upiId: payment?.upiId ?? null,
      on: isOn,
      // When access ends; null for no end.
      expiresAt: isOn ? (viaPlan ? access.until : found?.expiresAt ?? null) : null,
      // Access that was on and has run out: shown as "Access ended", can be asked for again.
      ended: !isOn && (found?.status === 'on' || (plan.enforced && access.state === 'none' && access.endedOn != null)),
      requested: !isOn && found?.requestedAt != null,
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
    // Already included (a running plan, or switched on by staff): nothing to ask for.
    if ((await getUserFeatures(userId)).includes(key)) {
      res.json((await loadOwn(userId)).find((f) => f.key === key));
      return;
    }

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
