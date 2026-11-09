import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { DAY, auth, clearGrants, giveGrant, makeAdmin, makeCustomer, me, setKind, setTrialEnd, useMemoryPlan, userGrants } from './planTestKit';
import { db } from '../db/client';
import { savingsGoals, userFeatures } from '../db/schema';
import { outbox } from '../lib/accountMail';
import { DEFAULT_PLAN } from '../lib/plan';

// Who has the plan, and what that gives. The plan setting is held in memory
// (planTestKit) so enforcing it here cannot affect other test files.

const plan = useMemoryPlan();
beforeEach(() => {
  plan.plan = { ...DEFAULT_PLAN };
  outbox.length = 0;
});

const enforce = (patch: Partial<typeof DEFAULT_PLAN> = {}) => {
  plan.plan = { ...plan.plan, enforced: true, existing_notice_at: new Date().toISOString(), ...patch };
};

const goals = (token: string) => request(app).get('/api/v1/goals').set(auth(token));

describe('sign-up', () => {
  it('starts the free period from the sign-up date and says so in the welcome email', async () => {
    const u = await registerUser({ features: null });
    const [g] = await userGrants(u.user.id);
    expect(g.kind).toBe('trial');
    const months = (g.endsAt!.getUTCFullYear() - g.startsAt.getUTCFullYear()) * 12 + g.endsAt!.getUTCMonth() - g.startsAt.getUTCMonth();
    expect(months).toBe(6);

    const mail = outbox.find((m) => m.to === u.user.email && /Welcome to Prapanji/.test(m.subject));
    expect(mail).toBeDefined();
    expect(mail!.text).toContain('₹200 / year');
    expect(mail!.text).toMatch(/until \d{1,2} \w+ 20\d\d/);
  });

  it('uses the free months an admin has set', async () => {
    plan.plan = { ...plan.plan, trial_months: 3 };
    const u = await registerUser({ features: null });
    const [g] = await userGrants(u.user.id);
    const months = (g.endsAt!.getUTCFullYear() - g.startsAt.getUTCFullYear()) * 12 + g.endsAt!.getUTCMonth() - g.startsAt.getUTCMonth();
    expect(months).toBe(3);
  });

  it('tells the app where the user stands, without enforcing anything', async () => {
    const u = await registerUser({ features: null });
    const body = await me(u.accessToken);
    expect(body.plan).toMatchObject({ enforced: false, state: 'trial', price_inr: 200, period: 'year' });
    expect(body.plan.days_left).toBeGreaterThan(178);
    expect(body.plan.days_left).toBeLessThan(186);
    expect(body.accountKind).toBe('customer');
  });
});

describe('before enforcement: nobody is locked', () => {
  it('a user whose free period ended keeps the access and tier they had', async () => {
    const u = await makeCustomer();
    await db.insert(userFeatures).values({ userId: u.user.id, featureKey: 'goals', status: 'on', source: 'default' });
    await setTrialEnd(u.user.id, -30);
    const body = await me(u.accessToken);
    expect(body.features).toEqual(['goals']);
    expect(body.tier).toBe('pro');
    expect((await goals(u.accessToken)).status).toBe(200);
  });
});

describe('after enforcement', () => {
  it('a running trial gives every feature and Pro', async () => {
    enforce();
    const u = await makeCustomer();
    const body = await me(u.accessToken);
    expect(body.features).toEqual(['goals', 'loans', 'investments', 'forecast']);
    expect(body.tier).toBe('pro');
    expect(body.plan.state).toBe('trial');
    expect((await goals(u.accessToken)).status).toBe(200);
  });

  it('an ended trial is locked by the server, with the usual reason code, and nothing saved is touched', async () => {
    enforce();
    const u = await makeCustomer();
    const made = await request(app).post('/api/v1/goals').set(auth(u.accessToken)).send({ name: 'Trip', target_amount: 5000 });
    expect(made.status).toBe(201);

    await setTrialEnd(u.user.id, -2);
    const body = await me(u.accessToken);
    expect(body.features).toEqual([]);
    expect(body.tier).toBe('standard');
    expect(body.plan).toMatchObject({ enforced: true, state: 'none' });
    expect(body.plan.ended_on).not.toBeNull();

    const res = await goals(u.accessToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_ADDED');
    expect(await db.select().from(savingsGoals).where(eq(savingsGoals.userId, u.user.id))).toHaveLength(1);
  });

  it('the always-free parts keep working after the plan ends', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -2);
    const t = await request(app).post('/api/v1/transactions').set(auth(u.accessToken)).send({ amount: 50, type: 'expense', category_key: 'internet', date: new Date().toISOString().slice(0, 10) });
    expect(t.status).toBe(201);
    expect((await request(app).get('/api/v1/reports/summary').query({ startMonth: 1, startYear: 2026, endMonth: 12, endYear: 2026 }).set(auth(u.accessToken))).status).toBe(200);
  });

  it('a paid period gives access, and one queued after the trial starts when the trial ends', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -2);
    await giveGrant(u.user.id, { kind: 'paid', startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 364 * DAY) });
    const body = await me(u.accessToken);
    expect(body.plan.state).toBe('paid');
    expect(body.features).toHaveLength(4);
  });

  it('an exception with an end date works until then, and stops after', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -2);
    await giveGrant(u.user.id, { kind: 'exception', startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() + 10 * DAY) });
    expect((await me(u.accessToken)).plan).toMatchObject({ state: 'exception' });
    expect((await goals(u.accessToken)).status).toBe(200);

    await clearGrants(u.user.id);
    await giveGrant(u.user.id, { kind: 'exception', startsAt: new Date(Date.now() - 20 * DAY), endsAt: new Date(Date.now() - DAY) });
    expect((await me(u.accessToken)).plan.state).toBe('none');
    expect((await goals(u.accessToken)).status).toBe(403);
  });

  it('an exception with no end date works until an admin removes it', async () => {
    enforce();
    const u = await makeCustomer();
    await clearGrants(u.user.id);
    await giveGrant(u.user.id, { kind: 'exception', startsAt: new Date(Date.now() - DAY), endsAt: null });
    const body = await me(u.accessToken);
    expect(body.plan).toMatchObject({ state: 'exception', until: null, days_left: null });
    expect(body.features).toHaveLength(4);
  });

  it('a company account always has access, even with no grants', async () => {
    enforce();
    const u = await makeCustomer();
    await clearGrants(u.user.id);
    await setKind(u.user.id, 'company');
    const body = await me(u.accessToken);
    expect(body.plan.state).toBe('company');
    expect(body.accountKind).toBe('company');
    expect(body.tier).toBe('pro');
    expect(body.features).toHaveLength(4);
  });

  it('only the features the plan includes are given', async () => {
    enforce({ features: ['goals', 'loans'] });
    const u = await makeCustomer();
    expect((await me(u.accessToken)).features).toEqual(['goals', 'loans']);
    expect((await request(app).get('/api/v1/investments').set(auth(u.accessToken))).status).toBe(403);
  });

  it('old sign-up defaults and grandfathered rows no longer bypass the plan', async () => {
    enforce();
    const u = await makeCustomer();
    await db.insert(userFeatures).values([
      { userId: u.user.id, featureKey: 'goals', status: 'on', source: 'default' },
      { userId: u.user.id, featureKey: 'loans', status: 'on', source: 'existing_data' },
    ]);
    await setTrialEnd(u.user.id, -2);
    expect((await me(u.accessToken)).features).toEqual([]);
  });

  it('a feature an admin switched on by hand keeps working after the plan ends, until its end date', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -2);
    await db.insert(userFeatures).values({ userId: u.user.id, featureKey: 'loans', status: 'on', source: 'admin', expiresAt: new Date(Date.now() + 5 * DAY) });
    expect((await me(u.accessToken)).features).toEqual(['loans']);
    await db.update(userFeatures).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(userFeatures.userId, u.user.id));
    expect((await me(u.accessToken)).features).toEqual([]);
  });

  it('a feature staff switched off for this user stays off while the plan runs', async () => {
    enforce();
    const a = await makeAdmin();
    const u = await makeCustomer();
    expect((await me(u.accessToken)).features).toContain('investments');

    const off = await request(app).put(`/api/v1/admin/users/${u.user.id}/features/investments`).set(auth(a.token)).send({ on: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ key: 'investments', on: false, denied: true });
    expect((await me(u.accessToken)).features).toEqual(['goals', 'loans', 'forecast']);
    expect((await request(app).get('/api/v1/investments').set(auth(u.accessToken))).status).toBe(403);

    const on = await request(app).put(`/api/v1/admin/users/${u.user.id}/features/investments`).set(auth(a.token)).send({ on: true });
    expect(on.body).toMatchObject({ on: true, denied: false });
    expect((await me(u.accessToken)).features).toContain('investments');
  });

  it('an admin can set an account to Standard on purpose', async () => {
    enforce();
    const a = await makeAdmin();
    const u = await makeCustomer();
    await request(app).patch(`/api/v1/admin/users/${u.user.id}`).set(auth(a.token)).send({ tier: 'standard' }).expect(200);
    expect((await me(u.accessToken)).tier).toBe('standard');
  });

  it('every optional feature is switched off at once when the plan ends, with no job to run', async () => {
    enforce();
    const u = await makeCustomer();
    expect((await goals(u.accessToken)).status).toBe(200);
    await setTrialEnd(u.user.id, -1);
    expect((await goals(u.accessToken)).status).toBe(403);
  });
});

describe('the features page', () => {
  it("shows the plan's price once, and when each included feature ends", async () => {
    enforce();
    const u = await makeCustomer();
    const list = (await request(app).get('/api/v1/features').set(auth(u.accessToken)).expect(200)).body;
    expect(list).toHaveLength(4);
    expect(list.every((f: { price: number; period: string; on: boolean; expiresAt: string | null }) => f.price === 200 && f.period === 'year' && f.on && f.expiresAt)).toBe(true);
  });

  it('shows "ended" after the plan ends, and asking for an included feature changes nothing', async () => {
    enforce();
    const u = await makeCustomer();
    const inc = await request(app).post('/api/v1/features/goals/request').set(auth(u.accessToken)).send({}).expect(200);
    expect(inc.body.on).toBe(true);
    expect(inc.body.requested).toBe(false);

    await setTrialEnd(u.user.id, -3);
    const list = (await request(app).get('/api/v1/features').set(auth(u.accessToken))).body;
    expect(list.every((f: { on: boolean; ended: boolean }) => !f.on && f.ended)).toBe(true);
  });
});

describe('tier endpoint', () => {
  it('returns the plan with the tier', async () => {
    const u = await registerUser({ features: null });
    const res = await request(app).patch('/api/v1/auth/me/tier').set(auth(u.accessToken)).send({ tier: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.plan.state).toBe('trial');
  });
});
