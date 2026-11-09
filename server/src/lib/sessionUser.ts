import { users } from '../db/schema';
import { effectiveTier, getAccess, planSummary } from './access';
import { getUserFeatures } from './features';
import { getPlan } from './plan';
import { toUserResponse } from './session';

/**
 * The signed-in user as the app sees them: profile, the optional features they
 * have, the tier, and the plan state. The tier and features follow the plan
 * once an admin has turned enforcement on; before that they are what they were.
 */
export const buildSessionUser = async (user: typeof users.$inferSelect) => {
  const [plan, features] = await Promise.all([getPlan(), getUserFeatures(user.id)]);
  const access = await getAccess(user.id);
  return {
    ...toUserResponse(user),
    tier: effectiveTier(user.tier, access, plan),
    accountKind: user.accountKind,
    features,
    plan: planSummary(access, plan),
  };
};
