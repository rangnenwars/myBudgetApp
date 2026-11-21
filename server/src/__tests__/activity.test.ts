import request from 'supertest';
import crypto from 'crypto';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { app, registerUser, promoteToAdmin, promoteToSupport, promoteToSystemManager, uniqueEmail, uniquePhone, setUserActive } from './helpers';
import { db } from '../db/client';
import { activityDaily, adminAuditLog, userActivity, users } from '../db/schema';
import { coarseLocation, readClient, recordLogin } from '../lib/activity';
import { purgeActivity } from '../lib/activityRetention';
import { groupSessions } from '../routes/adminActivity';

// Sign-ins, sign-outs and page hits: what is recorded, what must never be, who can read it, and how long it is kept.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const uuid = () => crypto.randomUUID();
const rowsOf = (userId: number) => db.select().from(userActivity).where(eq(userActivity.userId, userId)).orderBy(userActivity.id);
const pages = (token: string, body: unknown, headers: Record<string, string> = {}) => request(app).post('/api/v1/activity/pages').set(auth(token)).set(headers).send(body as object);
const login = (email: string, password = 'password123', headers: Record<string, string> = {}) => request(app).post('/api/v1/auth/login').set(headers).send({ email, password });

describe('coarse location', () => {
  it.each([
    ['203.0.113.57', '203.0.113.0/24'],
    ['::ffff:203.0.113.57', '203.0.113.0/24'],
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd::/48'],
    ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['fe80::1%eth0', 'fe80:0:0::/48'],
    ['2001:db8::', '2001:db8:0::/48'],
  ])('%s is kept as %s', (ip, expected) => {
    expect(coarseLocation(ip)).toBe(expected);
  });
  it.each([null, undefined, '', 'not an ip', '999.1.1.1', '1.2.3', '1.2.3.4.5', '12345::', 'g::1'])('%p is not an address, so nothing is kept', (ip) => {
    expect(coarseLocation(ip as string)).toBeNull();
  });
  it('never keeps the last part of the address', () => {
    expect(coarseLocation('203.0.113.57')).not.toContain('57');
    expect(coarseLocation('2001:db8:abcd:12:1:2:3:4')).not.toMatch(/:1:2:3:4/);
  });
});

describe('what the app says about itself', () => {
  const req = (headers: Record<string, string>) => ({ header: (name: string) => headers[name.toLowerCase()] }) as never;
  it('reads a good platform, version and session id', () => {
    const id = uuid();
    expect(readClient(req({ 'x-app-platform': 'Android', 'x-app-version': '1.4.0', 'x-session-id': id.toUpperCase() }))).toEqual({ platform: 'android', appVersion: '1.4.0', sessionId: id });
  });
  it.each([
    [{ 'x-app-platform': 'windows' }],
    [{ 'x-app-platform': '<script>' }],
    [{ 'x-app-version': 'x'.repeat(21) }],
    [{ 'x-app-version': '1 2' }],
    [{ 'x-session-id': 'abc' }],
    [{ 'x-session-id': `${uuid()}; drop table users` }],
  ])('ignores %o', (headers) => {
    const got = readClient(req(headers));
    expect(Object.values(got).every((v) => v === null)).toBe(true);
  });
});

describe('sign-ins and sign-outs', () => {
  it('a sign-in records the time, platform, version, session and only a coarse location', async () => {
    const reg = await registerUser({ password: 'password123' });
    const session = uuid();
    const res = await login(reg.user.email, 'password123', { 'X-App-Platform': 'android', 'X-App-Version': '1.2.3', 'X-Session-Id': session });
    expect(res.status).toBe(200);
    const [signUp, signIn] = await rowsOf(reg.user.id);
    expect(signUp).toMatchObject({ kind: 'login', detail: 'register' });
    expect(signIn).toMatchObject({ kind: 'login', detail: 'password', platform: 'android', appVersion: '1.2.3', sessionId: session, page: null });
    expect(signIn.location).toMatch(/^\d+\.\d+\.\d+\.0\/24$|::\/48$/);
  });

  it('signing up records a sign-in marked as sign-up', async () => {
    const email = uniqueEmail('act-reg');
    const res = await request(app).post('/api/v1/auth/register').set({ 'X-App-Platform': 'web' }).send({ name: 'Asha', email, phone: uniquePhone(), password: 'password123' });
    expect(res.status).toBe(201);
    const rows = await rowsOf(res.body.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'login', detail: 'register', platform: 'web' });
  });

  it('a failed sign-in records nothing', async () => {
    const reg = await registerUser({ password: 'password123' });
    expect((await login(reg.user.email, 'wrong-password')).status).toBe(401);
    expect((await login(uniqueEmail('ghost'), 'password123')).status).toBe(401);
    expect((await rowsOf(reg.user.id)).filter((r) => r.detail === 'password')).toHaveLength(0);
  });

  it('a deactivated account that is refused records nothing', async () => {
    const reg = await registerUser({ password: 'password123' });
    await setUserActive(reg.user.id, false);
    expect((await login(reg.user.email)).status).toBe(403);
    expect((await rowsOf(reg.user.id)).filter((r) => r.detail === 'password')).toHaveLength(0);
  });

  it('signing out records one sign-out, and signing out again records nothing more', async () => {
    const reg = await registerUser({ password: 'password123' });
    const out = await request(app).post('/api/v1/auth/logout').set({ 'X-Session-Id': uuid(), 'X-App-Platform': 'ios' }).send({ refreshToken: reg.refreshToken });
    expect(out.status).toBe(204);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: reg.refreshToken });
    const logouts = (await rowsOf(reg.user.id)).filter((r) => r.kind === 'logout');
    expect(logouts).toHaveLength(1);
    expect(logouts[0]).toMatchObject({ detail: 'single', platform: 'ios' });
  });

  it('signing out with a token that is not real records nothing', async () => {
    const before = await db.select().from(userActivity).where(eq(userActivity.kind, 'logout'));
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'not-a-real-token' });
    expect((await db.select().from(userActivity).where(eq(userActivity.kind, 'logout'))).length).toBe(before.length);
  });

  it('signing out everywhere records it once, marked as everywhere', async () => {
    const reg = await registerUser({ password: 'password123' });
    expect((await request(app).post('/api/v1/auth/me/logout-all').set(auth(reg.accessToken))).status).toBe(204);
    const logouts = (await rowsOf(reg.user.id)).filter((r) => r.kind === 'logout');
    expect(logouts).toHaveLength(1);
    expect(logouts[0].detail).toBe('everywhere');
  });

  it('headers that are not the expected shape are ignored, not stored', async () => {
    const reg = await registerUser({ password: 'password123' });
    await login(reg.user.email, 'password123', { 'X-App-Platform': 'windows', 'X-Session-Id': 'abc', 'X-App-Version': 'a b c' });
    const last = (await rowsOf(reg.user.id)).pop()!;
    expect(last).toMatchObject({ platform: null, sessionId: null, appVersion: null });
  });

  it('a failure to write the record never breaks signing in', async () => {
    // A user that does not exist makes the insert fail on the foreign key: it must resolve quietly.
    const fakeReq = { header: () => undefined, ip: '203.0.113.9' } as never;
    await expect(recordLogin(2_000_000_000, fakeReq, 'password')).resolves.toBeUndefined();
  });
});

describe('POST /activity/pages', () => {
  it('requires authentication', async () => {
    expect((await request(app).post('/api/v1/activity/pages').send({ pages: [{ path: '/' }] })).status).toBe(401);
  });

  it('keeps known pages and says how many it kept and dropped', async () => {
    const { accessToken, user } = await registerUser();
    const session = uuid();
    const res = await pages(accessToken, { pages: [{ path: '/' }, { path: '/transactions' }, { path: '/not-a-page' }] }, { 'X-Session-Id': session, 'X-App-Platform': 'web' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: 2, dropped: 1, sharing: true });
    const rows = (await rowsOf(user.id)).filter((r) => r.kind === 'page');
    expect(rows.map((r) => r.page)).toEqual(['/', '/transactions']);
    expect(rows[0]).toMatchObject({ sessionId: session, platform: 'web' });
  });

  it('stores the page pattern, never the real address, id, month or query', async () => {
    const { accessToken, user } = await registerUser();
    await pages(accessToken, {
      pages: [{ path: '/people/42?from=home' }, { path: '/monthly-expenses/2026-11' }, { path: '/category-trend/groceries_milk#top' }, { path: '/transactions?q=my%20salary&category=rent' }],
    });
    const stored = (await rowsOf(user.id)).filter((r) => r.kind === 'page').map((r) => r.page);
    expect(stored).toEqual(['/people/[id]', '/monthly-expenses/[ym]', '/category-trend/[category]', '/transactions']);
    expect(JSON.stringify(stored)).not.toMatch(/42|2026|groceries|salary|rent|home/);
  });

  it.each(['/people/abc', '/admin/secret', 'https://evil.example/', '//x', '/transactions/../admin', '/people/<script>', '', '/' + 'a'.repeat(150)])('drops %p and stores nothing for it', async (path) => {
    const { accessToken, user } = await registerUser();
    const res = await pages(accessToken, { pages: [{ path }] });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(0);
    expect((await rowsOf(user.id)).filter((r) => r.kind === 'page')).toHaveLength(0);
  });

  it('every stored page is one of the known patterns, whatever is sent', async () => {
    const { accessToken, user } = await registerUser();
    const wild = ['/', '/people/1', '/x', '/settings', "/'; drop table users; --", '/reports?x=1', '/people/99/edit', '/plan-ahead/2027-01', '/goals'];
    await pages(accessToken, { pages: wild.map((path) => ({ path })) });
    const known = /^\/(people\/\[id\]|plan-ahead\/\[ym\]|settings|reports|goals)?$/;
    for (const r of (await rowsOf(user.id)).filter((x) => x.kind === 'page')) expect(r.page).toMatch(known);
  });

  it('keeps a time within the last day, and drops one that is in the future, too old, or not a date', async () => {
    const { accessToken, user } = await registerUser();
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
    const res = await pages(accessToken, {
      pages: [
        { path: '/', at: hoursAgo(2) },
        { path: '/transactions', at: hoursAgo(25) },
        { path: '/reports', at: new Date(Date.now() + 10 * 60_000).toISOString() },
        { path: '/goals', at: 'yesterday' },
        { path: '/settings', at: '' },
      ],
    });
    expect(res.body).toMatchObject({ recorded: 1, dropped: 4 });
    const [row] = (await rowsOf(user.id)).filter((r) => r.kind === 'page');
    expect(row.page).toBe('/');
    expect(Math.abs(row.createdAt.getTime() - (Date.now() - 2 * 3600_000))).toBeLessThan(5000);
  });

  it.each([
    ['no pages', { pages: [] }],
    ['no body', {}],
    ['pages that are not a list', { pages: '/' }],
    ['more than 50 pages', { pages: Array.from({ length: 51 }, () => ({ path: '/' })) }],
    ['a path over 200 characters', { pages: [{ path: '/' + 'a'.repeat(250) }] }],
    ['a path that is not text', { pages: [{ path: 5 }] }],
  ])('refuses %s, and stores nothing', async (_l, body) => {
    const { accessToken, user } = await registerUser();
    expect((await pages(accessToken, body)).status).toBe(400);
    expect((await rowsOf(user.id)).filter((r) => r.kind === 'page')).toHaveLength(0);
  });

  it('accepts exactly 50 pages at once', async () => {
    const { accessToken } = await registerUser();
    const res = await pages(accessToken, { pages: Array.from({ length: 50 }, () => ({ path: '/' })) });
    expect(res.body.recorded).toBe(50);
  });

  it('always records for the person who is signed in, whatever the body says', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await pages(a.accessToken, { pages: [{ path: '/' }], user_id: b.user.id, userId: b.user.id });
    expect((await rowsOf(b.user.id)).filter((r) => r.kind === 'page')).toHaveLength(0);
    expect((await rowsOf(a.user.id)).filter((r) => r.kind === 'page')).toHaveLength(1);
  });

  it('stores nothing about what is in the body besides the path and time', async () => {
    const { accessToken, user } = await registerUser();
    await pages(accessToken, { pages: [{ path: '/transactions', amount: 5000, note: 'secret', email: 'a@b.c', title: 'x' }] });
    const [row] = (await rowsOf(user.id)).filter((r) => r.kind === 'page');
    expect(JSON.stringify(row)).not.toMatch(/5000|secret|a@b\.c/);
  });

  describe('when the person has switched sharing off', () => {
    it('records no pages and says so, but still records sign-ins and sign-outs', async () => {
      const reg = await registerUser({ password: 'password123' });
      expect((await request(app).patch('/api/v1/auth/me/activity-sharing').set(auth(reg.accessToken)).send({ on: false })).body).toEqual({ shareActivity: false });
      const res = await pages(reg.accessToken, { pages: [{ path: '/' }, { path: '/goals' }] });
      expect(res.body).toEqual({ recorded: 0, dropped: 2, sharing: false });
      await login(reg.user.email, 'password123');
      const rows = await rowsOf(reg.user.id);
      expect(rows.filter((r) => r.kind === 'page')).toHaveLength(0);
      expect(rows.filter((r) => r.kind === 'login').length).toBeGreaterThanOrEqual(2);
    });
    it('switching it back on starts recording again', async () => {
      const reg = await registerUser();
      await request(app).patch('/api/v1/auth/me/activity-sharing').set(auth(reg.accessToken)).send({ on: false });
      await request(app).patch('/api/v1/auth/me/activity-sharing').set(auth(reg.accessToken)).send({ on: true });
      expect((await pages(reg.accessToken, { pages: [{ path: '/' }] })).body.recorded).toBe(1);
    });
  });

  describe('rate limit', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });
    it('the 31st report in a minute is refused with 429, and another person is not affected', async () => {
      const a = await registerUser();
      const b = await registerUser();
      process.env.NODE_ENV = 'development';
      for (let i = 0; i < 30; i++) expect((await pages(a.accessToken, { pages: [{ path: '/' }] })).status).toBe(200);
      const blocked = await pages(a.accessToken, { pages: [{ path: '/' }] });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error).toMatch(/Too many/);
      expect((await pages(b.accessToken, { pages: [{ path: '/' }] })).status).toBe(200);
    });
  });
});

describe('PATCH /auth/me/activity-sharing', () => {
  it('requires authentication', async () => {
    expect((await request(app).patch('/api/v1/auth/me/activity-sharing').send({ on: false })).status).toBe(401);
  });
  it('is on for a new account, and the profile shows what was chosen', async () => {
    const reg = await registerUser();
    expect((await request(app).get('/api/v1/auth/me').set(auth(reg.accessToken))).body.shareActivity).toBe(true);
    await request(app).patch('/api/v1/auth/me/activity-sharing').set(auth(reg.accessToken)).send({ on: false });
    expect((await request(app).get('/api/v1/auth/me').set(auth(reg.accessToken))).body.shareActivity).toBe(false);
  });
  it.each([['text', 'no'], ['a number', 0], ['null', null], ['nothing', undefined]])('refuses %s', async (_l, on) => {
    const reg = await registerUser();
    expect((await request(app).patch('/api/v1/auth/me/activity-sharing').set(auth(reg.accessToken)).send({ on })).status).toBe(400);
    expect((await request(app).get('/api/v1/auth/me').set(auth(reg.accessToken))).body.shareActivity).toBe(true);
  });
});

describe('GET /activity/me (my sign-in history)', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/activity/me')).status).toBe(401);
  });
  it('lists my own sign-ins and sign-outs, newest first, and no page hits', async () => {
    const reg = await registerUser({ password: 'password123' });
    await pages(reg.accessToken, { pages: [{ path: '/' }] });
    await login(reg.user.email, 'password123', { 'X-App-Platform': 'web' });
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: reg.refreshToken });
    const res = await request(app).get('/api/v1/activity/me').set(auth(reg.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.map((r: { kind: string }) => r.kind)).toEqual(['logout', 'login', 'login']);
    expect(Object.keys(res.body[0]).sort()).toEqual(['at', 'detail', 'kind', 'location', 'platform']);
  });
  it("never shows someone else's", async () => {
    const a = await registerUser();
    const b = await registerUser();
    const res = await request(app).get('/api/v1/activity/me').set(auth(a.accessToken));
    expect(res.body).toHaveLength(1);
    expect((await request(app).get('/api/v1/activity/me').set(auth(b.accessToken))).body).toHaveLength(1);
  });
  it('leaves out anything older than 90 days', async () => {
    const reg = await registerUser();
    await db.insert(userActivity).values({ userId: reg.user.id, kind: 'login', createdAt: new Date(Date.now() - 100 * 86400_000) });
    expect((await request(app).get('/api/v1/activity/me').set(auth(reg.accessToken))).body).toHaveLength(1);
  });
});

describe('admin overview', () => {
  const overview = (token: string, days?: number | string) => request(app).get('/api/v1/admin/activity/overview').query(days === undefined ? {} : { days }).set(auth(token));
  const asRole = async (role: 'admin' | 'system' | 'support') => {
    const r = await registerUser();
    if (role === 'admin') await promoteToAdmin(r.user.id);
    if (role === 'system') await promoteToSystemManager(r.user.id);
    if (role === 'support') await promoteToSupport(r.user.id);
    return r.accessToken;
  };

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/admin/activity/overview')).status).toBe(401);
  });
  it('an ordinary user and support staff are refused; an admin and a system manager can read it', async () => {
    const user = await registerUser();
    expect((await overview(user.accessToken)).status).toBe(403);
    expect((await overview(await asRole('support'))).status).toBe(403);
    expect((await overview(await asRole('admin'))).status).toBe(200);
    expect((await overview(await asRole('system'))).status).toBe(200);
  });

  it('counts sign-ins, people and page views, with the most visited pages and the platform split', async () => {
    const token = await asRole('admin');
    const before = (await overview(token, 7)).body;
    const a = await registerUser();
    const b = await registerUser();
    await pages(a.accessToken, { pages: [{ path: '/' }, { path: '/' }, { path: '/transactions' }] }, { 'X-App-Platform': 'web' });
    await pages(b.accessToken, { pages: [{ path: '/' }] });
    const after = (await overview(token, 7)).body;
    // Other test files register people at the same time, so totals can only be checked as "at least".
    expect(after.logins - before.logins).toBeGreaterThanOrEqual(2); // each registered, so each signed in once
    expect(after.people - before.people).toBeGreaterThanOrEqual(2);
    expect(after.pageViews - before.pageViews).toBeGreaterThanOrEqual(4);
    const home = (p: { topPages: { page: string; label: string; count: number }[] }) => p.topPages.find((t) => t.page === '/');
    expect(home(after)!.label).toBe('Home');
    expect(home(after)!.count - (home(before)?.count ?? 0)).toBe(3);
    expect(Object.keys(after).sort()).toEqual(['byDay', 'days', 'logins', 'pageViews', 'people', 'platforms', 'topPages']);
  });

  it('leaves company accounts out, so staff testing does not count', async () => {
    const token = await asRole('admin');
    const staff = await registerUser();
    await db.update(users).set({ accountKind: 'company' }).where(eq(users.id, staff.user.id));
    // 100 views of a page nobody else here opens: if they were counted it would top the list.
    for (let i = 0; i < 2; i++) await pages(staff.accessToken, { pages: Array.from({ length: 50 }, () => ({ path: '/accounts' })) });
    expect((await rowsOf(staff.user.id)).filter((r) => r.page === '/accounts')).toHaveLength(100);
    const after = (await overview(token, 7)).body;
    expect(after.topPages.find((t: { page: string }) => t.page === '/accounts')).toBeUndefined();
  });

  it('only counts what falls inside the range', async () => {
    const token = await asRole('admin');
    const reg = await registerUser();
    await db.insert(userActivity).values({ userId: reg.user.id, kind: 'page', page: '/budgets', createdAt: new Date(Date.now() - 20 * 86400_000) });
    const week = (await overview(token, 7)).body.topPages.find((t: { page: string }) => t.page === '/budgets')?.count ?? 0;
    const month = (await overview(token, 30)).body.topPages.find((t: { page: string }) => t.page === '/budgets')?.count ?? 0;
    expect(month).toBeGreaterThan(week);
  });

  it.each([0, 91, -1, 1.5, 'x', ''])('refuses a range of %p days', async (days) => {
    expect((await overview(await asRole('admin'), days as number)).status).toBe(400);
  });
  it('shows counts only: no person, email or address anywhere', async () => {
    const token = await asRole('admin');
    const text = JSON.stringify((await overview(token, 30)).body);
    expect(text).not.toMatch(/@|\.0\/24|::\/48|email/);
  });
});

describe('one person\'s timeline (admin only)', () => {
  const timeline = (token: string, id: number | string, days?: number | string) => request(app).get(`/api/v1/admin/activity/users/${id}`).query(days === undefined ? {} : { days }).set(auth(token));
  const adminToken = async () => {
    const a = await registerUser();
    await promoteToAdmin(a.user.id);
    return { token: a.accessToken, id: a.user.id, email: a.user.email };
  };

  it('requires authentication, and refuses an ordinary user, support and a system manager', async () => {
    const target = await registerUser();
    expect((await request(app).get(`/api/v1/admin/activity/users/${target.user.id}`)).status).toBe(401);
    expect((await timeline(target.accessToken, target.user.id)).status).toBe(403);
    const support = await registerUser();
    await promoteToSupport(support.user.id);
    expect((await timeline(support.accessToken, target.user.id)).status).toBe(403);
    const sm = await registerUser();
    await promoteToSystemManager(sm.user.id);
    expect((await timeline(sm.accessToken, target.user.id)).status).toBe(403);
  });

  it('groups a visit by its session: signed in, the pages in order, signed out', async () => {
    const admin = await adminToken();
    const reg = await registerUser({ password: 'password123' });
    const session = uuid();
    const headers = { 'X-Session-Id': session, 'X-App-Platform': 'android' };
    await login(reg.user.email, 'password123', headers);
    await pages(reg.accessToken, { pages: [{ path: '/' }, { path: '/transactions' }, { path: '/reports' }] }, headers);
    await request(app).post('/api/v1/auth/logout').set(headers).send({ refreshToken: reg.refreshToken });

    const res = await timeline(admin.token, reg.user.id);
    expect(res.status).toBe(200);
    expect(res.body.person).toMatchObject({ id: reg.user.id, email: reg.user.email });
    const mine = res.body.sessions.find((s: { events: { kind: string }[] }) => s.events.some((e) => e.kind === 'logout'));
    expect(mine.platform).toBe('android');
    expect(mine.events.map((e: { kind: string; page: string | null }) => e.page ?? e.kind)).toEqual(expect.arrayContaining(['login', '/', '/transactions', '/reports', 'logout']));
    const order = mine.events.map((e: { page: string | null; kind: string }) => e.page ?? e.kind);
    expect(order.indexOf('/')).toBeLessThan(order.indexOf('/reports'));
    expect(order[order.length - 1]).toBe('logout');
    expect(mine.events.find((e: { page: string }) => e.page === '/').label).toBe('Home');
  });

  it('every look at a person is written to the audit log with who looked', async () => {
    const admin = await adminToken();
    const reg = await registerUser();
    await timeline(admin.token, reg.user.id, 14);
    const rows = await db.select().from(adminAuditLog).where(and(eq(adminAuditLog.targetId, reg.user.id), eq(adminAuditLog.action, 'viewed_activity')));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: admin.id, actorEmail: admin.email, targetEmail: reg.user.email, details: 'last 14 days' });
  });

  it('a refused look is not logged as a view', async () => {
    const target = await registerUser();
    const other = await registerUser();
    await timeline(other.accessToken, target.user.id);
    const rows = await db.select().from(adminAuditLog).where(and(eq(adminAuditLog.targetId, target.user.id), eq(adminAuditLog.action, 'viewed_activity')));
    expect(rows).toHaveLength(0);
  });

  it("does not include another person's events", async () => {
    const admin = await adminToken();
    const a = await registerUser();
    const b = await registerUser();
    await pages(b.accessToken, { pages: [{ path: '/settings' }] });
    const res = await timeline(admin.token, a.user.id);
    expect(JSON.stringify(res.body)).not.toContain('/settings');
  });

  it.each([['an unknown person', 987654321, 404], ['a bad id', 'abc', 400], ['zero', 0, 400]])('%s is %s', async (_l, id, status) => {
    const admin = await adminToken();
    expect((await timeline(admin.token, id as number)).status).toBe(status);
  });
  it.each([0, 91, 'x'])('refuses a range of %p days', async (days) => {
    const admin = await adminToken();
    const reg = await registerUser();
    expect((await timeline(admin.token, reg.user.id, days as number)).status).toBe(400);
  });
});

describe('grouping events into sessions', () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 10, 21, 9, minutes));
  const row = (minutes: number, sessionId: string | null, page: string | null = '/', kind: 'login' | 'logout' | 'page' = 'page') => ({ kind, page: kind === 'page' ? page : null, platform: 'web', location: null, sessionId, detail: null, at: at(minutes) });

  it('events with the same session id are one session, newest session first', () => {
    const sessions = groupSessions([row(0, 'a'), row(1, 'a', '/goals'), row(60, 'b'), row(61, 'b', '/reports')]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].events.map((e) => e.page)).toEqual(['/', '/reports']);
    expect(sessions[1].events.map((e) => e.page)).toEqual(['/', '/goals']);
  });
  it('without a session id, a gap of more than half an hour starts a new session', () => {
    expect(groupSessions([row(0, null), row(10, null), row(50, null)])).toHaveLength(2);
    expect(groupSessions([row(0, null), row(30, null)])).toHaveLength(1);
  });
  it('an event with no session id joins the session just before it, within the gap', () => {
    const sessions = groupSessions([row(0, 'a'), row(1, null, '/goals')]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].events).toHaveLength(2);
  });
  it('the same id after a long idle gap is shown as a new visit', () => {
    expect(groupSessions([row(0, 'a'), row(100, 'a')])).toHaveLength(2);
  });
  it('knows when a session started and ended', () => {
    const [s] = groupSessions([row(0, 'a', null, 'login'), row(5, 'a'), row(9, 'a', null, 'logout')]);
    expect(s.start).toEqual(at(0));
    expect(s.end).toEqual(at(9));
  });
  it('no events, no sessions', () => {
    expect(groupSessions([])).toEqual([]);
  });
});

describe('keeping activity for 90 days', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86400_000);

  it('adds old activity up into daily counts and deletes it; recent activity stays', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await db.insert(userActivity).values([
      { userId: a.user.id, kind: 'page', page: '/', platform: 'web', createdAt: daysAgo(120) },
      { userId: a.user.id, kind: 'page', page: '/', platform: 'web', createdAt: daysAgo(120) },
      { userId: b.user.id, kind: 'page', page: '/', platform: 'web', createdAt: daysAgo(120) },
      { userId: a.user.id, kind: 'login', platform: 'web', createdAt: daysAgo(120) },
      { userId: a.user.id, kind: 'page', page: '/goals', createdAt: daysAgo(5) },
    ]);
    const result = await purgeActivity(now);
    expect(result.removed).toBeGreaterThanOrEqual(5);
    const left = await rowsOf(a.user.id);
    expect(left.filter((r) => r.createdAt < daysAgo(90))).toHaveLength(0);
    expect(left.filter((r) => r.page === '/goals')).toHaveLength(1);

    const day = daysAgo(120).toISOString().slice(0, 10);
    const [daily] = await db.select().from(activityDaily).where(and(eq(activityDaily.day, day), eq(activityDaily.kind, 'page'), eq(activityDaily.page, '/'), eq(activityDaily.platform, 'web')));
    expect(daily.events).toBeGreaterThanOrEqual(3);
    expect(daily.people).toBeGreaterThanOrEqual(2);
  });

  it('keeps only anonymous numbers: the daily table has no person in it', async () => {
    const columns = Object.keys(getTableColumns(activityDaily));
    expect(columns).not.toContain('userId');
    expect(columns.sort()).toEqual(['day', 'events', 'kind', 'page', 'people', 'platform']);
  });

  it('leaves company accounts out of the daily counts, though their old rows are still removed', async () => {
    const staff = await registerUser();
    await db.update(users).set({ accountKind: 'company' }).where(eq(users.id, staff.user.id));
    await db.insert(userActivity).values({ userId: staff.user.id, kind: 'page', page: '/people', platform: 'ios', createdAt: daysAgo(200) });
    await purgeActivity(now);
    expect((await rowsOf(staff.user.id)).filter((r) => r.createdAt < daysAgo(90))).toHaveLength(0);
    const day = daysAgo(200).toISOString().slice(0, 10);
    expect(await db.select().from(activityDaily).where(and(eq(activityDaily.day, day), eq(activityDaily.page, '/people'), eq(activityDaily.platform, 'ios')))).toHaveLength(0);
  });

  it('running it twice changes nothing the second time', async () => {
    const reg = await registerUser();
    await db.insert(userActivity).values({ userId: reg.user.id, kind: 'login', platform: 'web', createdAt: daysAgo(300) });
    await purgeActivity(now);
    const second = await purgeActivity(now);
    expect(second.removed).toBe(0);
  });

  it('a day of activity right at the cut-off is rolled up whole, never split', async () => {
    const reg = await registerUser();
    const cutoffDay = new Date(Date.UTC(2026, 10, 21) - 90 * 86400_000);
    await db.insert(userActivity).values([
      { userId: reg.user.id, kind: 'page', page: '/budgets', platform: 'web', createdAt: new Date(cutoffDay.getTime() - 60_000) },
      { userId: reg.user.id, kind: 'page', page: '/budgets', platform: 'web', createdAt: new Date(cutoffDay.getTime() + 60_000) },
    ]);
    await purgeActivity(now);
    const left = (await rowsOf(reg.user.id)).filter((r) => r.page === '/budgets');
    expect(left).toHaveLength(1);
    expect(left[0].createdAt.getTime()).toBeGreaterThanOrEqual(cutoffDay.getTime());
  });
});

describe('removal and export', () => {
  it("deleting an account removes that person's activity", async () => {
    const reg = await registerUser();
    await pages(reg.accessToken, { pages: [{ path: '/' }] });
    expect((await rowsOf(reg.user.id)).length).toBeGreaterThan(0);
    await db.delete(users).where(eq(users.id, reg.user.id));
    expect(await rowsOf(reg.user.id)).toHaveLength(0);
  });

  it('"Download my data" includes my own activity and my sharing choice, and nobody else\'s', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await pages(a.accessToken, { pages: [{ path: '/goals' }] });
    await pages(b.accessToken, { pages: [{ path: '/settings' }] });
    const res = await request(app).get('/api/v1/auth/me/export').set(auth(a.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.profile.shareActivity).toBe(true);
    const pagesOut = res.body.activity.filter((r: { kind: string }) => r.kind === 'page').map((r: { page: string }) => r.page);
    expect(pagesOut).toEqual(['/goals']);
    expect(JSON.stringify(res.body.activity)).not.toContain('/settings');
    expect(Object.keys(res.body.activity[0]).sort()).toEqual(['at', 'detail', 'kind', 'location', 'page', 'platform']);
  });
});

describe('what the database itself refuses', () => {
  const insert = async (values: Partial<typeof userActivity.$inferInsert>) => {
    const reg = await registerUser();
    return db.insert(userActivity).values({ userId: reg.user.id, kind: 'page', page: '/', ...values });
  };
  it('a page hit with no page', async () => {
    await expect(insert({ page: null })).rejects.toThrow();
  });
  it('a sign-in that carries a page', async () => {
    await expect(insert({ kind: 'login', page: '/' })).rejects.toThrow();
  });
  it('an unknown kind', async () => {
    await expect(insert({ kind: 'click' as never })).rejects.toThrow();
  });
  it('an unknown platform', async () => {
    await expect(insert({ platform: 'windows' as never })).rejects.toThrow();
  });
  it('a page longer than 80 characters', async () => {
    await expect(insert({ page: '/' + 'a'.repeat(100) })).rejects.toThrow();
  });
  it('a row for a person who does not exist', async () => {
    await expect(db.insert(userActivity).values({ userId: 2_000_000_001, kind: 'login' })).rejects.toThrow();
  });
});
