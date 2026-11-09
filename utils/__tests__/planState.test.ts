import { PlanInfo, canRenew, endsIn, planBanner, planHeadline, priceText, shortDate } from '../planState';

const NOW = new Date('2026-11-09T10:00:00');
const base: PlanInfo = { enforced: true, state: 'trial', until: '2027-05-09T00:00:00', days_left: 181, ended_on: null, price_inr: 200, period: 'year', features: ['goals', 'loans', 'investments', 'forecast'] };
const plan = (over: Partial<PlanInfo>): PlanInfo => ({ ...base, ...over });

describe('words', () => {
  it('says when something ends', () => {
    expect(endsIn(0)).toBe('ends today');
    expect(endsIn(1)).toBe('ends tomorrow');
    expect(endsIn(12)).toBe('ends in 12 days');
  });

  it('writes the price and short dates', () => {
    expect(priceText(base)).toBe('₹200 a year');
    expect(priceText(plan({ price_inr: 1499.5, period: 'month' }))).toBe('₹1,499.5 a month');
    expect(shortDate('2026-12-05T12:00:00', NOW)).toBe('5 Dec');
    expect(shortDate('2027-05-09T12:00:00', NOW)).toBe('9 May 2027');
  });
});

describe('the Home strip', () => {
  it('says nothing until the plan is enforced, or without a plan', () => {
    expect(planBanner(plan({ enforced: false, state: 'none' }), false, NOW)).toBeNull();
    expect(planBanner(undefined, false, NOW)).toBeNull();
    expect(planBanner(null, false, NOW)).toBeNull();
  });

  it('says nothing to someone with plenty of time, a company account, or an open-ended exception', () => {
    expect(planBanner(plan({ days_left: 181 }), false, NOW)).toBeNull();
    expect(planBanner(plan({ state: 'paid', days_left: 300 }), false, NOW)).toBeNull();
    expect(planBanner(plan({ state: 'company', until: null, days_left: null }), false, NOW)).toBeNull();
    expect(planBanner(plan({ state: 'exception', until: null, days_left: null }), false, NOW)).toBeNull();
  });

  it('warns in the last 30 days, with the date and the price', () => {
    const b = planBanner(plan({ days_left: 12, until: '2026-11-21T00:00:00' }), false, NOW)!;
    expect(b.kind).toBe('ending');
    expect(b.text).toBe('Full access ends in 12 days (21 Nov). Renew for ₹200 a year.');
    expect(planBanner(plan({ days_left: 30 }), false, NOW)!.kind).toBe('ending');
    expect(planBanner(plan({ days_left: 31 }), false, NOW)).toBeNull();
    expect(planBanner(plan({ days_left: 1 }), false, NOW)!.text).toContain('ends tomorrow');
    expect(planBanner(plan({ days_left: 0 }), false, NOW)!.text).toContain('ends today');
  });

  it('after it ends, says the data is safe and asks to renew', () => {
    const b = planBanner(plan({ state: 'none', until: null, days_left: null, ended_on: '2026-11-05T00:00:00' }), false, NOW)!;
    expect(b.kind).toBe('ended');
    expect(b.text).toContain('ended on 5 Nov');
    expect(b.text).toContain('Your data is safe');
  });

  it('while a payment is being checked, reassures instead of asking to pay', () => {
    expect(planBanner(plan({ state: 'grace', days_left: 3 }), true, NOW)!.kind).toBe('hold');
    expect(planBanner(plan({ state: 'none', until: null, days_left: null }), true, NOW)!.kind).toBe('hold');
    expect(planBanner(plan({ days_left: 10 }), true, NOW)!.kind).toBe('hold');
    expect(planBanner(plan({ state: 'paid', days_left: 10 }), true, NOW)!.kind).toBe('hold');
    // Even with plenty of time left, a payment in flight is worth a line.
    expect(planBanner(plan({ days_left: 150 }), true, NOW)!.kind).toBe('hold');
  });

  it('tells a paid user their plan is ending, and that renewing early loses no time', () => {
    const b = planBanner(plan({ state: 'paid', days_left: 20, until: '2026-11-29T00:00:00' }), false, NOW)!;
    expect(b.kind).toBe('ending');
    expect(b.text).toContain('Your plan ends in 20 days');
    expect(b.text).toContain('no time is lost');
  });

  it('warns an exception holder only in the last 14 days', () => {
    expect(planBanner(plan({ state: 'exception', days_left: 14 }), false, NOW)!.text).toContain('Your extra access ends in 14 days');
    expect(planBanner(plan({ state: 'exception', days_left: 15 }), false, NOW)).toBeNull();
  });
});

describe('the Your plan headline', () => {
  it('describes each state', () => {
    expect(planHeadline(plan({ state: 'trial', days_left: 181, until: '2027-05-09T00:00:00' }))).toEqual({ title: 'Free full access', detail: 'Until 9 May 2027 · 181 days left.' });
    expect(planHeadline(plan({ state: 'paid', days_left: 300, until: '2027-09-01T00:00:00' })).title).toBe('Plan active');
    expect(planHeadline(plan({ state: 'company', until: null, days_left: null })).title).toBe('Company account');
    expect(planHeadline(plan({ state: 'exception', until: null, days_left: null })).detail).toBe('Extra access, with no end date.');
    expect(planHeadline(plan({ state: 'exception', until: '2027-06-30T00:00:00', days_left: 100 })).detail).toBe('Extra access until 30 Jun 2027.');
    expect(planHeadline(plan({ state: 'grace', days_left: 3 })).title).toBe('Checking your payment');
    expect(planHeadline(plan({ state: 'none', until: null, days_left: null, ended_on: '2026-11-05T00:00:00' })).detail).toContain('Your data is safe');
  });
});

describe('who can pay', () => {
  it('everyone with the plan switched on, except company accounts', () => {
    expect(canRenew(base)).toBe(true);
    expect(canRenew(plan({ state: 'none' }))).toBe(true);
    expect(canRenew(plan({ state: 'company' }))).toBe(false);
    expect(canRenew(plan({ enforced: false }))).toBe(false);
    expect(canRenew(undefined)).toBe(false);
  });
});
