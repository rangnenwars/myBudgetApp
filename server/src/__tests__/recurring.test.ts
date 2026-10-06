import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { recurringTransactions, transactions } from '../db/schema';
import { postDueRecurring, nextDueAfter, postingDate } from '../lib/recurringTransactions';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const now = new Date();
const CUR_YEAR = now.getUTCFullYear();
const CUR_MONTH = now.getUTCMonth() + 1;
const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;
const CUR_START = ym(CUR_YEAR, CUR_MONTH);
const monthsAgo = (n: number) => {
  const d = new Date(Date.UTC(CUR_YEAR, CUR_MONTH - 1 - n, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, start: ym(d.getUTCFullYear(), d.getUTCMonth() + 1) };
};
const dayIn = (n: number, day = 15) => `${monthsAgo(n).start.slice(0, 8)}${String(day).padStart(2, '0')}`;

type Txn = { id: number; category: string; amount: number; type: string; date: string; note: string | null; month: number; year: number };
const listTxns = async (token: string) => (await request(app).get('/api/v1/transactions').set(auth(token))).body as Txn[];
const listRules = async (token: string) => (await request(app).get('/api/v1/recurring').set(auth(token))).body as { id: number; amount: number; note: string | null; type: string; category: string }[];

const addRepeating = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/transactions')
    .set(auth(token))
    .send({ amount: 50000, type: 'income', category_key: 'salary_1', date: dayIn(0, 1), repeat_monthly: true, ...body });

describe('repeat every month', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/recurring')).status).toBe(401);
    expect((await request(app).patch('/api/v1/recurring/1').send({ amount: 1 })).status).toBe(401);
    expect((await request(app).delete('/api/v1/recurring/1')).status).toBe(401);
  });

  it('creates the entry on its date plus a rule, and posts nothing more in the same month', async () => {
    const { accessToken } = await registerUser();
    const res = await addRepeating(accessToken, { date: dayIn(0, 1), note: 'Salary' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 50000, type: 'income', category: 'salary_1' });

    expect(await listRules(accessToken)).toEqual([expect.objectContaining({ amount: 50000, note: 'Salary', type: 'income', category: 'salary_1' })]);
    expect(await listTxns(accessToken)).toHaveLength(1);
  });

  it('deleting a repeating entry with stop_repeat removes its rule, so it can be added again', async () => {
    const { accessToken } = await registerUser();
    const created = await addRepeating(accessToken, { date: dayIn(0, 1) });
    expect((await addRepeating(accessToken, { date: dayIn(0, 1) })).status).toBe(409);

    const del = await request(app).delete(`/api/v1/transactions/${created.body.id}`).query({ stop_repeat: 'true' }).set(auth(accessToken));
    expect(del.status).toBe(204);
    expect(await listRules(accessToken)).toHaveLength(0);
    expect((await addRepeating(accessToken, { date: dayIn(0, 1) })).status).toBe(201);
  });

  it('a plain delete leaves the rule alone', async () => {
    const { accessToken } = await registerUser();
    const created = await addRepeating(accessToken, { date: dayIn(0, 1) });
    await request(app).delete(`/api/v1/transactions/${created.body.id}`).set(auth(accessToken));
    expect(await listRules(accessToken)).toHaveLength(1);
  });

  it('does not create a rule unless asked to', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 100, type: 'expense', category_key: 'fuel_petrol', date: dayIn(0, 1) });
    expect(await listRules(accessToken)).toHaveLength(0);
  });

  it('rejects a non-boolean repeat_monthly without creating anything', async () => {
    const { accessToken } = await registerUser();
    const res = await addRepeating(accessToken, { repeat_monthly: 'yes' });
    expect(res.status).toBe(400);
    expect(await listTxns(accessToken)).toHaveLength(0);
  });

  it('rejects an invalid category without leaving a rule behind', async () => {
    const { accessToken } = await registerUser();
    const res = await addRepeating(accessToken, { category_key: 'no_such_category' });
    expect(res.status).toBe(400);
    expect(await listRules(accessToken)).toHaveLength(0);
  });

  // Day 1 so this month's entry is always already due, whatever today is;
  // other days and frequencies are covered with a fixed date further down.
  it('posts each month since the original entry, oldest first, with the rule amount', async () => {
    const { accessToken } = await registerUser();
    await addRepeating(accessToken, { date: dayIn(3, 1), note: 'Salary' });

    const txns = await listTxns(accessToken);
    expect(txns).toHaveLength(4); // the original + the 3 following months
    const posted = txns.filter((t) => t.note === 'Salary').map((t) => t.date).sort();
    expect(posted).toEqual([monthsAgo(3).start, monthsAgo(2).start, monthsAgo(1).start, CUR_START]);
    expect(txns.every((t) => t.amount === 50000 && t.type === 'income' && t.category === 'salary_1')).toBe(true);
  });

  it('counts posted income and expenses in the report totals for the current month', async () => {
    const { accessToken } = await registerUser();
    await addRepeating(accessToken, { date: dayIn(1, 1) });
    await addRepeating(accessToken, { date: dayIn(1, 1), type: 'expense', category_key: 'internet', amount: 800 });

    const summary = await request(app)
      .get('/api/v1/reports/summary')
      .query({ startMonth: CUR_MONTH, startYear: CUR_YEAR, endMonth: CUR_MONTH, endYear: CUR_YEAR })
      .set(auth(accessToken));
    expect(summary.body).toEqual({ totalIncome: 50000, totalExpense: 800, netSavings: 49200 });
  });

  it('uses a generic note when the entry had none', async () => {
    const { accessToken } = await registerUser();
    await addRepeating(accessToken, { date: dayIn(1, 1) });
    const posted = (await listTxns(accessToken)).find((t) => t.date === CUR_START);
    expect(posted?.note).toBe('Repeats monthly');
  });

  it('is idempotent across repeated reads and parallel requests', async () => {
    const { accessToken } = await registerUser();
    await addRepeating(accessToken, { date: dayIn(2, 1) });

    await Promise.all(Array.from({ length: 6 }, () => request(app).get('/api/v1/transactions').set(auth(accessToken))));
    await listTxns(accessToken);
    expect(await listTxns(accessToken)).toHaveLength(3);
  });

  it('does not bring back a posted transaction the user deleted', async () => {
    const { accessToken } = await registerUser();
    await addRepeating(accessToken, { date: dayIn(1, 1) });
    const posted = (await listTxns(accessToken)).find((t) => t.date === CUR_START)!;

    await request(app).delete(`/api/v1/transactions/${posted.id}`).set(auth(accessToken));
    expect((await listTxns(accessToken)).find((t) => t.date === CUR_START)).toBeUndefined();
  });

  it('caps a very old start at the most recent 24 months', async () => {
    const { accessToken } = await registerUser();
    const res = await addRepeating(accessToken, { date: '2020-01-10' });
    expect(res.status).toBe(201);
    expect(await listTxns(accessToken)).toHaveLength(1 + 24);
  });

  describe('making an existing transaction repeat', () => {
    const addPlain = async (token: string, body: Record<string, unknown> = {}) =>
      (await request(app).post('/api/v1/transactions').set(auth(token)).send({ amount: 267000, type: 'income', category_key: 'salary_1', date: dayIn(1, 1), note: 'Salary', ...body })).body as Txn;
    const makeRepeat = (token: string, transaction_id: unknown, extra: Record<string, unknown> = {}) =>
      request(app).post('/api/v1/recurring').set(auth(token)).send({ transaction_id, ...extra });

    it('copies the transaction into a rule and posts from the following month', async () => {
      const { accessToken } = await registerUser();
      const txn = await addPlain(accessToken);

      const res = await makeRepeat(accessToken, txn.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ amount: 267000, type: 'income', category: 'salary_1', note: 'Salary' });

      const all = await listTxns(accessToken);
      expect(all).toHaveLength(2); // the original + this month's posting
      expect(all.find((t) => t.date === CUR_START)).toMatchObject({ amount: 267000, type: 'income', note: 'Salary' });
    });

    it("takes a frequency and repeats on the transaction's own day of the month", async () => {
      const { accessToken } = await registerUser();
      const txn = await addPlain(accessToken, { date: '2025-01-20' });
      const res = await makeRepeat(accessToken, txn.id, { frequency: 'yearly' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ frequency: 'yearly', day_of_month: 20, posted_through: '2025-01-01' });
    });

    it('refuses an identical rule so a double tap cannot double-post', async () => {
      const { accessToken } = await registerUser();
      const txn = await addPlain(accessToken);
      expect((await makeRepeat(accessToken, txn.id)).status).toBe(201);
      expect((await makeRepeat(accessToken, txn.id)).status).toBe(409);
      expect(await listRules(accessToken)).toHaveLength(1);
    });

    it("returns 404 for another user's transaction and 400 for a bad id", async () => {
      const owner = await registerUser();
      const other = await registerUser();
      const txn = await addPlain(owner.accessToken);

      expect((await makeRepeat(other.accessToken, txn.id)).status).toBe(404);
      expect((await makeRepeat(owner.accessToken, 'abc')).status).toBe(400);
      expect((await makeRepeat(owner.accessToken, undefined)).status).toBe(400);
      expect(await listRules(owner.accessToken)).toHaveLength(0);
    });

    it('requires authentication', async () => {
      expect((await request(app).post('/api/v1/recurring').send({ transaction_id: 1 })).status).toBe(401);
    });
  });

  describe('editing and stopping', () => {
    it('changes the amount only for months not yet posted', async () => {
      const { accessToken } = await registerUser();
      await addRepeating(accessToken, { date: dayIn(0, 1) });
      const [rule] = await listRules(accessToken);

      const patched = await request(app).patch(`/api/v1/recurring/${rule.id}`).set(auth(accessToken)).send({ amount: 60000, note: 'Raise' });
      expect(patched.status).toBe(200);
      expect(patched.body).toMatchObject({ amount: 60000, note: 'Raise' });

      // Rewind the rule one month so this month's entry falls due again.
      await db.update(recurringTransactions).set({ posted_through: monthsAgo(1).start, next_due: CUR_START }).where(eq(recurringTransactions.id, rule.id));
      const txns = await listTxns(accessToken);
      expect(txns.find((t) => t.date === CUR_START && t.note == null)?.amount).toBe(50000); // original entry untouched
      expect(txns.find((t) => t.date === CUR_START && t.note === 'Raise')?.amount).toBe(60000);
    });

    it('rejects an empty or invalid patch', async () => {
      const { accessToken } = await registerUser();
      await addRepeating(accessToken, { date: dayIn(0, 1) });
      const [rule] = await listRules(accessToken);
      expect((await request(app).patch(`/api/v1/recurring/${rule.id}`).set(auth(accessToken)).send({})).status).toBe(400);
      expect((await request(app).patch(`/api/v1/recurring/${rule.id}`).set(auth(accessToken)).send({ amount: -5 })).status).toBe(400);
    });

    it('stops posting once deleted, but keeps what was already posted', async () => {
      const { accessToken } = await registerUser();
      await addRepeating(accessToken, { date: dayIn(2, 1) });
      expect(await listTxns(accessToken)).toHaveLength(3);
      const [rule] = await listRules(accessToken);

      expect((await request(app).delete(`/api/v1/recurring/${rule.id}`).set(auth(accessToken))).status).toBe(204);
      expect(await listRules(accessToken)).toHaveLength(0);
      expect(await listTxns(accessToken)).toHaveLength(3);
    });

    it("cannot see, edit or delete another user's rule", async () => {
      const owner = await registerUser();
      const other = await registerUser();
      await addRepeating(owner.accessToken, { date: dayIn(0, 1) });
      const [rule] = await listRules(owner.accessToken);

      expect(await listRules(other.accessToken)).toHaveLength(0);
      expect((await request(app).patch(`/api/v1/recurring/${rule.id}`).set(auth(other.accessToken)).send({ amount: 1 })).status).toBe(404);
      expect((await request(app).delete(`/api/v1/recurring/${rule.id}`).set(auth(other.accessToken))).status).toBe(404);
      expect(await listRules(owner.accessToken)).toHaveLength(1);
    });

    it('blocks deleting a category that a repeating entry uses', async () => {
      const { accessToken } = await registerUser();
      const category = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Side gig', type: 'income' });
      await addRepeating(accessToken, { date: dayIn(0, 1), category_key: category.body.key });
      const [rule] = await listRules(accessToken);

      expect((await request(app).delete(`/api/v1/categories/${category.body.key}`).set(auth(accessToken))).status).toBe(409);
      await request(app).delete(`/api/v1/recurring/${rule.id}`).set(auth(accessToken));
      await request(app).delete(`/api/v1/transactions/${(await listTxns(accessToken))[0].id}`).set(auth(accessToken));
      expect((await request(app).delete(`/api/v1/categories/${category.body.key}`).set(auth(accessToken))).status).toBe(204);
    });
  });
});

// Posting logic with a fixed "today", so day-of-month and frequency rules are
// tested independently of when the suite runs. Rules are inserted directly
// and results read from the database — no API call for these users, so the
// request middleware (which uses the real date) never runs for them.
describe('postDueRecurring schedule', () => {
  const insertRule = async (userId: number, rule: { frequency: 'monthly' | 'quarterly' | 'yearly'; day: number; postedThrough: string }) =>
    db
      .insert(recurringTransactions)
      .values({
        userId,
        category: 'salary_1',
        type: 'income',
        amount: 1000,
        posted_through: rule.postedThrough,
        frequency: rule.frequency,
        day_of_month: rule.day,
        next_due: nextDueAfter(rule.postedThrough, rule.frequency, rule.day),
      })
      .returning();
  const postedDates = async (userId: number) =>
    (await db.select({ date: transactions.date }).from(transactions).where(eq(transactions.userId, userId))).map((r) => r.date).sort();

  it("posts on the rule's day, falling back to the last day of shorter months, and waits for this month's day", async () => {
    const { user } = await registerUser();
    const [rule] = await insertRule(user.id, { frequency: 'monthly', day: 31, postedThrough: '2026-01-01' });

    expect(await postDueRecurring(user.id, new Date('2026-04-15T12:00:00Z'))).toBe(2);
    expect(await postedDates(user.id)).toEqual(['2026-02-28', '2026-03-31']);
    const [after] = await db.select().from(recurringTransactions).where(eq(recurringTransactions.id, rule.id));
    expect(after).toMatchObject({ posted_through: '2026-03-01', next_due: '2026-04-30' });

    // Nothing more until 30 April.
    expect(await postDueRecurring(user.id, new Date('2026-04-29T12:00:00Z'))).toBe(0);
    expect(await postDueRecurring(user.id, new Date('2026-04-30T12:00:00Z'))).toBe(1);
  });

  it('posts quarterly rules every third month', async () => {
    const { user } = await registerUser();
    await insertRule(user.id, { frequency: 'quarterly', day: 5, postedThrough: '2026-01-01' });
    expect(await postDueRecurring(user.id, new Date('2026-10-20T00:00:00Z'))).toBe(3);
    expect(await postedDates(user.id)).toEqual(['2026-04-05', '2026-07-05', '2026-10-05']);
  });

  it('posts yearly rules once a year', async () => {
    const { user } = await registerUser();
    await insertRule(user.id, { frequency: 'yearly', day: 1, postedThrough: '2024-03-01' });
    expect(await postDueRecurring(user.id, new Date('2026-10-03T00:00:00Z'))).toBe(2);
    expect(await postedDates(user.id)).toEqual(['2025-03-01', '2026-03-01']);
  });

  it('postingDate handles leap years', () => {
    expect(postingDate(2028, 2, 30)).toBe('2028-02-29');
    expect(postingDate(2027, 2, 30)).toBe('2027-02-28');
  });
});

describe('repeat frequency via the API', () => {
  it("POST /transactions with repeat_frequency saves a rule on the entry's day", async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 12000, type: 'expense', category_key: 'internet', date: '2026-09-15', repeat_frequency: 'quarterly' });
    expect(res.status).toBe(201);
    const [rule] = (await request(app).get('/api/v1/recurring').set(auth(accessToken))).body;
    expect(rule).toMatchObject({ frequency: 'quarterly', day_of_month: 15, posted_through: '2026-09-01', next_due: '2026-12-15' });
  });

  it('refuses a second identical repeating entry with 409 and saves nothing', async () => {
    const { accessToken } = await registerUser();
    const body = { amount: 999, type: 'expense', category_key: 'internet', date: '2026-09-15', repeat_frequency: 'monthly' };
    expect((await request(app).post('/api/v1/transactions').set(auth(accessToken)).send(body)).status).toBe(201);
    expect((await request(app).post('/api/v1/transactions').set(auth(accessToken)).send(body)).status).toBe(409);
    const all = (await request(app).get('/api/v1/transactions').set(auth(accessToken))).body as Txn[];
    expect(all.filter((t) => t.amount === 999 && t.date === '2026-09-15')).toHaveLength(1);
  });

  it('PATCH frequency/day recomputes the next due date from the last period posted', async () => {
    const { accessToken } = await registerUser();
    await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 500, type: 'expense', category_key: 'internet', date: '2026-09-01', repeat_frequency: 'yearly' });
    const [rule] = (await request(app).get('/api/v1/recurring').set(auth(accessToken))).body;
    const res = await request(app).patch(`/api/v1/recurring/${rule.id}`).set(auth(accessToken)).send({ frequency: 'quarterly', day_of_month: 10 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ frequency: 'quarterly', day_of_month: 10, next_due: '2026-12-10' });
    expect((await request(app).patch(`/api/v1/recurring/${rule.id}`).set(auth(accessToken)).send({ day_of_month: 32 })).status).toBe(400);
  });

  it('rejects an impossible date', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 5, type: 'expense', category_key: 'internet', date: '2026-02-30' });
    expect(res.status).toBe(400);
  });
});

describe('Loan EMI entries cannot repeat', () => {
  it('refuses a repeating Loan EMI on POST /transactions, saving nothing', async () => {
    const { accessToken } = await registerUser();
    for (const extra of [{ repeat_monthly: true }, { repeat_frequency: 'quarterly' }]) {
      const res = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 10000, type: 'expense', category_key: 'loan_emi', date: dayIn(0, 1), ...extra });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Loans/);
    }
    expect(await listRules(accessToken)).toHaveLength(0);
    expect((await listTxns(accessToken)).filter((t) => t.category === 'loan_emi')).toHaveLength(0);
  });

  it('refuses to make an existing Loan EMI entry repeat via POST /recurring', async () => {
    const { accessToken } = await registerUser();
    const once = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 10000, type: 'expense', category_key: 'loan_emi', date: dayIn(0, 1) });
    expect(once.status).toBe(201);
    const res = await request(app).post('/api/v1/recurring').set(auth(accessToken)).send({ transaction_id: once.body.id });
    expect(res.status).toBe(400);
    expect(await listRules(accessToken)).toHaveLength(0);
  });

  it('still lets other EMI-style categories repeat', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 3000, type: 'expense', category_key: 'external_emis', date: dayIn(0, 1), repeat_monthly: true });
    expect(res.status).toBe(201);
    expect(await listRules(accessToken)).toHaveLength(1);
  });
});
