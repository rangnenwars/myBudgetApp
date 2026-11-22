import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser, promoteToAdmin } from './helpers';
import { db } from '../db/client';
import { tourOutcomes, users } from '../db/schema';

// The first-time tour records how it ended, once per person, for counts on System metrics only.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const record = (token: string, body: Record<string, unknown>) => request(app).post('/api/v1/tour/outcome').set(auth(token)).send(body);
const metrics = async (token: string) => (await request(app).get('/api/v1/system/metrics').set(auth(token))).body.tour as { finished: number; skipped: number; skippedByStep: Record<string, number>; hindi: number };
const admin = async () => {
  const a = await registerUser();
  await promoteToAdmin(a.user.id);
  return a.accessToken;
};

describe('POST /tour/outcome', () => {
  it('requires authentication', async () => {
    expect((await request(app).post('/api/v1/tour/outcome').send({ outcome: 'skipped', step: 1 })).status).toBe(401);
  });

  it('records a finished tour', async () => {
    const { accessToken, user } = await registerUser();
    const res = await record(accessToken, { outcome: 'finished', step: 5, language: 'en' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ recorded: true });
    const [row] = await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, user.id));
    expect(row).toMatchObject({ outcome: 'finished', step: 5, language: 'en' });
  });

  it('records a skip and the card it happened on', async () => {
    const { accessToken, user } = await registerUser();
    expect((await record(accessToken, { outcome: 'skipped', step: 2, language: 'hi' })).status).toBe(201);
    const [row] = await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, user.id));
    expect(row).toMatchObject({ outcome: 'skipped', step: 2, language: 'hi' });
  });

  it('English is the default language', async () => {
    const { accessToken, user } = await registerUser();
    await record(accessToken, { outcome: 'skipped', step: 1 });
    const [row] = await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, user.id));
    expect(row.language).toBe('en');
  });

  it('the first outcome is kept; a replay records nothing', async () => {
    const { accessToken, user } = await registerUser();
    await record(accessToken, { outcome: 'skipped', step: 2 });
    const again = await record(accessToken, { outcome: 'finished', step: 5 });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ recorded: false });
    const rows = await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'skipped', step: 2 });
  });

  it('two at the same moment still leave one row', async () => {
    const { accessToken, user } = await registerUser();
    const results = await Promise.all([record(accessToken, { outcome: 'skipped', step: 1 }), record(accessToken, { outcome: 'finished', step: 5 })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, user.id))).toHaveLength(1);
  });

  it.each([
    ['no outcome', { step: 1 }],
    ['an unknown outcome', { outcome: 'abandoned', step: 1 }],
    ['no step', { outcome: 'skipped' }],
    ['step 0', { outcome: 'skipped', step: 0 }],
    ['step 21', { outcome: 'skipped', step: 21 }],
    ['a fractional step', { outcome: 'skipped', step: 1.5 }],
    ['a text step', { outcome: 'skipped', step: 'one' }],
    ['an unknown language', { outcome: 'skipped', step: 1, language: 'fr' }],
    ['an empty body', {}],
    ['an array', [{ outcome: 'skipped', step: 1 }]],
  ])('refuses %s and records nothing', async (_label, body) => {
    const { accessToken, user } = await registerUser();
    expect((await record(accessToken, body as Record<string, unknown>)).status).toBe(400);
    expect(await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, user.id))).toHaveLength(0);
  });

  it('cannot record for someone else: it always records for the caller', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await record(a.accessToken, { outcome: 'skipped', step: 1, user_id: b.user.id, userId: b.user.id });
    expect(await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, b.user.id))).toHaveLength(0);
    expect(await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, a.user.id))).toHaveLength(1);
  });
});

describe('the tour counts on System metrics', () => {
  it('counts finished and skipped, and where people skipped', async () => {
    const token = await admin();
    const before = await metrics(token);
    const a = await registerUser();
    const b = await registerUser();
    const c = await registerUser();
    await record(a.accessToken, { outcome: 'finished', step: 5 });
    await record(b.accessToken, { outcome: 'skipped', step: 2, language: 'hi' });
    await record(c.accessToken, { outcome: 'skipped', step: 2 });
    const after = await metrics(token);
    expect(after.finished - before.finished).toBe(1);
    expect(after.skipped - before.skipped).toBe(2);
    expect((after.skippedByStep['2'] ?? 0) - (before.skippedByStep['2'] ?? 0)).toBe(2);
    expect(after.hindi - before.hindi).toBe(1);
  });

  it('leaves company accounts out, so staff testing the tour does not count', async () => {
    const token = await admin();
    const before = await metrics(token);
    const staff = await registerUser();
    await db.update(users).set({ accountKind: 'company' }).where(eq(users.id, staff.user.id));
    await record(staff.accessToken, { outcome: 'skipped', step: 1 });
    const after = await metrics(token);
    expect(after.skipped).toBe(before.skipped);
  });

  it('shows counts only, never who', async () => {
    const token = await admin();
    const res = await request(app).get('/api/v1/system/metrics').set(auth(token));
    expect(Object.keys(res.body.tour).sort()).toEqual(['finished', 'hindi', 'skipped', 'skippedByStep']);
    expect(JSON.stringify(res.body.tour)).not.toMatch(/@|email|user/i);
  });

  it('an ordinary user cannot read them', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).get('/api/v1/system/metrics').set(auth(accessToken))).status).toBe(403);
  });

  it('removing a user removes their row', async () => {
    const { accessToken, user } = await registerUser();
    await record(accessToken, { outcome: 'skipped', step: 1 });
    await db.delete(users).where(eq(users.id, user.id));
    expect(await db.select().from(tourOutcomes).where(eq(tourOutcomes.userId, user.id))).toHaveLength(0);
  });
});

describe('GET /tour/status (who should see the first-time tour)', () => {
  const status = (token: string) => request(app).get('/api/v1/tour/status').set(auth(token));
  const ageDays = (id: number, days: number) => db.update(users).set({ createdAt: new Date(Date.now() - days * 86400_000) }).where(eq(users.id, id));

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/tour/status')).status).toBe(401);
  });
  it('a brand new account should see it', async () => {
    const { accessToken } = await registerUser();
    expect((await status(accessToken)).body).toEqual({ pending: true });
  });
  it('still true at a later sign-in on another device, until it has an outcome', async () => {
    const { accessToken } = await registerUser();
    expect((await status(accessToken)).body.pending).toBe(true);
    expect((await status(accessToken)).body.pending).toBe(true);
  });
  it('is false after finishing or skipping it, wherever that happened', async () => {
    for (const outcome of ['finished', 'skipped']) {
      const { accessToken } = await registerUser();
      await record(accessToken, { outcome, step: 2 });
      expect((await status(accessToken)).body.pending).toBe(false);
    }
  });
  it('is false for an account older than 7 days, true just inside it', async () => {
    const old = await registerUser();
    await ageDays(old.user.id, 8);
    expect((await status(old.accessToken)).body.pending).toBe(false);
    const recent = await registerUser();
    await ageDays(recent.user.id, 6);
    expect((await status(recent.accessToken)).body.pending).toBe(true);
  });
  it('is false for company accounts, so staff are not shown it', async () => {
    const { accessToken, user } = await registerUser();
    await db.update(users).set({ accountKind: 'company' }).where(eq(users.id, user.id));
    expect((await status(accessToken)).body.pending).toBe(false);
  });
  it('is about the person asking, not anyone else', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await record(a.accessToken, { outcome: 'finished', step: 5 });
    expect((await status(a.accessToken)).body.pending).toBe(false);
    expect((await status(b.accessToken)).body.pending).toBe(true);
  });
});
