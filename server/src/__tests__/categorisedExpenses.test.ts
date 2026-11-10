import request from 'supertest';
import { app, registerUser } from './helpers';
import { localToday } from '../lib/clock';

// F-02: the category totals behind Reports > Categories. Month and year views
// both read the existing category breakdown, so these pin it to the
// Transactions filter for the same period, and to the user's own share of a
// split bill.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const add = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/transactions').set(auth(token)).send({ type: 'expense', category_key: 'internet', amount: 100, ...body });

const breakdown = async (token: string, startMonth: number, startYear: number, endMonth: number, endYear: number) =>
  (await request(app).get('/api/v1/reports/category-breakdown').query({ startMonth, startYear, endMonth, endYear, type: 'expense' }).set(auth(token))).body as {
    category: string;
    total: number;
  }[];

describe('Category totals for a month or a year', () => {
  it('adds up to the period total and matches the Transactions filter for a whole year', async () => {
    const { accessToken } = await registerUser({ features: [] });
    await add(accessToken, { amount: 2400, date: '2026-01-10', category_key: 'fuel_petrol' });
    await add(accessToken, { amount: 2700, date: '2026-02-10', category_key: 'fuel_petrol' });
    await add(accessToken, { amount: 1600, date: '2026-03-31' });
    await add(accessToken, { amount: 999, date: '2025-12-31' }); // the year before: must not count

    const rows = await breakdown(accessToken, 1, 2026, 12, 2026);
    expect(rows).toEqual([
      { category: 'fuel_petrol', total: 5100 },
      { category: 'internet', total: 1600 },
    ]);

    const page = await request(app).get('/api/v1/transactions/page').query({ type: 'expense', from: '2026-01-01', to: '2026-12-31' }).set(auth(accessToken));
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(page.body.summary.expense);

    // One category's months (what the year-view trend adds up client-side) equal its total.
    const range = (await request(app).get('/api/v1/transactions/range').query({ startMonth: 1, startYear: 2026, endMonth: 12, endYear: 2026 }).set(auth(accessToken))).body as {
      category: string;
      amount: number;
      month: number;
    }[];
    const fuel = range.filter((t) => t.category === 'fuel_petrol');
    expect(fuel.reduce((s, t) => s + t.amount, 0)).toBe(5100);
    expect(fuel.map((t) => t.month).sort()).toEqual([1, 2]);
  });

  it('is empty for a period with no expenses', async () => {
    const { accessToken } = await registerUser({ features: [] });
    expect(await breakdown(accessToken, 3, 2026, 3, 2026)).toEqual([]);
  });

  it("counts only the user's own share of a split bill", async () => {
    const { accessToken } = await registerUser({ features: [] });
    const today = localToday();
    const person = async (name: string) => (await request(app).post('/api/v1/people').set(auth(accessToken)).send({ name })).body as { id: number };
    const rahul = await person('Rahul');
    const priya = await person('Priya');

    const split = await request(app)
      .post('/api/v1/transactions/split-people')
      .set(auth(accessToken))
      .send({ date: today.iso, category_key: 'lunch_dinner', total: 1800, method: 'equal', people: [{ person_id: rahul.id }, { person_id: priya.id }] });
    expect(split.status).toBe(201);

    const rows = await breakdown(accessToken, today.month, today.year, today.month, today.year);
    expect(rows).toEqual([{ category: 'lunch_dinner', total: 600 }]);
  });
});
