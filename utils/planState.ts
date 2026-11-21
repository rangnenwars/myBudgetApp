import type { FeatureKey } from '../constants/features';

import { t, dateLocale } from './i18n';
// How the app shows the plan. The server decides who has access
// (server/src/lib/access.ts); this only turns what it says into words.

export type PlanStateName = 'company' | 'exception' | 'paid' | 'trial' | 'grace' | 'none';

/** What the server tells the app about the signed-in user's plan. */
export interface PlanInfo {
  /** While false, nobody is locked and none of this is shown. */
  enforced: boolean;
  state: PlanStateName;
  until: string | null;
  days_left: number | null;
  ended_on: string | null;
  price_inr: number;
  period: 'month' | 'year';
  features: FeatureKey[];
}

export type BannerKind = 'ending' | 'hold' | 'ended';

export interface PlanBanner {
  kind: BannerKind;
  text: string;
}

const WARN_DAYS = 30;
const OWN_EXCEPTION_WARN_DAYS = 14;

/** "9 May" or, for another year, "9 May 2028". */
export const shortDate = (iso: string, now: Date = new Date()): string => {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};

/** "ends today", "ends tomorrow" or "ends in 12 days". */
export const endsIn = (daysLeft: number): string => (daysLeft <= 0 ? 'ends today' : daysLeft === 1 ? 'ends tomorrow' : t('ends in {0} days', { 0: daysLeft }));

/** "₹200 a year". */
export const priceText = (plan: Pick<PlanInfo, 'price_inr' | 'period'>): string =>
  `₹${plan.price_inr.toLocaleString('en-IN', { maximumFractionDigits: 2 })} a ${plan.period}`;

/**
 * The one line for Home's alert strip, or null when there is nothing to say.
 * Nothing appears until the plan is enforced, and a user with plenty of time
 * (or a company account, or an exception with no end) sees nothing.
 * `payingNow` is true while a payment of theirs is waiting to be confirmed.
 */
export const planBanner = (plan: PlanInfo | undefined | null, payingNow = false, now: Date = new Date()): PlanBanner | null => {
  if (!plan || !plan.enforced) return null;
  const left = plan.days_left;
  switch (plan.state) {
    case 'none':
      return {
        kind: payingNow ? 'hold' : 'ended',
        text: payingNow
          ? "We're checking your payment. Everything keeps working while we check."
          : plan.ended_on
            ? t('Your full access ended on {0}. Your data is safe. Renew to turn it back on.', { 0: shortDate(plan.ended_on, now) })
            : t('Your full access ended. Your data is safe. Renew to turn it back on.'),
      };
    case 'grace':
      return { kind: 'hold', text: "We're checking your payment. Everything keeps working while we check." };
    case 'trial':
      if (left == null || left > WARN_DAYS) return payingNow ? { kind: 'hold', text: "We're checking your payment." } : null;
      return payingNow
        ? { kind: 'hold', text: "We're checking your payment." }
        : { kind: 'ending', text: t('Full access {0}{1}. Renew for {2}.', { 0: endsIn(left), 1: plan.until ? ` (${shortDate(plan.until, now)})` : '', 2: priceText(plan) }) };
    case 'paid':
      if (payingNow) return { kind: 'hold', text: "We're checking your payment." };
      if (left == null || left > WARN_DAYS) return null;
      return { kind: 'ending', text: t('Your plan {0}{1}. Renew early, and no time is lost.', { 0: endsIn(left), 1: plan.until ? ` (${shortDate(plan.until, now)})` : '' }) };
    case 'exception':
      if (left == null || left > OWN_EXCEPTION_WARN_DAYS) return null;
      return { kind: 'ending', text: t('Your extra access {0}{1}.', { 0: endsIn(left), 1: plan.until ? ` (${shortDate(plan.until, now)})` : '' }) };
    default:
      return null;
  }
};

/** The headline on the Your plan screen. */
export const planHeadline = (plan: PlanInfo): { title: string; detail: string } => {
  const until = plan.until ? shortDate(plan.until) : null;
  switch (plan.state) {
    case 'company':
      return { title: 'Company account', detail: 'Full access, always. Nothing to pay.' };
    case 'exception':
      return { title: 'Full access', detail: until ? t('Extra access until {0}.', { 0: until }) : 'Extra access, with no end date.' };
    case 'paid':
      return { title: 'Plan active', detail: until ? t('Paid until {0}{1}.', { 0: until, 1: plan.days_left != null ? t(' · {0} days left', { 0: plan.days_left }) : '' }) : 'Paid.' };
    case 'trial':
      return { title: 'Free full access', detail: until ? t('Until {0}{1}.', { 0: until, 1: plan.days_left != null ? t(' · {0} days left', { 0: plan.days_left }) : '' }) : 'Free for now.' };
    case 'grace':
      return { title: "Checking your payment", detail: 'Everything keeps working while we check.' };
    default:
      return { title: 'Full access ended', detail: plan.ended_on ? t('Ended on {0}. Your data is safe.', { 0: shortDate(plan.ended_on) }) : 'Your data is safe.' };
  }
};

/** Whether the user can pay now (not a company account, and the plan is on). */
export const canRenew = (plan: PlanInfo | undefined | null): boolean => !!plan && plan.enforced && plan.state !== 'company';
