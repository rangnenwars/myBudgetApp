import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { appSettings, userFeatures } from '../db/schema';
import { AppError } from './errors';
import { FEATURE_KEYS, FeatureKey, featureLabel } from '../../../constants/features';

export const SIGNUP_FEATURES_KEY = 'signup_features';

export const signupDefaultsSchema = z.object(
  Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>
).strict();
export type SignupDefaults = Record<FeatureKey, boolean>;

const allOff = (): SignupDefaults => Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as SignupDefaults;

/** The features switched on for this user. */
export const getUserFeatures = async (userId: number): Promise<FeatureKey[]> => {
  const rows = await db
    .select({ key: userFeatures.featureKey })
    .from(userFeatures)
    .where(and(eq(userFeatures.userId, userId), eq(userFeatures.status, 'on')));
  const on = new Set(rows.map((r) => r.key));
  return FEATURE_KEYS.filter((k) => on.has(k));
};

export const hasFeature = async (userId: number, key: FeatureKey): Promise<boolean> => {
  const [row] = await db
    .select({ key: userFeatures.featureKey })
    .from(userFeatures)
    .where(and(eq(userFeatures.userId, userId), eq(userFeatures.featureKey, key), eq(userFeatures.status, 'on')));
  return !!row;
};

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
