import { FEATURE_KEYS } from '../../../constants/features';
import { GrantRow, addMonths, computeAccess, effectiveTier } from '../lib/access';
import { DEFAULT_PLAN, planEditSchema, planPriceLabel } from '../lib/plan';
import { featuresFor, FeatureRowLite } from '../lib/features';
import { GRACE_DAYS, graceAllowed, maskTxnId, normalizeTxnId, paidPeriodEnd, renewalStart } from '../lib/payments';
import { gentlerStages, reminderStage } from '../lib/accessNotices';
import { UPI_ID_RE, parseUpiPayee } from '../lib/paymentDetails';

const DAY = 86_400_000;
const NOW = new Date('2026-11-09T10:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
const grant = (kind: GrantRow['kind'], from: number, to: number | null, revoked = false): GrantRow => ({
  kind,
  startsAt: at(from),
  endsAt: to == null ? null : at(to),
  revokedAt: revoked ? NOW : null,
});

describe('addMonths', () => {
  it('adds calendar months and clamps to the end of a shorter month', () => {
    expect(addMonths(new Date('2026-11-09T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2027-05-09');
    expect(addMonths(new Date('2026-08-31T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(addMonths(new Date('2027-08-31T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('crosses a year end and a leap day', () => {
    expect(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(addMonths(new Date('2028-02-29T00:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2029-02-28');
  });
});

describe('computeAccess', () => {
  it('a company account always has access and never expires', () => {
    const a = computeAccess({ kind: 'company', grants: [], now: NOW });
    expect(a).toMatchObject({ state: 'company', until: null, daysLeft: null });
  });

  it('a running trial gives access until it ends', () => {
    const a = computeAccess({ kind: 'customer', grants: [grant('trial', -10, 171)], now: NOW });
    expect(a.state).toBe('trial');
    expect(a.until).toEqual(at(171));
    expect(a.daysLeft).toBe(171);
  });

  it('counts a part day as a day left', () => {
    expect(computeAccess({ kind: 'customer', grants: [grant('trial', -10, 0.2)], now: NOW }).daysLeft).toBe(1);
  });

  it('an ended trial is locked, and remembers when it ended', () => {
    const a = computeAccess({ kind: 'customer', grants: [grant('trial', -200, -5)], now: NOW });
    expect(a.state).toBe('none');
    expect(a.endedOn).toEqual(at(-5));
  });

  it('a customer with no grants at all is locked', () => {
    expect(computeAccess({ kind: 'customer', grants: [], now: NOW })).toMatchObject({ state: 'none', until: null, endedOn: null });
  });

  it('paid beats trial, and a paid period queued after the trial is not live yet', () => {
    const queued = computeAccess({ kind: 'customer', grants: [grant('trial', -10, 20), grant('paid', 20, 385)], now: NOW });
    expect(queued.state).toBe('trial');
    expect(queued.planEnd).toEqual(at(385));
    const running = computeAccess({ kind: 'customer', grants: [grant('trial', -200, -1), grant('paid', -1, 364)], now: NOW });
    expect(running.state).toBe('paid');
    expect(running.until).toEqual(at(364));
  });

  it('an exception beats everything and may have no end date', () => {
    const open = computeAccess({ kind: 'customer', grants: [grant('trial', -200, -5), grant('exception', -1, null)], now: NOW });
    expect(open).toMatchObject({ state: 'exception', until: null, daysLeft: null });
    const dated = computeAccess({ kind: 'customer', grants: [grant('exception', -1, 30)], now: NOW });
    expect(dated).toMatchObject({ state: 'exception', daysLeft: 30 });
  });

  it('a revoked or finished exception no longer counts', () => {
    expect(computeAccess({ kind: 'customer', grants: [grant('exception', -5, 30, true)], now: NOW }).state).toBe('none');
    expect(computeAccess({ kind: 'customer', grants: [grant('exception', -50, -1)], now: NOW }).state).toBe('none');
  });

  it('an exception does not move the date a renewal starts from', () => {
    const a = computeAccess({ kind: 'customer', grants: [grant('trial', -200, -5), grant('exception', -1, 30)], now: NOW });
    expect(a.planEnd).toEqual(at(-5));
  });

  it('a revoked trial gives nothing', () => {
    expect(computeAccess({ kind: 'customer', grants: [grant('trial', -10, 100, true)], now: NOW }).state).toBe('none');
  });

  it('grace covers a locked user while a payment is being checked, and nothing else', () => {
    const locked = [grant('trial', -200, -5)];
    expect(computeAccess({ kind: 'customer', grants: locked, graceUntil: at(2), now: NOW })).toMatchObject({ state: 'grace', until: at(2) });
    expect(computeAccess({ kind: 'customer', grants: locked, graceUntil: at(-1), now: NOW }).state).toBe('none');
    expect(computeAccess({ kind: 'customer', grants: [grant('trial', -10, 50)], graceUntil: at(2), now: NOW }).state).toBe('trial');
  });

  it('a grant stamped a moment in the future by another clock still counts', () => {
    const a = computeAccess({ kind: 'customer', grants: [{ kind: 'trial', startsAt: new Date(NOW.getTime() + 30_000), endsAt: at(180), revokedAt: null }], now: NOW });
    expect(a.state).toBe('trial');
  });
});

describe('effectiveTier', () => {
  const plan = (enforced: boolean) => ({ ...DEFAULT_PLAN, enforced });
  const trial = computeAccess({ kind: 'customer', grants: [grant('trial', -1, 100)], now: NOW });
  const none = computeAccess({ kind: 'customer', grants: [], now: NOW });

  it('is the stored tier until the plan is enforced', () => {
    expect(effectiveTier('pro', none, plan(false))).toBe('pro');
    expect(effectiveTier('standard', trial, plan(false))).toBe('standard');
  });

  it('once enforced, Pro means the plan is running and staff have not set Standard', () => {
    expect(effectiveTier('pro', trial, plan(true))).toBe('pro');
    expect(effectiveTier('pro', none, plan(true))).toBe('standard');
    expect(effectiveTier('standard', trial, plan(true))).toBe('standard');
  });
});

describe('featuresFor', () => {
  const row = (featureKey: FeatureRowLite['featureKey'], over: Partial<FeatureRowLite> = {}): FeatureRowLite => ({ featureKey, status: 'on', source: 'default', denied: false, expiresAt: null, ...over });
  const trial = { state: 'trial' as const };
  const none = { state: 'none' as const };
  const shadow = { enforced: false, features: [...FEATURE_KEYS] };
  const live = { enforced: true, features: [...FEATURE_KEYS] };

  it('before enforcement it is exactly the old rule: any switched-on row', () => {
    expect(featuresFor([row('goals'), row('loans', { status: 'off' })], shadow, none)).toEqual(['goals']);
    expect(featuresFor([row('goals', { expiresAt: new Date(NOW.getTime() - 1) })], shadow, none, NOW)).toEqual([]);
    expect(featuresFor([], shadow, trial)).toEqual([]);
  });

  it('once enforced, the plan gives every feature it includes', () => {
    expect(featuresFor([], live, trial)).toEqual([...FEATURE_KEYS]);
    expect(featuresFor([], { enforced: true, features: ['goals', 'loans'] }, trial)).toEqual(['goals', 'loans']);
    expect(featuresFor([], live, none)).toEqual([]);
  });

  it('once enforced, old sign-up defaults and grandfathered rows no longer bypass the plan', () => {
    expect(featuresFor([row('goals', { source: 'default' }), row('loans', { source: 'existing_data' })], live, none)).toEqual([]);
  });

  it('once enforced, a feature switched on by hand keeps working without the plan, until its end date', () => {
    expect(featuresFor([row('loans', { source: 'admin' })], live, none)).toEqual(['loans']);
    expect(featuresFor([row('loans', { source: 'admin', expiresAt: new Date(NOW.getTime() - 1) })], live, none, NOW)).toEqual([]);
  });

  it('a feature staff switched off for this user stays off, plan or not', () => {
    expect(featuresFor([row('investments', { status: 'off', source: 'admin', denied: true })], live, trial)).not.toContain('investments');
    expect(featuresFor([row('investments', { status: 'off', source: 'admin', denied: true })], shadow, none)).toEqual([]);
  });

  it('a refused or waiting request does not block the plan', () => {
    expect(featuresFor([row('goals', { status: 'off', source: 'request' })], live, trial)).toContain('goals');
  });
});

describe('plan settings', () => {
  it('defaults to ₹200 a year, six months free, 30 days notice, and nothing enforced', () => {
    expect(DEFAULT_PLAN).toMatchObject({ price_inr: 200, period: 'year', trial_months: 6, notice_days: 30, enforced: false });
    expect(planPriceLabel(DEFAULT_PLAN)).toBe('₹200 / year');
  });

  it('only lets an admin edit the price, period, free months, notice days and features', () => {
    const ok = planEditSchema.safeParse({ price_inr: 250, period: 'year', trial_months: 6, notice_days: 30, features: ['goals'] });
    expect(ok.success).toBe(true);
    expect(planEditSchema.safeParse({ price_inr: 250, period: 'year', trial_months: 6, notice_days: 30, features: [], enforced: true }).success).toBe(false);
    expect(planEditSchema.safeParse({ price_inr: 0, period: 'year', trial_months: 6, notice_days: 30, features: [] }).success).toBe(false);
    expect(planEditSchema.safeParse({ price_inr: 200, period: 'year', trial_months: 0, notice_days: 30, features: [] }).success).toBe(false);
    expect(planEditSchema.safeParse({ price_inr: 200, period: 'year', trial_months: 6, notice_days: 3, features: [] }).success).toBe(false);
    expect(planEditSchema.safeParse({ price_inr: 200, period: 'year', trial_months: 6, notice_days: 30, features: ['bogus'] }).success).toBe(false);
  });
});

describe('transaction IDs', () => {
  it('accepts a 12-digit UTR and a longer alphanumeric reference, normalised', () => {
    expect(normalizeTxnId('4021 8837 1190')).toBe('402188371190');
    expect(normalizeTxnId('t2411-0987aB12')).toBe('T24110987AB12');
  });

  it('rejects anything too short, too long or with odd characters', () => {
    expect(normalizeTxnId('1234567')).toBeNull();
    expect(normalizeTxnId('x'.repeat(36))).toBeNull();
    expect(normalizeTxnId('4021/8837/1190')).toBeNull();
    expect(normalizeTxnId('')).toBeNull();
  });

  it('shows only the last four characters back to the user', () => {
    expect(maskTxnId('402188371190')).toBe('…1190');
  });
});

describe('renewing', () => {
  it('starts a paid period when the current one ends, or now if it already has', () => {
    expect(renewalStart(at(40), NOW)).toEqual(at(40));
    expect(renewalStart(at(-3), NOW)).toEqual(NOW);
    expect(renewalStart(null, NOW)).toEqual(NOW);
  });

  it('a year is twelve calendar months and a month-plan is one', () => {
    expect(paidPeriodEnd(new Date('2027-05-09T00:00:00Z'), { period: 'year' }).toISOString().slice(0, 10)).toBe('2028-05-09');
    expect(paidPeriodEnd(new Date('2027-01-31T00:00:00Z'), { period: 'month' }).toISOString().slice(0, 10)).toBe('2027-02-28');
  });

  it('grace is given once per access period', () => {
    expect(GRACE_DAYS).toBe(3);
    expect(graceAllowed([], at(-5))).toBe(true);
    expect(graceAllowed([{ graceUntil: at(-2), forAccessEnd: at(-5) }], at(-5))).toBe(false);
    // A later period (after a renewal) gets its own.
    expect(graceAllowed([{ graceUntil: at(-2), forAccessEnd: at(-5) }], at(360))).toBe(true);
    // A claim that was not given grace does not use it up.
    expect(graceAllowed([{ graceUntil: null, forAccessEnd: at(-5) }], at(-5))).toBe(true);
    expect(graceAllowed([{ graceUntil: at(1), forAccessEnd: null }], null)).toBe(false);
  });
});

describe('reminder stages', () => {
  it('picks the stage an end date has reached', () => {
    expect(reminderStage(at(45), NOW)).toBeNull();
    expect(reminderStage(at(30), NOW)).toBe('d30');
    expect(reminderStage(at(12), NOW)).toBe('d30');
    expect(reminderStage(at(7), NOW)).toBe('d7');
    expect(reminderStage(at(3), NOW)).toBe('d7');
    expect(reminderStage(at(1), NOW)).toBe('d1');
    expect(reminderStage(at(0.2), NOW)).toBe('d1');
    expect(reminderStage(at(-1), NOW)).toBe('ended');
    expect(reminderStage(at(-29), NOW)).toBe('ended');
    expect(reminderStage(at(-40), NOW)).toBeNull();
  });

  it('skips the gentler stages when a more urgent one is sent', () => {
    expect(gentlerStages('d30')).toEqual([]);
    expect(gentlerStages('d7')).toEqual(['d30']);
    expect(gentlerStages('d1')).toEqual(['d30', 'd7']);
    expect(gentlerStages('ended')).toEqual(['d30', 'd7', 'd1']);
  });
});

describe('UPI details', () => {
  it('validates a UPI ID', () => {
    expect(UPI_ID_RE.test('prapanji@okbank')).toBe(true);
    expect(UPI_ID_RE.test('name.surname-1@ybl')).toBe(true);
    expect(UPI_ID_RE.test('no-handle')).toBe(false);
    expect(UPI_ID_RE.test('a b@bank')).toBe(false);
    expect(UPI_ID_RE.test('x@')).toBe(false);
  });

  it('reads the payee out of a upi://pay link, and nothing else', () => {
    expect(parseUpiPayee('upi://pay?pa=Prapanji@OkBank&pn=Prapanji&cu=INR')).toBe('prapanji@okbank');
    expect(parseUpiPayee('https://example.com/?pa=x@y')).toBeNull();
    expect(parseUpiPayee('upi://pay?pn=NoPayee')).toBeNull();
    expect(parseUpiPayee('hello')).toBeNull();
  });
});
