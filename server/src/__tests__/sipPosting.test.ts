import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { investments, transactions } from '../db/schema';
import { postDueSips, sipsDueFilter } from '../lib/sipPosting';
import { localToday } from '../lib/clock';

// A SIP on an investment adds its amount to Transactions on the SIP day every month and raises the
// investment by the same amount. The first posting records the expense only. Nothing is dated in the
// future and nothing before the SIP was set up is backfilled.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const TODAY = localToday();
const pad = (n: number) => String(n).padStart(2, '0');
const THIS_MONTH_START = `${TODAY.year}-${pad(TODAY.month)}-01`;
const paise = (n: number) => Math.round(n * 100);

type Sip = { amount: number; day: number; category: string; ends_on?: string | null; no_end?: boolean };
const sip = (over: Partial<Sip> = {}): Sip => ({ amount: 5000, day: 1, category: 'mutual_funds', no_end: true, ...over });

const createInv = (token: string, body: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/investments').set(auth(token)).send({ name: 'Index Fund', type: 'Mutual fund', amount: 100000, current_value: 110000, ...body });
const list = async (token: string) => (await request(app).get('/api/v1/investments').set(auth(token))).body as Record<string, any>[];
const txns = async (token: string) => (await request(app).get('/api/v1/transactions').set(auth(token))).body as { id: number; category: string; amount: number; date: string; note: string; type: string }[];
const sipTxns = async (token: string) => (await txns(token)).filter((t) => t.note?.startsWith('SIP - '));
const setThrough = (id: number, through: string | null) => db.update(investments).set({ sip_posted_through: through }).where(eq(investments.id, id));
const at = (iso: string) => new Date(`${iso}T06:00:00Z`);

describe('adding a SIP to an investment', () => {
  it('the first posting adds the expense only and leaves the invested amount as entered', async () => {
    const { accessToken } = await registerUser();
    const res = await createInv(accessToken, { sip: sip() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sip_amount: 5000, sip_day: 1, sip_category: 'mutual_funds', sip_ends_on: null, sip_no_end: true });

    const [inv] = await list(accessToken);
    const posted = await sipTxns(accessToken);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ category: 'mutual_funds', amount: 5000, type: 'expense', date: THIS_MONTH_START, note: 'SIP - Index Fund' });
    expect(inv.amount).toBe(100000);
    expect(inv.current_value).toBe(110000);
    expect(inv.sip_posted_through).toBe(THIS_MONTH_START);
  });

  it('reading again never posts the same month twice', async () => {
    const { accessToken } = await registerUser();
    await createInv(accessToken, { sip: sip() });
    for (let i = 0; i < 3; i++) await list(accessToken);
    await txns(accessToken);
    expect(await sipTxns(accessToken)).toHaveLength(1);
  });

  it('reading Transactions, not only Investments, adds a SIP that is due', async () => {
    const { accessToken } = await registerUser();
    const res = await createInv(accessToken, { sip: sip() });
    expect(res.status).toBe(201);
    // Created and read straight away through Transactions: it is there.
    expect(await sipTxns(accessToken)).toHaveLength(1);
  });

  it('a SIP whose day has not come yet this month adds nothing and says when it is next', async () => {
    const { accessToken } = await registerUser();
    if (TODAY.day >= 28) return; // no later day this month to pick
    const day = TODAY.day + 1;
    await createInv(accessToken, { sip: sip({ day }) });
    const [inv] = await list(accessToken);
    expect(await sipTxns(accessToken)).toHaveLength(0);
    expect(inv.sip_posted_through).toBeNull();
    expect(inv.sip_next_date).toBe(`${TODAY.year}-${pad(TODAY.month)}-${pad(day)}`);
  });

  it('an investment with no SIP is unchanged and shows no next date', async () => {
    const { accessToken } = await registerUser();
    await createInv(accessToken);
    const [inv] = await list(accessToken);
    expect(inv).toMatchObject({ sip_amount: null, sip_day: null, sip_category: null, sip_no_end: false, sip_next_date: null });
    expect(await sipTxns(accessToken)).toHaveLength(0);
  });

  it('every category a SIP can use is accepted', async () => {
    for (const category of ['mutual_funds', 'fixed_deposit', 'bonds', 'gold']) {
      const { accessToken } = await registerUser();
      expect((await createInv(accessToken, { sip: sip({ category }) })).status).toBe(201);
      expect((await sipTxns(accessToken))[0].category).toBe(category);
    }
  });

  it('an end date today or later is accepted', async () => {
    const { accessToken } = await registerUser();
    const res = await createInv(accessToken, { sip: sip({ no_end: false, ends_on: TODAY.iso }) });
    expect(res.status).toBe(201);
    expect(res.body.sip_ends_on).toBe(TODAY.iso);
    expect(res.body.sip_no_end).toBe(false);
  });
});

describe('a SIP that is refused saves nothing', () => {
  const refused = async (body: Record<string, unknown>) => {
    const { accessToken } = await registerUser();
    const res = await createInv(accessToken, body);
    expect(res.status).toBe(400);
    expect(await list(accessToken)).toHaveLength(0);
    expect(await sipTxns(accessToken)).toHaveLength(0);
    return res.body.error as string;
  };

  it.each([
    ['zero', 0],
    ['negative', -500],
    ['text', 'five thousand'],
    ['one paisa fraction', 0.001],
    ['above the maximum', 10_000_000_000],
  ])('an amount of %s', async (_l, amount) => {
    await refused({ sip: sip({ amount: amount as number }) });
  });

  it.each([
    ['zero', 0],
    ['32', 32],
    ['negative', -1],
    ['a fraction', 1.5],
    ['text', 'fifth'],
  ])('a day of %s', async (_l, day) => {
    await refused({ sip: sip({ day: day as number }) });
  });

  it.each(['rent', 'salary_1', '', 'no_such_category'])('the category %p', async (category) => {
    await refused({ sip: sip({ category }) });
  });

  it('no end date and not marked as having none', async () => {
    expect(await refused({ sip: { amount: 5000, day: 1, category: 'mutual_funds' } })).toMatch(/when the SIP ends/);
  });

  it('both an end date and "no end date"', async () => {
    expect(await refused({ sip: sip({ no_end: true, ends_on: TODAY.iso }) })).toMatch(/when the SIP ends/);
  });

  it.each(['2026-02-30', '2026-13-01', 'soon', '12/11/2026'])('an end date of %p', async (ends_on) => {
    await refused({ sip: sip({ no_end: false, ends_on }) });
  });

  it('an end date in the past', async () => {
    expect(await refused({ sip: sip({ no_end: false, ends_on: '2020-01-01' }) })).toMatch(/past/);
  });

  it.each([['a string', 'monthly'], ['a number', 5000], ['an array', [5000]]])('a SIP given as %s', async (_l, value) => {
    await refused({ sip: value });
  });
});

describe('changing a SIP', () => {
  it('can be switched on later, and started from the first posting', async () => {
    const { accessToken } = await registerUser();
    const inv = (await createInv(accessToken)).body;
    const res = await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(accessToken)).send({ sip: sip() });
    expect(res.status).toBe(200);
    expect(res.body.sip_amount).toBe(5000);
    expect(await sipTxns(accessToken)).toHaveLength(1);
    expect((await list(accessToken))[0].amount).toBe(100000);
  });

  it('switching it off stops new postings and keeps the ones already in Transactions', async () => {
    const { accessToken } = await registerUser();
    const inv = (await createInv(accessToken, { sip: sip() })).body;
    await list(accessToken);
    const off = await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(accessToken)).send({ sip: null });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ sip_amount: null, sip_day: null, sip_category: null, sip_no_end: false, sip_next_date: null });
    await setThrough(inv.id, '2026-01-01');
    expect(await postDueSips((await db.select().from(investments).where(eq(investments.id, inv.id)))[0].userId, at('2026-11-21'))).toBe(0);
    expect(await sipTxns(accessToken)).toHaveLength(1);
  });

  it('a patch that does not mention the SIP leaves it alone', async () => {
    const { accessToken } = await registerUser();
    const inv = (await createInv(accessToken, { sip: sip() })).body;
    const res = await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(accessToken)).send({ name: 'Renamed Fund' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Renamed Fund', sip_amount: 5000, sip_day: 1 });
  });

  it('can change the amount and day', async () => {
    const { accessToken } = await registerUser();
    const inv = (await createInv(accessToken, { sip: sip() })).body;
    const res = await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(accessToken)).send({ sip: sip({ amount: 7500, day: 15, category: 'gold' }) });
    expect(res.body).toMatchObject({ sip_amount: 7500, sip_day: 15, sip_category: 'gold' });
  });

  it('a refused change leaves the SIP as it was', async () => {
    const { accessToken } = await registerUser();
    const inv = (await createInv(accessToken, { sip: sip() })).body;
    const res = await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(accessToken)).send({ sip: sip({ amount: -1 }) });
    expect(res.status).toBe(400);
    expect((await list(accessToken))[0]).toMatchObject({ sip_amount: 5000 });
  });

  it("another user's investment cannot be given a SIP", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const inv = (await createInv(owner.accessToken)).body;
    const res = await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(stranger.accessToken)).send({ sip: sip() });
    expect(res.status).toBe(404);
    expect((await list(owner.accessToken))[0].sip_amount).toBeNull();
    expect(await sipTxns(owner.accessToken)).toHaveLength(0);
  });

  it('switching it back on after a long gap does not backfill the months it was off', async () => {
    const reg = await registerUser();
    const inv = (await createInv(reg.accessToken, { sip: sip() })).body;
    await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(reg.accessToken)).send({ sip: null });
    await setThrough(inv.id, '2026-05-01');
    await request(app).patch(`/api/v1/investments/${inv.id}`).set(auth(reg.accessToken)).send({ sip: sip() });
    const before = (await sipTxns(reg.accessToken)).length;
    const [after] = await list(reg.accessToken);
    // Only this month, once: not the months back to May.
    expect((await sipTxns(reg.accessToken)).length - before).toBeLessThanOrEqual(1);
    expect(after.sip_posted_through).toBe(THIS_MONTH_START);
  });
});

describe('posting several months (postDueSips with a fixed date)', () => {
  const setup = async (siPatch: Partial<Sip> = {}, extra: Record<string, unknown> = {}) => {
    const reg = await registerUser();
    const inv = (await createInv(reg.accessToken, { sip: sip({ day: 5, ...siPatch }), ...extra })).body;
    // Created a few months ago: nothing posted yet, and a known starting point.
    await db.delete(transactions).where(eq(transactions.userId, reg.user.id));
    await setThrough(inv.id, '2026-08-01');
    await db.update(investments).set({ amount: 100000, current_value: 110000 }).where(eq(investments.id, inv.id));
    return { reg, invId: inv.id as number };
  };
  const row = async (id: number) => (await db.select().from(investments).where(eq(investments.id, id)))[0];
  const posted = async (userId: number) => (await db.select().from(transactions).where(and(eq(transactions.userId, userId), eq(transactions.category, 'mutual_funds')))).sort((a, b) => a.date.localeCompare(b.date));

  it('catches up every missed month, each on the SIP day, and raises the investment each time', async () => {
    const { reg, invId } = await setup();
    const count = await postDueSips(reg.user.id, at('2026-11-21'));
    expect(count).toBe(3);
    expect((await posted(reg.user.id)).map((t) => t.date)).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
    const inv = await row(invId);
    expect(inv.amount).toBe(115000);
    expect(inv.current_value).toBe(125000);
    // Stored to two decimals.
    expect(inv.returns_percent).toBeCloseTo(((125000 - 115000) / 115000) * 100, 1);
    expect(inv.sip_posted_through).toBe('2026-11-01');
  });

  it('a second run the same day adds nothing', async () => {
    const { reg } = await setup();
    await postDueSips(reg.user.id, at('2026-11-21'));
    expect(await postDueSips(reg.user.id, at('2026-11-21'))).toBe(0);
    expect(await posted(reg.user.id)).toHaveLength(3);
  });

  it('two runs at the same moment add each month only once', async () => {
    const { reg, invId } = await setup();
    const counts = await Promise.all([postDueSips(reg.user.id, at('2026-11-21')), postDueSips(reg.user.id, at('2026-11-21'))]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(await posted(reg.user.id)).toHaveLength(3);
    expect((await row(invId)).amount).toBe(115000);
  });

  it('this month is added only once its day has arrived', async () => {
    const { reg } = await setup();
    expect(await postDueSips(reg.user.id, at('2026-11-04'))).toBe(2); // September and October
    expect(await postDueSips(reg.user.id, at('2026-11-05'))).toBe(1); // November, on the 5th
  });

  it('a day of 31 lands on the last day of a shorter month', async () => {
    const { reg } = await setup({ day: 31 });
    await postDueSips(reg.user.id, at('2026-11-30'));
    expect((await posted(reg.user.id)).map((t) => t.date)).toEqual(['2026-09-30', '2026-10-31', '2026-11-30']);
  });

  it('stops at the end date, and the investment is raised only for months that were added', async () => {
    const { reg, invId } = await setup();
    // The API refuses an end date in the past, so set it directly: the SIP ended on 5 October.
    await db.update(investments).set({ sip_ends_on: '2026-10-05', sip_no_end: false }).where(eq(investments.id, invId));
    await postDueSips(reg.user.id, at('2026-11-21'));
    expect((await posted(reg.user.id)).map((t) => t.date)).toEqual(['2026-09-05', '2026-10-05']);
    expect((await row(invId)).amount).toBe(110000);
    // Settled to the current month, so it is no longer due and does not run again.
    const stillDue = await db.select({ id: investments.id }).from(investments).where(and(eq(investments.id, invId), sipsDueFilter(reg.user.id, at('2026-11-22'))));
    expect(stillDue).toHaveLength(0);
  });

  it('a gap longer than two years adds only the last 24 months', async () => {
    const { reg, invId } = await setup();
    await setThrough(invId, '2020-01-01');
    expect(await postDueSips(reg.user.id, at('2026-11-21'))).toBe(24);
  });

  it('amounts add up to the paisa with no drift', async () => {
    const { reg, invId } = await setup({ amount: 3333.33 }, { amount: 0.1, current_value: 0.2 });
    await db.update(investments).set({ amount: 0.1, current_value: 0.2 }).where(eq(investments.id, invId));
    await postDueSips(reg.user.id, at('2026-11-21'));
    const inv = await row(invId);
    expect(paise(inv.amount)).toBe(paise(0.1) + 3 * paise(3333.33));
    expect(paise(inv.current_value!)).toBe(paise(0.2) + 3 * paise(3333.33));
    expect(paise((await posted(reg.user.id)).reduce((s, t) => s + t.amount, 0))).toBe(3 * paise(3333.33));
  });

  it('an investment with no saved value raises only the invested amount', async () => {
    const { reg, invId } = await setup();
    await db.update(investments).set({ current_value: null }).where(eq(investments.id, invId));
    await postDueSips(reg.user.id, at('2026-11-21'));
    const inv = await row(invId);
    expect(inv.amount).toBe(115000);
    expect(inv.current_value).toBeNull();
  });

  it('never touches another user\'s investment', async () => {
    const a = await setup();
    const b = await setup();
    await postDueSips(a.reg.user.id, at('2026-11-21'));
    expect(await posted(b.reg.user.id)).toHaveLength(0);
    expect((await row(b.invId)).sip_posted_through).toBe('2026-08-01');
  });

  it('something other than a SIP is never posted: no SIP, no transactions', async () => {
    const reg = await registerUser();
    await createInv(reg.accessToken);
    expect(await postDueSips(reg.user.id, at('2026-11-21'))).toBe(0);
  });
});

describe('what the database itself refuses', () => {
  const insert = async (values: Partial<typeof investments.$inferInsert>) => {
    const reg = await registerUser();
    return db.insert(investments).values({ userId: reg.user.id, name: 'X', type: 'Fund', amount: 100, ...values });
  };

  it('a SIP with an amount but no day', async () => {
    await expect(insert({ sip_amount: 100, sip_category: 'mutual_funds', sip_no_end: true })).rejects.toThrow();
  });
  it('a SIP that does not say when it ends', async () => {
    await expect(insert({ sip_amount: 100, sip_day: 1, sip_category: 'mutual_funds' })).rejects.toThrow();
  });
  it('a SIP with both an end date and no end', async () => {
    await expect(insert({ sip_amount: 100, sip_day: 1, sip_category: 'mutual_funds', sip_no_end: true, sip_ends_on: '2030-01-01' })).rejects.toThrow();
  });
  it('a day outside 1 to 31', async () => {
    await expect(insert({ sip_amount: 100, sip_day: 40, sip_category: 'mutual_funds', sip_no_end: true })).rejects.toThrow();
  });
  it('an amount of zero', async () => {
    await expect(insert({ sip_amount: 0, sip_day: 1, sip_category: 'mutual_funds', sip_no_end: true })).rejects.toThrow();
  });
  it('a category that does not exist', async () => {
    await expect(insert({ sip_amount: 100, sip_day: 1, sip_category: 'no_such', sip_no_end: true })).rejects.toThrow();
  });
});

describe('who can see it', () => {
  it('a user without the Investments feature is refused the list', async () => {
    const { accessToken } = await registerUser({ features: [] });
    expect((await request(app).get('/api/v1/investments').set(auth(accessToken))).status).toBe(403);
  });
  it('not signed in is refused', async () => {
    expect((await request(app).post('/api/v1/investments').send({ name: 'X', type: 'Fund', amount: 1, sip: sip() })).status).toBe(401);
  });
  it("another user's SIP never appears in my transactions", async () => {
    const a = await registerUser();
    const b = await registerUser();
    await createInv(a.accessToken, { sip: sip() });
    await list(a.accessToken);
    expect(await sipTxns(b.accessToken)).toHaveLength(0);
    expect(await list(b.accessToken)).toHaveLength(0);
  });
  it('the SIP expense counts in the month summary like any other expense', async () => {
    const { accessToken } = await registerUser();
    await createInv(accessToken, { sip: sip({ amount: 2500 }) });
    await list(accessToken);
    const summary = await request(app)
      .get('/api/v1/reports/summary')
      .query({ startMonth: TODAY.month, startYear: TODAY.year, endMonth: TODAY.month, endYear: TODAY.year })
      .set(auth(accessToken));
    expect(summary.body.totalExpense).toBe(2500);
  });
});
