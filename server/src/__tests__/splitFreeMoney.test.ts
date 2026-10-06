import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { freeMoneySnapshots } from '../db/schema';
import { localToday } from '../lib/clock';
import { weekStartOf } from '../lib/freeMoneyDay';
import { computeFreeMoneyDay } from '../calculations';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const today = localToday();
const TODAY = today.iso;
const DAYS_IN_MONTH = new Date(Date.UTC(today.year, today.month, 0)).getUTCDate();
const monthStart = (delta: number) => {
  const d = new Date(Date.UTC(today.year, today.month - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-10`;
};

const split = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/transactions/split')
    .set(auth(token))
    .send({ type: 'expense', date: TODAY, total: 2000, lines: [{ category_key: 'groceries_milk', amount: 1200 }, { category_key: 'shopping', amount: 800 }], ...body });

const listTxns = async (token: string) => (await request(app).get('/api/v1/transactions').set(auth(token))).body as { category: string; amount: number; note: string | null; splitGroup: string | null }[];

describe('POST /transactions/split', () => {
  it('requires authentication', async () => {
    expect((await request(app).post('/api/v1/transactions/split').send({})).status).toBe(401);
  });

  it('saves one entry per line, all sharing a split group', async () => {
    const { accessToken } = await registerUser();
    const res = await split(accessToken, { note: 'Big shop' });
    expect(res.status).toBe(201);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries.map((e: { splitGroup: string }) => e.splitGroup)).toEqual([res.body.splitGroup, res.body.splitGroup]);

    const rows = await listTxns(accessToken);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.category === 'groceries_milk')).toMatchObject({ amount: 1200, note: 'Big shop' });
    expect(rows.find((r) => r.category === 'shopping')).toMatchObject({ amount: 800 });

    const summary = await request(app)
      .get('/api/v1/reports/summary')
      .query({ startMonth: today.month, startYear: today.year, endMonth: today.month, endYear: today.year })
      .set(auth(accessToken));
    expect(summary.body.totalExpense).toBe(2000);
  });

  it('leaves ordinary entries without a split group', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 50, type: 'expense', category_key: 'shopping', date: TODAY });
    expect((await listTxns(accessToken))[0].splitGroup).toBeNull();
  });

  it('accepts lines that add up despite floating-point noise', async () => {
    const { accessToken } = await registerUser();
    const res = await split(accessToken, { total: 0.3, lines: [{ category_key: 'groceries_milk', amount: 0.1 }, { category_key: 'shopping', amount: 0.2 }] });
    expect(res.status).toBe(201);
  });

  it('rejects lines that do not add up to the total, saving nothing', async () => {
    const { accessToken } = await registerUser();
    const res = await split(accessToken, { total: 2500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/add up/);
    expect(await listTxns(accessToken)).toHaveLength(0);
  });

  it('rejects fewer than two lines, and the same category twice', async () => {
    const { accessToken } = await registerUser();
    expect((await split(accessToken, { total: 100, lines: [{ category_key: 'shopping', amount: 100 }] })).status).toBe(400);
    const dup = await split(accessToken, { total: 100, lines: [{ category_key: 'shopping', amount: 40 }, { category_key: 'shopping', amount: 60 }] });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/only once/);
  });

  it('saves nothing when any category is invalid (all or nothing)', async () => {
    const { accessToken } = await registerUser();
    const res = await split(accessToken, { lines: [{ category_key: 'groceries_milk', amount: 1200 }, { category_key: 'no_such_category', amount: 800 }] });
    expect(res.status).toBe(400);
    expect(await listTxns(accessToken)).toHaveLength(0);
  });

  it('rejects a category of the wrong type, and non-positive or malformed amounts', async () => {
    const { accessToken } = await registerUser();
    expect((await split(accessToken, { lines: [{ category_key: 'groceries_milk', amount: 1200 }, { category_key: 'salary_1', amount: 800 }] })).status).toBe(400);
    expect((await split(accessToken, { total: 100, lines: [{ category_key: 'shopping', amount: 150 }, { category_key: 'groceries_milk', amount: -50 }] })).status).toBe(400);
    expect((await split(accessToken, { date: '2026-02-30' })).status).toBe(400);
  });

  it("rejects another user's custom category", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(owner.accessToken)).send({ name: 'Pet supplies', type: 'expense' });
    const res = await split(other.accessToken, { lines: [{ category_key: 'groceries_milk', amount: 1200 }, { category_key: created.body.key, amount: 800 }] });
    expect(res.status).toBe(400);
  });

  it('lets a user split across their own custom category', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Pet supplies', type: 'expense' });
    const res = await split(accessToken, { lines: [{ category_key: 'groceries_milk', amount: 1200 }, { category_key: created.body.key, amount: 800 }] });
    expect(res.status).toBe(201);
  });
});

describe('weekStartOf', () => {
  it('returns the Monday of the week', () => {
    expect(weekStartOf('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05'); // Sunday
    expect(weekStartOf('2026-10-14')).toBe('2026-10-12'); // Wednesday
    expect(weekStartOf('2026-01-01')).toBe('2025-12-29'); // crosses the year
  });
});

describe('GET /reports/free-money-day', () => {
  const addRule = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/transactions').set(auth(token)).send({ date: TODAY, repeat_monthly: true, ...body });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/reports/free-money-day')).status).toBe(401);
  });

  it('reports no_income for a new user, and stores no snapshot', async () => {
    const { accessToken, user } = await registerUser();
    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'no_income', day: null, committed: 0, items: [], freeDate: null });
    expect(await db.select().from(freeMoneySnapshots).where(eq(freeMoneySnapshots.userId, user.id))).toHaveLength(0);
  });

  it('works out the day from repeating income, loan EMIs and repeating expenses', async () => {
    const { accessToken } = await registerUser();
    await addRule(accessToken, { amount: 50000, type: 'income', category_key: 'salary_1', note: 'Salary' });
    await addRule(accessToken, { amount: 5000, type: 'expense', category_key: 'internet', note: 'Broadband' });
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Home loan', principal: 1000000, outstanding: 900000, emi: 10000 });

    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(res.body).toMatchObject({ status: 'ok', income: 50000, incomeSource: 'repeating', committed: 15000, share: 0.3, daysInMonth: DAYS_IN_MONTH });
    expect(res.body.day).toBe(Math.ceil(0.3 * DAYS_IN_MONTH));
    expect(res.body.daysFree).toBe(DAYS_IN_MONTH - res.body.day);
    expect(res.body.items).toEqual([
      { kind: 'loan', label: 'Home loan', amount: 10000 },
      { kind: 'repeating', label: 'Broadband', amount: 5000 },
    ]);
    expect(res.body.freeDate).toBe(`${today.year}-${String(today.month).padStart(2, '0')}-${String(res.body.day).padStart(2, '0')}`);
    expect(res.body.loans).toEqual([{ id: expect.any(Number), name: 'Home loan', emi: 10000, outstanding: 900000, interest_rate: null }]);
  });

  it("falls back to last months' average income when nothing repeats", async () => {
    const { accessToken } = await registerUser();
    for (const [delta, amount] of [[-1, 30000], [-2, 50000]] as const) {
      await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount, type: 'income', category_key: 'salary_1', date: monthStart(delta) });
    }
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Car loan', principal: 100000, outstanding: 100000, emi: 8000 });
    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(res.body).toMatchObject({ incomeSource: 'average', income: 40000, committed: 8000, share: 0.2 });
  });

  it("uses this month's income so far when there is no earlier history", async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 90000, type: 'income', category_key: 'salary_1', date: TODAY });
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Home loan', principal: 500000, outstanding: 500000, emi: 18000 });
    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(res.body).toMatchObject({ status: 'ok', incomeSource: 'this_month', income: 90000, committed: 18000, share: 0.2 });
  });

  it('prefers earlier full months over a partly logged current month', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 60000, type: 'income', category_key: 'salary_1', date: monthStart(-1) });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 500, type: 'income', category_key: 'salary_1', date: TODAY });
    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(res.body).toMatchObject({ incomeSource: 'average', income: 60000 });
  });

  it('looks back six months and averages the three most recent that had income', async () => {
    const { accessToken } = await registerUser();
    for (const [delta, amount] of [[-5, 10000], [-3, 20000], [-2, 30000], [-1, 40000]] as const) {
      await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount, type: 'income', category_key: 'salary_1', date: monthStart(delta) });
    }
    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(res.body).toMatchObject({ incomeSource: 'average', income: 30000 });
  });

  it('still reports no_income when the user has logged no income at all', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 400, type: 'expense', category_key: 'shopping', date: TODAY });
    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(res.body).toMatchObject({ status: 'no_income', income: 0 });
  });

  it('flags commitments larger than income, and caps an EMI at what is still owed', async () => {
    const { accessToken } = await registerUser();
    await addRule(accessToken, { amount: 10000, type: 'income', category_key: 'salary_1' });
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Nearly paid', principal: 50000, outstanding: 3000, emi: 20000 });
    const small = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(small.body.items[0].amount).toBe(3000);
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Big', principal: 900000, outstanding: 900000, emi: 12000 });
    const over = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(over.body).toMatchObject({ status: 'over', daysFree: 0, freeDate: null });
  });

  it("keeps the week's first reading and compares it with last week's", async () => {
    const { accessToken, user } = await registerUser();
    await addRule(accessToken, { amount: 50000, type: 'income', category_key: 'salary_1' });
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Home loan', principal: 1000000, outstanding: 900000, emi: 10000 });

    const first = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(first.body.previous).toBeNull();
    expect(first.body.daysEarlier).toBeNull();

    // A reading from last week, when 25,000 of 50,000 was committed.
    const thisWeek = weekStartOf(TODAY);
    const lastWeek = weekStartOf(new Date(Date.parse(`${thisWeek}T00:00:00Z`) - 86400000).toISOString().slice(0, 10));
    await db.insert(freeMoneySnapshots).values({ userId: user.id, weekStart: lastWeek, income: 50000, committed: 25000 });

    // A new commitment later this week changes the live figure but not the stored first reading.
    await addRule(accessToken, { amount: 5000, type: 'expense', category_key: 'internet' });
    const second = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    const before = computeFreeMoneyDay(50000, 25000, DAYS_IN_MONTH).day!;
    expect(second.body.committed).toBe(15000);
    expect(second.body.previous).toEqual({ weekStart: lastWeek, day: before });
    expect(second.body.daysEarlier).toBe(before - second.body.day);
    expect(second.body.daysEarlier).toBeGreaterThan(0);

    const snaps = await db.select().from(freeMoneySnapshots).where(eq(freeMoneySnapshots.userId, user.id));
    expect(snaps).toHaveLength(2);
    expect(snaps.find((s) => s.weekStart === thisWeek)?.committed).toBe(10000);
  });

  it("never mixes in another user's data", async () => {
    const a = await registerUser();
    const b = await registerUser();
    await addRule(a.accessToken, { amount: 50000, type: 'income', category_key: 'salary_1' });
    await request(app).post('/api/v1/loans').set(auth(a.accessToken)).send({ name: 'A loan', principal: 1000, outstanding: 1000, emi: 100 });
    const res = await request(app).get('/api/v1/reports/free-money-day').set(auth(b.accessToken));
    expect(res.body).toMatchObject({ status: 'no_income', items: [] });
  });
});
