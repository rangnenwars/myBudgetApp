import request from 'supertest';
import { app, registerUser } from './helpers';
import { localToday } from '../lib/clock';

// Tap-through: figures on Home, Reports and Plan ahead open the entries or the
// repeating bill or loan behind them. The server side is the filter totals on
// the Transactions page and the ids on forecast and free-money lines.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const TODAY = localToday().iso;

const add = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/transactions').set(auth(token)).send({ type: 'expense', date: TODAY, amount: 100, category_key: 'internet', ...body });

describe('Transactions page totals for a filter', () => {
  it('counts and adds up exactly what the filters match', async () => {
    const { accessToken } = await registerUser();
    await add(accessToken, { amount: 640 });
    await add(accessToken, { amount: 1900 });
    await add(accessToken, { amount: 5000, category_key: 'salary_1', type: 'income' });
    await add(accessToken, { amount: 70, category_key: 'fuel_petrol' });

    const res = await request(app).get('/api/v1/transactions/page').query({ category: 'internet', type: 'expense' }).set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.summary).toEqual({ count: 2, income: 0, expense: 2540 });

    const all = await request(app).get('/api/v1/transactions/page').set(auth(accessToken));
    expect(all.body.summary).toEqual({ count: 4, income: 5000, expense: 2610 });
  });

  it('respects a date range, and only the first page carries the totals', async () => {
    const { accessToken } = await registerUser();
    await add(accessToken, { amount: 10, date: '2026-01-05' });
    await add(accessToken, { amount: 20, date: '2026-01-20' });
    await add(accessToken, { amount: 30, date: '2026-02-03' });

    const jan = await request(app).get('/api/v1/transactions/page').query({ from: '2026-01-01', to: '2026-01-31' }).set(auth(accessToken));
    expect(jan.body.summary).toEqual({ count: 2, income: 0, expense: 30 });

    const first = await request(app).get('/api/v1/transactions/page').query({ limit: 1 }).set(auth(accessToken));
    expect(first.body.summary.count).toBe(3);
    const next = await request(app).get('/api/v1/transactions/page').query({ limit: 1, cursor: first.body.nextCursor }).set(auth(accessToken));
    expect(next.body.summary).toBeUndefined();
  });

  it("never counts another user's entries", async () => {
    const a = await registerUser();
    const b = await registerUser();
    await add(a.accessToken, { amount: 999 });
    const res = await request(app).get('/api/v1/transactions/page').set(auth(b.accessToken));
    expect(res.body.summary).toEqual({ count: 0, income: 0, expense: 0 });
  });
});

describe('Ids on plan-ahead and free-money lines', () => {
  it('lets the app open the repeating bill behind a line', async () => {
    const { accessToken } = await registerUser();
    await add(accessToken, { amount: 50000, category_key: 'salary_1', type: 'income', repeat_monthly: true, repeat_no_end: true });
    await add(accessToken, { amount: 10000, category_key: 'internet', note: 'Rent', repeat_monthly: true, repeat_no_end: true });

    const rules = (await request(app).get('/api/v1/recurring').set(auth(accessToken))).body as { id: number; note: string | null }[];
    const rent = rules.find((r) => r.note === 'Rent')!;

    const fm = await request(app).get('/api/v1/reports/free-money-day').set(auth(accessToken));
    expect(fm.body.items).toEqual([expect.objectContaining({ kind: 'repeating', id: rent.id, label: 'Rent' })]);

    const fc = await request(app).get('/api/v1/forecast').set(auth(accessToken));
    const lines = fc.body.months[0].items as { kind: string; id?: number; label: string }[];
    expect(lines.find((l) => l.label === 'Rent')?.id).toBe(rent.id);
  });
});
