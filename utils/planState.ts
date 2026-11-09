import type { FeatureKey } from '../constants/features';

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
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};

/** "ends today", "ends tomorrow" or "ends in 12 days". */
export const endsIn = (daysLeft: number): string => (daysLeft <= 0 ? 'ends today' : daysLeft === 1 ? 'ends tomorrow' : `ends in ${daysLeft} days`);

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
          : `Your full access ended${plan.ended_on ? ` on ${shortDate(plan.ended_on, now)}` : ''}. Your data is safe. Renew to turn it back on.`,
      };
    case 'grace':
      return { kind: 'hold', text: "We're checking your payment. Everything keeps working while we check." };
    case 'trial':
      if (left == null || left > WARN_DAYS) return payingNow ? { kind: 'hold', text: "We're checking your payment." } : null;
      return payingNow
        ? { kind: 'hold', text: "We're checking your payment." }
        : { kind: 'ending', text: `Full access ${endsIn(left)}${plan.until ? ` (${shortDate(plan.until, now)})` : ''}. Renew for ${priceText(plan)}.` };
    case 'paid':
      if (payingNow) return { kind: 'hold', text: "We're checking your payment." };
      if (left == null || left > WARN_DAYS) return null;
      return { kind: 'ending', text: `Your plan ${endsIn(left)}${plan.until ? ` (${shortDate(plan.until, now)})` : ''}. Renew early, and no time is lost.` };
    case 'exception':
      if (left == null || left > OWN_EXCEPTION_WARN_DAYS) return null;
      return { kind: 'ending', text: `Your extra access ${endsIn(left)}${plan.until ? ` (${shortDate(plan.until, now)})` : ''}.` };
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
      return { title: 'Full access', detail: until ? `Extra access until ${until}.` : 'Extra access, with no end date.' };
    case 'paid':
      return { title: 'Plan active', detail: until ? `Paid until ${until}${plan.days_left != null ? ` · ${plan.days_left} days left` : ''}.` : 'Paid.' };
    case 'trial':
      return { title: 'Free full access', detail: until ? `Until ${until}${plan.days_left != null ? ` · ${plan.days_left} days left` : ''}.` : 'Free for now.' };
    case 'grace':
      return { title: "Checking your payment", detail: 'Everything keeps working while we check.' };
    default:
      return { title: 'Full access ended', detail: plan.ended_on ? `Ended on ${shortDate(plan.ended_on)}. Your data is safe.` : 'Your data is safe.' };
  }
};

/** Whether the user can pay now (not a company account, and the plan is on). */
export const canRenew = (plan: PlanInfo | undefined | null): boolean => !!plan && plan.enforced && plan.state !== 'company';
