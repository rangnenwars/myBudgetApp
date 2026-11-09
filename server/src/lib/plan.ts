import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { FEATURE_KEYS, FeatureKey } from '../../../constants/features';

// The paid plan's settings, kept in app_settings so an admin changes them from
// the app, not a redeploy. A missing or unreadable value means the defaults:
// ₹200 a year, six months free, and NOTHING ENFORCED, so a fresh install or a
// bad row can never lock anyone out.

export const PLAN_KEY = 'plan';

export const planSchema = z.object({
  price_inr: z.number().positive().max(100_000),
  period: z.enum(['month', 'year']),
  /** Free full access for a new account, counted from its own sign-up. */
  trial_months: z.number().int().min(1).max(36),
  /** How long before access ends an existing user must have been told. */
  notice_days: z.number().int().min(7).max(180),
  /** Optional features the plan includes. Pro insights always go with the plan. */
  features: z.array(z.enum(FEATURE_KEYS)),
  /** While false, nobody is locked: access works as it did before the plan existed. */
  enforced: z.boolean(),
  enforced_at: z.string().nullable(),
  /** When existing users were last sent the "your free access ends on" notice. */
  existing_notice_at: z.string().nullable(),
});
export type Plan = z.infer<typeof planSchema>;

/** The fields an admin edits on the Plan and pricing page. */
export const planEditSchema = planSchema.pick({ price_inr: true, period: true, trial_months: true, notice_days: true, features: true }).strict();

export const DEFAULT_PLAN: Plan = {
  price_inr: 200,
  period: 'year',
  trial_months: 6,
  notice_days: 30,
  features: [...FEATURE_KEYS],
  enforced: false,
  enforced_at: null,
  existing_notice_at: null,
};

let cache: { at: number; plan: Plan } | null = null;
const CACHE_MS = 5000;

/** Forget the cached plan, so the next read sees a change made in this process (or directly in the database, in tests). */
export const clearPlanCache = () => {
  cache = null;
};

export const getPlan = async (): Promise<Plan> => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.plan;
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PLAN_KEY));
  const stored = planSchema.partial().safeParse(row?.value);
  const plan: Plan = { ...DEFAULT_PLAN, ...(stored.success ? stored.data : {}) };
  cache = { at: Date.now(), plan };
  return plan;
};

export const savePlan = async (patch: Partial<Plan>, updatedBy: number): Promise<Plan> => {
  const next: Plan = { ...(await getPlan()), ...patch };
  await db
    .insert(appSettings)
    .values({ key: PLAN_KEY, value: next, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedBy, updatedAt: new Date() } });
  clearPlanCache();
  return next;
};

/** "₹200 / year" */
export const planPriceLabel = (plan: Pick<Plan, 'price_inr' | 'period'>): string =>
  `₹${plan.price_inr.toLocaleString('en-IN', { maximumFractionDigits: 2 })} / ${plan.period}`;

export type { FeatureKey };
