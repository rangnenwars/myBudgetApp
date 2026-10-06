import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { adminAuditLog, issueReports } from '../db/schema';
import {
  app,
  uniqueEmail,
  registerUser,
  setFeatures,
  promoteToAdmin,
  promoteToSupport,
  promoteToSystemManager,
  RegisteredUser,
} from './helpers';

const auth = (u: RegisteredUser) => ({ Authorization: `Bearer ${u.accessToken}` });

const staff = async (promote: (id: number) => Promise<unknown>, prefix: string) => {
  const u = await registerUser({ email: uniqueEmail(prefix) });
  await promote(u.user.id);
  return u;
};

const switchFeature = (actor: RegisteredUser, userId: number, key: string, on: boolean) =>
  request(app).put(`/api/v1/admin/users/${userId}/features/${key}`).set(auth(actor)).send({ on });

describe('feature routes are refused when the feature is off', () => {
  it.each([
    ['/api/v1/goals', 'goals'],
    ['/api/v1/loans', 'loans'],
    ['/api/v1/investments', 'investments'],
    ['/api/v1/reports/debt-payoff', 'loans'],
    ['/api/v1/reports/goal-eta', 'goals'],
  ])('GET %s needs %s', async (path) => {
    const u = await registerUser({ features: [] });
    const res = await request(app).get(path).set(auth(u));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_ADDED');
  });

  it('allows the route once the feature is on, and only that feature', async () => {
    const u = await registerUser({ features: ['goals'] });
    expect((await request(app).get('/api/v1/goals').set(auth(u))).status).toBe(200);
    expect((await request(app).get('/api/v1/loans').set(auth(u))).status).toBe(403);
  });

  it('lists the switched-on features on /auth/me', async () => {
    const u = await registerUser({ features: ['loans', 'investments'] });
    const res = await request(app).get('/api/v1/auth/me').set(auth(u));
    expect(res.body.features).toEqual(['loans', 'investments']);
  });
});

describe('switching a feature off keeps the data', () => {
  it('hides goals while off and brings them back when on', async () => {
    const admin = await staff(promoteToAdmin, 'feat-admin');
    const u = await registerUser({ features: ['goals'] });
    await request(app).post('/api/v1/goals').set(auth(u)).send({ name: 'Phone', target_amount: 20000 }).expect(201);

    expect((await switchFeature(admin, u.user.id, 'goals', false)).body.on).toBe(false);
    expect((await request(app).get('/api/v1/goals').set(auth(u))).status).toBe(403);

    await switchFeature(admin, u.user.id, 'goals', true).expect(200);
    const goals = await request(app).get('/api/v1/goals').set(auth(u)).expect(200);
    expect(goals.body.map((g: { name: string }) => g.name)).toEqual(['Phone']);
  });

  it('leaves a hidden feature out of net worth', async () => {
    const u = await registerUser({ features: ['investments'] });
    await request(app).post('/api/v1/investments').set(auth(u)).send({ name: 'FD', type: 'fd', amount: 50000 }).expect(201);
    const withIt = await request(app).post('/api/v1/net-worth/snapshot').set(auth(u)).expect(200);

    await setFeatures(u.user.id, []);
    const without = await request(app).post('/api/v1/net-worth/snapshot').set(auth(u)).expect(200);
    expect(withIt.body.netWorth - without.body.netWorth).toBe(50000);
  });

  it('leaves loan EMIs out of the free-money day while Loans is off', async () => {
    const u = await registerUser({ features: ['loans'] });
    await request(app)
      .post('/api/v1/loans')
      .set(auth(u))
      .send({ name: 'Bike', principal: 60000, outstanding: 40000, emi: 3000, counts_as_expense: false })
      .expect(201);
    const on = await request(app).get('/api/v1/reports/free-money-day').set(auth(u)).expect(200);
    expect(on.body.loans).toHaveLength(1);
    expect(on.body.items.some((i: { kind: string }) => i.kind === 'loan')).toBe(true);

    await setFeatures(u.user.id, []);
    const off = await request(app).get('/api/v1/reports/free-money-day').set(auth(u)).expect(200);
    expect(off.body.loans).toEqual([]);
    expect(off.body.items.some((i: { kind: string }) => i.kind === 'loan')).toBe(false);
    expect(off.body.committed).toBe(on.body.committed - 3000);
  });
});

describe('asking for a feature', () => {
  it('files one request, shows it to staff, and closes it when switched on', async () => {
    const admin = await staff(promoteToAdmin, 'feat-admin');
    const u = await registerUser({ features: [] });

    const first = await request(app).post('/api/v1/features/loans/request').set(auth(u)).expect(200);
    expect(first.body).toMatchObject({ key: 'loans', on: false, requested: true });
    await request(app).post('/api/v1/features/loans/request').set(auth(u)).expect(200);

    const issues = await db.select().from(issueReports).where(eq(issueReports.userId, u.user.id));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ title: 'Access request: Loans', screen: 'loans', status: 'new' });

    const own = await request(app).get('/api/v1/features').set(auth(u)).expect(200);
    expect(own.body.find((f: { key: string }) => f.key === 'loans')).toMatchObject({ on: false, requested: true });

    const overview = await request(app).get('/api/v1/admin/features').set(auth(admin)).expect(200);
    expect(overview.body.requests).toEqual(expect.arrayContaining([expect.objectContaining({ userId: u.user.id, feature: 'loans' })]));
    const sheet = await request(app).get(`/api/v1/admin/users/${u.user.id}/features`).set(auth(admin)).expect(200);
    expect(sheet.body.find((f: { key: string }) => f.key === 'loans').requestedAt).not.toBeNull();

    const granted = await switchFeature(admin, u.user.id, 'loans', true).expect(200);
    expect(granted.body).toMatchObject({ on: true, source: 'admin', changedByEmail: admin.user.email, requestedAt: null });
    expect((await request(app).get('/api/v1/loans').set(auth(u))).status).toBe(200);

    const [issue] = await db.select().from(issueReports).where(eq(issueReports.id, issues[0].id));
    expect(issue.status).toBe('resolved');
    const after = await request(app).get('/api/v1/admin/features').set(auth(admin)).expect(200);
    expect(after.body.requests.some((r: { userId: number }) => r.userId === u.user.id)).toBe(false);

    const log = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.targetId, u.user.id), eq(adminAuditLog.action, 'feature_changed')));
    expect(log.map((l) => l.details)).toEqual(['loans: off -> on, request granted']);
  });

  it('closes the request as won’t fix when staff leave the feature off', async () => {
    const manager = await staff(promoteToSystemManager, 'feat-sm');
    const u = await registerUser({ features: [] });
    await request(app).post('/api/v1/features/investments/request').set(auth(u)).expect(200);

    const refused = await switchFeature(manager, u.user.id, 'investments', false).expect(200);
    expect(refused.body).toMatchObject({ on: false, requestedAt: null });
    const [issue] = await db.select().from(issueReports).where(eq(issueReports.userId, u.user.id));
    expect(issue.status).toBe('wont_fix');
  });

  it('does nothing for a feature that is already on', async () => {
    const u = await registerUser({ features: ['goals'] });
    const res = await request(app).post('/api/v1/features/goals/request').set(auth(u)).expect(200);
    expect(res.body).toMatchObject({ on: true, requested: false });
    expect(await db.select().from(issueReports).where(eq(issueReports.userId, u.user.id))).toHaveLength(0);
  });

  it('rejects an unknown feature', async () => {
    const u = await registerUser();
    expect((await request(app).post('/api/v1/features/crypto/request').set(auth(u))).status).toBe(400);
  });
});

describe('who can see and change feature access', () => {
  it('lets support look but not switch', async () => {
    const support = await staff(promoteToSupport, 'feat-support');
    const u = await registerUser({ features: [] });
    expect((await request(app).get(`/api/v1/admin/users/${u.user.id}/features`).set(auth(support))).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/features').set(auth(support))).status).toBe(200);
    expect((await switchFeature(support, u.user.id, 'goals', true)).status).toBe(403);
    expect((await request(app).put('/api/v1/admin/features/defaults').set(auth(support)).send({ goals: true, loans: true, investments: true })).status).toBe(403);
  });

  it('lets a system manager switch a feature for a user', async () => {
    const manager = await staff(promoteToSystemManager, 'feat-sm');
    const u = await registerUser({ features: [] });
    const res = await switchFeature(manager, u.user.id, 'investments', true).expect(200);
    expect(res.body).toMatchObject({ key: 'investments', on: true, source: 'admin' });
  });

  it('refuses a regular user on every admin feature endpoint', async () => {
    const u = await registerUser();
    const other = await registerUser();
    expect((await request(app).get('/api/v1/admin/features').set(auth(u))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/features/goals/users').set(auth(u))).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/users/${other.user.id}/features`).set(auth(u))).status).toBe(403);
    expect((await switchFeature(u, u.user.id, 'loans', true)).status).toBe(403);
  });

  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/v1/admin/features')).status).toBe(401);
    expect((await request(app).get('/api/v1/features')).status).toBe(401);
  });

  it('404s for a missing user and 400s for a bad body or key', async () => {
    const admin = await staff(promoteToAdmin, 'feat-admin');
    expect((await switchFeature(admin, 999999999, 'goals', true)).status).toBe(404);
    const u = await registerUser();
    expect((await request(app).put(`/api/v1/admin/users/${u.user.id}/features/goals`).set(auth(admin)).send({ on: 'yes' })).status).toBe(400);
    expect((await switchFeature(admin, u.user.id, 'crypto', true)).status).toBe(400);
  });

  it('lists who has a feature on', async () => {
    const admin = await staff(promoteToAdmin, 'feat-admin');
    const u = await registerUser({ features: ['loans'] });
    const res = await request(app).get('/api/v1/admin/features/loans/users?limit=200').set(auth(admin)).expect(200);
    expect(Number(res.headers['x-total-count'])).toBeGreaterThanOrEqual(1);
    const overview = await request(app).get('/api/v1/admin/features').set(auth(admin)).expect(200);
    expect(overview.body.features.find((f: { key: string }) => f.key === 'loans').usersOn).toBeGreaterThanOrEqual(1);
    expect(overview.body.totalUsers).toBeGreaterThanOrEqual(2);
    // Newest change first, so the user just switched on is on the first page.
    expect(res.body.some((r: { id: number }) => r.id === u.user.id)).toBe(true);
  });
});

describe('sign-up defaults', () => {
  it('gives a new account what staff chose, and logs the change', async () => {
    const manager = await staff(promoteToSystemManager, 'feat-sm');
    const before = (await request(app).get('/api/v1/admin/features').set(auth(manager)).expect(200)).body.defaults;
    try {
      const next = { goals: false, loans: true, investments: false };
      await request(app).put('/api/v1/admin/features/defaults').set(auth(manager)).send(next).expect(200);
      expect((await request(app).get('/api/v1/admin/features').set(auth(manager))).body.defaults).toEqual(next);

      const fresh = await registerUser({ features: null });
      expect(fresh.user.features).toEqual(['loans']);
      const me = await request(app).get('/api/v1/auth/me').set(auth(fresh));
      expect(me.body.features).toEqual(['loans']);

      const [entry] = await db
        .select()
        .from(adminAuditLog)
        .where(and(eq(adminAuditLog.actorId, manager.user.id), eq(adminAuditLog.action, 'signup_features_changed')));
      expect(entry.targetEmail).toBe('new sign-ups');
    } finally {
      await request(app).put('/api/v1/admin/features/defaults').set(auth(manager)).send(before).expect(200);
    }
  });

  it('rejects a defaults body with a missing or unknown feature', async () => {
    const admin = await staff(promoteToAdmin, 'feat-admin');
    expect((await request(app).put('/api/v1/admin/features/defaults').set(auth(admin)).send({ goals: true })).status).toBe(400);
    expect(
      (await request(app).put('/api/v1/admin/features/defaults').set(auth(admin)).send({ goals: true, loans: true, investments: true, crypto: true })).status
    ).toBe(400);
  });
});
