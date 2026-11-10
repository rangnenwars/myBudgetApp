import request from 'supertest';
import { app, registerUser } from './helpers';

// F-01: the monthly expense totals on Reports must equal what Transactions
// shows when filtered to the same month. Both come from the database, so this
// pins the two together. These users get no optional features: another suite
// counts who has Investments on across the whole database while this one runs.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const add = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/transactions').set(auth(token)).send({ type: 'expense', category_key: 'internet', amount: 100, ...body });

const lastDay = (year: number, month: number) => new Date(year, month, 0).getDate();
const pad = (n: number) => String(n).padStart(2, '0');

describe('Monthly expenses match the Transactions month filter', () => {
  it('has the same total for every month, keeps empty months as 0, and counts expenses only', async () => {
    const { accessToken } = await registerUser({ features: [] });
    await add(accessToken, { amount: 640.5, date: '2026-08-31' });
    await add(accessToken, { amount: 1900, date: '2026-09-01', category_key: 'fuel_petrol' });
    await add(accessToken, { amount: 70.25, date: '2026-09-30' });
    // October is left empty on purpose.
    await add(accessToken, { amount: 7400, date: '2026-11-05' });
    await add(accessToken, { amount: 50000, date: '2026-11-01', type: 'income', category_key: 'salary_1' });

    const series = (
      await request(app).get('/api/v1/reports/monthly-series').query({ startMonth: 8, startYear: 2026, endMonth: 11, endYear: 2026 }).set(auth(accessToken))
    ).body as { year: number; month: number; expense: number }[];

    expect(series.map((p) => [p.month, p.expense])).toEqual([
      [8, 640.5],
      [9, 1970.25],
      [10, 0],
      [11, 7400],
    ]);

    for (const p of series) {
      const page = await request(app)
        .get('/api/v1/transactions/page')
        .query({ type: 'expense', from: `${p.year}-${pad(p.month)}-01`, to: `${p.year}-${pad(p.month)}-${pad(lastDay(p.year, p.month))}` })
        .set(auth(accessToken));
      expect(page.body.summary.expense).toBe(p.expense);
    }
  });

  it('gives a category breakdown that adds up to the month total', async () => {
    const { accessToken } = await registerUser({ features: [] });
    await add(accessToken, { amount: 2900, date: '2026-11-03', category_key: 'fuel_petrol' });
    await add(accessToken, { amount: 1600, date: '2026-11-09' });
    await add(accessToken, { amount: 800, date: '2026-11-08', category_key: 'fuel_petrol' });

    const q = { startMonth: 11, startYear: 2026, endMonth: 11, endYear: 2026 };
    const breakdown = (await request(app).get('/api/v1/reports/category-breakdown').query({ ...q, type: 'expense' }).set(auth(accessToken))).body as { category: string; total: number }[];
    const summary = (await request(app).get('/api/v1/reports/summary').query(q).set(auth(accessToken))).body;

    expect(breakdown.reduce((s, c) => s + c.total, 0)).toBe(summary.totalExpense);
    expect(breakdown[0]).toEqual({ category: 'fuel_petrol', total: 3700 });
  });
});
