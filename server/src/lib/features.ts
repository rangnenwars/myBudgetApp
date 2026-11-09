import { z } from 'zod';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings, userFeatures } from '../db/schema';
import { AppError } from './errors';
import { Access, getAccess } from './access';
import { Plan, getPlan } from './plan';
import { FEATURE_KEYS, FeatureKey, featureLabel } from '../../../constants/features';

export const SIGNUP_FEATURES_KEY = 'signup_features';

export const signupDefaultsSchema = z.object(
  Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>
).strict();
export type SignupDefaults = Record<FeatureKey, boolean>;

const allOff = (): SignupDefaults => Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as SignupDefaults;

/**
 * A feature row counts as on only while status is 'on', staff haven't denied it,
 * and any access period (expires_at) hasn't ended. Checked when read, so lapsed
 * access needs no job to switch it off, and nothing the user saved is touched.
 * This is what a row grants by itself; the plan adds to it (see featuresFor).
 */
export const activeFeature = () =>
  and(eq(userFeatures.status, 'on'), eq(userFeatures.denied, false), or(isNull(userFeatures.expiresAt), gt(userFeatures.expiresAt, sql`now()`)))!;

export interface FeatureRowLite {
  featureKey: FeatureKey;
  status: string;
  source: string;
  denied: boolean;
  expiresAt: Date | null;
}

/**
 * The optional features a user has: the pure rule. Before the plan is
 * enforced it is exactly the old behaviour (any switched-on row). Once
 * enforced, a row only counts when staff set it by hand (source 'admin', for
 * example "Loans for a year"); the old sign-up defaults and grandfathered rows
 * no longer bypass the plan. The plan (trial, paid, exception or company)
 * grants every feature it includes, and a feature staff switched off for this
 * user stays off either way.
 */
export const featuresFor = (rows: FeatureRowLite[], plan: Pick<Plan, 'enforced' | 'features'>, access: Pick<Access, 'state'>, now: Date = new Date()): FeatureKey[] => {
  const byKey = new Map(rows.map((r) => [r.featureKey, r]));
  const rowOn = (r?: FeatureRowLite) => !!r && r.status === 'on' && !r.denied && (r.expiresAt == null || r.expiresAt > now);
  return FEATURE_KEYS.filter((k) => {
    const row = byKey.get(k);
    if (row?.denied) return false;
    if (!plan.enforced) return rowOn(row);
    const manual = rowOn(row) && row?.source === 'admin';
    const viaPlan = access.state !== 'none' && plan.features.includes(k);
    return manual || viaPlan;
  });
};

/** The features switched on for this user. */
export const getUserFeatures = async (userId: number): Promise<FeatureKey[]> => {
  const [rows, plan] = await Promise.all([
    db
      .select({ featureKey: userFeatures.featureKey, status: userFeatures.status, source: userFeatures.source, denied: userFeatures.denied, expiresAt: userFeatures.expiresAt })
      .from(userFeatures)
      .where(eq(userFeatures.userId, userId)),
    getPlan(),
  ]);
  const access = plan.enforced ? await getAccess(userId) : { state: 'none' as const };
  return featuresFor(rows as FeatureRowLite[], plan, access);
};

export const hasFeature = async (userId: number, key: FeatureKey): Promise<boolean> => (await getUserFeatures(userId)).includes(key);

/**
 * What a new account gets at sign-up. A missing or unreadable setting means
 * nothing optional is switched on — never more than staff chose. Features
 * added to the catalog later start off until staff turn them on.
 */
export const getSignupDefaults = async (): Promise<SignupDefaults> => {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SIGNUP_FEATURES_KEY));
  const stored = signupDefaultsSchema.partial().safeParse(row?.value);
  return { ...allOff(), ...(stored.success ? stored.data : {}) };
};

/** Switches on the sign-up defaults for a brand-new account. */
export const applySignupDefaults = async (userId: number): Promise<void> => {
  const defaults = await getSignupDefaults();
  const on = FEATURE_KEYS.filter((k) => defaults[k]);
  if (!on.length) return;
  await db
    .insert(userFeatures)
    .values(on.map((featureKey) => ({ userId, featureKey, status: 'on', source: 'default' })))
    .onConflictDoNothing();
};

export const featureNotAdded = (key: FeatureKey) =>
  new AppError(403, `${featureLabel(key)} isn't on for your account.`, 'FEATURE_NOT_ADDED');
