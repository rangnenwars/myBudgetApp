import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { issueReports, userFeatures } from '../db/schema';
import { app, uniqueEmail, registerUser, promoteToAdmin, RegisteredUser } from './helpers';

const auth = (u: RegisteredUser) => ({ Authorization: `Bearer ${u.accessToken}` });

const admin = async () => {
  const u = await registerUser({ email: uniqueEmail('price-admin') });
  await promoteToAdmin(u.user.id);
  return u;
};

const switchOn = (actor: RegisteredUser, userId: number, key: string, period?: 'month' | 'year' | 'none') =>
  request(app).put(`/api/v1/admin/users/${userId}/features/${key}`).set(auth(actor)).send({ on: true, ...(period ? { period } : {}) });

const expireNow = (userId: number, key: string) =>
  db
    .update(userFeatures)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(and(eq(userFeatures.userId, userId), eq(userFeatures.featureKey, key)));

const myFeature = async (u: RegisteredUser, key: string) =>
  (await request(app).get('/api/v1/features').set(auth(u)).expect(200)).body.find((f: { key: string }) => f.key === key);

const DAY = 24 * 60 * 60 * 1000;

describe('feature catalog for users', () => {
  it("lists every feature with the plan's price and period", async () => {
    const u = await registerUser({ features: [] });
    const res = await request(app).get('/api/v1/features').set(auth(u)).expect(200);
    expect(res.body.map((f: { key: string }) => f.key)).toEqual(['goals', 'loans', 'investments', 'forecast']);
    expect(res.body[0]).toMatchObject({ price: 200, period: 'year', on: false, ended: false, requested: false, expiresAt: null });
  });
});

describe('switching on for a period', () => {
  it('lasts a month, a year, or has no end', async () => {
    const a = await admin();
    const u = await registerUser({ features: [] });

    const month = await switchOn(a, u.user.id, 'goals', 'month').expect(200);
    const monthDays = (new Date(month.body.expiresAt).getTime() - Date.now()) / DAY;
    expect(month.body.on).toBe(true);
    expect(monthDays).toBeGreaterThan(27);
    expect(monthDays).toBeLessThan(32);
    expect((await myFeature(u, 'goals')).expiresAt).toBe(month.body.expiresAt);

    const year = await switchOn(a, u.user.id, 'goals', 'year').expect(200);
    expect((new Date(year.body.expiresAt).getTime() - Date.now()) / DAY).toBeGreaterThan(360);

    const open = await switchOn(a, u.user.id, 'loans').expect(200);
    expect(open.body).toMatchObject({ on: true, expiresAt: null });
  });

  it('rejects an unknown period', async () => {
    const a = await admin();
    const u = await registerUser({ features: [] });
    await request(app).put(`/api/v1/admin/users/${u.user.id}/features/goals`).set(auth(a)).send({ on: true, period: 'week' }).expect(400);
  });
});

describe('when access ends', () => {
  it('turns the feature off for the user but keeps their data', async () => {
    const a = await admin();
    const u = await registerUser({ features: [] });
    await switchOn(a, u.user.id, 'goals', 'month').expect(200);
    await request(app).post('/api/v1/goals').set(auth(u)).send({ name: 'Phone', target_amount: 20000 }).expect(201);

    await expireNow(u.user.id, 'goals');

    const res = await request(app).get('/api/v1/goals').set(auth(u));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FEATURE_NOT_ADDED');
    expect((await request(app).get('/api/v1/auth/me').set(auth(u))).body.features).toEqual([]);
    expect(await myFeature(u, 'goals')).toMatchObject({ on: false, ended: true, requested: false, expiresAt: null });

    await switchOn(a, u.user.id, 'goals', 'month').expect(200);
    const goals = await request(app).get('/api/v1/goals').set(auth(u)).expect(200);
    expect(goals.body).toHaveLength(1);
  });

  it('is not counted as someone having the feature', async () => {
    const a = await admin();
    const u = await registerUser({ features: [] });
    await switchOn(a, u.user.id, 'investments', 'month').expect(200);
    const before = (await request(app).get('/api/v1/admin/features').set(auth(a)).expect(200)).body.features.find((f: { key: string }) => f.key === 'investments').usersOn;
    await expireNow(u.user.id, 'investments');
    const after = (await request(app).get('/api/v1/admin/features').set(auth(a)).expect(200)).body.features.find((f: { key: string }) => f.key === 'investments').usersOn;
    expect(after).toBe(before - 1);
  });

  it('lets the user ask again, and staff see the request with whether they said they paid', async () => {
    const a = await admin();
    const u = await registerUser({ features: [] });
    await switchOn(a, u.user.id, 'forecast', 'month').expect(200);
    await expireNow(u.user.id, 'forecast');

    const asked = await request(app).post('/api/v1/features/forecast/request').set(auth(u)).send({ paid: true }).expect(200);
    expect(asked.body).toMatchObject({ on: false, ended: true, requested: true });

    const overview = (await request(app).get('/api/v1/admin/features').set(auth(a)).expect(200)).body;
    expect(overview.requests).toEqual(expect.arrayContaining([expect.objectContaining({ userId: u.user.id, feature: 'forecast', paid: true })]));
    const [issue] = await db.select().from(issueReports).where(and(eq(issueReports.userId, u.user.id), eq(issueReports.screen, 'forecast')));
    expect(issue.description).toContain('says they paid');

    const granted = await switchOn(a, u.user.id, 'forecast', 'year').expect(200);
    expect(granted.body).toMatchObject({ on: true, requestedAt: null });
    expect((await request(app).get('/api/v1/features').set(auth(u))).body.find((f: { key: string }) => f.key === 'forecast')).toMatchObject({ on: true, requested: false, ended: false });
    const [closed] = await db.select().from(issueReports).where(eq(issueReports.id, issue.id));
    expect(closed.status).toBe('resolved');
  });
});

describe('asking without paying', () => {
  it('records a plain request and keeps asking harmless while one is waiting', async () => {
    const a = await admin();
    const u = await registerUser({ features: [] });
    await request(app).post('/api/v1/features/loans/request').set(auth(u)).expect(200);
    await request(app).post('/api/v1/features/loans/request').set(auth(u)).send({ paid: true }).expect(200);

    const overview = (await request(app).get('/api/v1/admin/features').set(auth(a)).expect(200)).body;
    const mine = overview.requests.filter((r: { userId: number }) => r.userId === u.user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].paid).toBe(false);
  });

  it('does nothing for a feature the user already has', async () => {
    const u = await registerUser({ features: ['goals'] });
    const res = await request(app).post('/api/v1/features/goals/request').set(auth(u)).expect(200);
    expect(res.body).toMatchObject({ on: true, requested: false });
  });
});
