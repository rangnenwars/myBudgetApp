import request from 'supertest';
import { app, uniqueEmail, registerUser, promoteToAdmin } from './helpers';
import { db } from '../db/client';
import { transactions } from '../db/schema';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('CSV export streams in batches', () => {
  it('exports every row of a range bigger than one 1,000-row batch, newest first', async () => {
    const { user, accessToken } = await registerUser();
    const rows = Array.from({ length: 1205 }, (_, i) => ({
      userId: user.id,
      category: 'internet',
      amount: i + 1,
      type: 'expense' as const,
      note: `n${i}`,
      date: '2026-08-15',
      month: 8,
      year: 2026,
    }));
    await db.insert(transactions).values(rows);

    const res = await request(app)
      .get('/api/v1/reports/export.csv')
      .query({ startMonth: 8, startYear: 2026, endMonth: 8, endYear: 2026 })
      .set(auth(accessToken));
    expect(res.status).toBe(200);
    const lines = res.text.split('\n');
    expect(lines[0]).toBe('date,type,category,amount,note');
    expect(lines).toHaveLength(1 + 1205);
    expect(lines[1]).toBe('2026-08-15,expense,internet,1205,n1204'); // highest id first
    expect(new Set(lines.slice(1)).size).toBe(1205); // no row repeated across batches
  });
});

describe('report totals computed in the database', () => {
  it('match the transactions they summarise', async () => {
    const { accessToken } = await registerUser();
    const add = (amount: number, type: string, category_key: string, date: string) =>
      request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount, type, category_key, date });
    await add(1000.25, 'expense', 'internet', '2026-07-03');
    await add(500.5, 'expense', 'internet', '2026-07-20');
    await add(300, 'expense', 'fuel_petrol', '2026-08-01');
    await add(9000, 'income', 'salary_1', '2026-08-01');

    const range = { startMonth: 7, startYear: 2026, endMonth: 8, endYear: 2026 };
    const summary = await request(app).get('/api/v1/reports/summary').query(range).set(auth(accessToken));
    expect(summary.body).toEqual({ totalIncome: 9000, totalExpense: 1800.75, netSavings: 7199.25 });
    const breakdown = await request(app).get('/api/v1/reports/category-breakdown').query({ ...range, type: 'expense' }).set(auth(accessToken));
    expect(breakdown.body).toEqual([
      { category: 'internet', total: 1500.75 },
      { category: 'fuel_petrol', total: 300 },
    ]);
    const series = await request(app).get('/api/v1/reports/monthly-series').query(range).set(auth(accessToken));
    expect(series.body.map((p: { income: number; expense: number }) => [p.income, p.expense])).toEqual([
      [0, 1500.75],
      [9000, 300],
    ]);
  });
});

describe('staff lists are paged and searched on the server', () => {
  it('searches accounts by name or email, newest first, with a total count header', async () => {
    const admin = await registerUser({ email: uniqueEmail('pager-admin') });
    await promoteToAdmin(admin.user.id);
    const tag = `zq${Date.now()}`;
    await registerUser({ name: `Alpha ${tag}`, email: uniqueEmail('pager-a') });
    await registerUser({ name: 'Beta', email: uniqueEmail(`pager-${tag}`) });

    const res = await request(app).get('/api/v1/admin/users').query({ q: tag }).set(auth(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.headers['x-total-count']).toBe('2');
    expect(res.body.map((u: { name: string }) => u.name)).toEqual(['Beta', `Alpha ${tag}`]);

    const page = await request(app).get('/api/v1/admin/users').query({ q: tag, limit: 1, offset: 1 }).set(auth(admin.accessToken));
    expect(page.body.map((u: { name: string }) => u.name)).toEqual([`Alpha ${tag}`]);
    expect((await request(app).get('/api/v1/admin/users').query({ q: '%' }).set(auth(admin.accessToken))).headers['x-total-count']).toBe('0');
  });

  it('pages the audit log with a before-id cursor', async () => {
    const admin = await registerUser({ email: uniqueEmail('pager-audit') });
    await promoteToAdmin(admin.user.id);
    const target = await registerUser();
    for (const tier of ['pro', 'standard', 'pro']) {
      await request(app).patch(`/api/v1/admin/users/${target.user.id}`).set(auth(admin.accessToken)).send({ tier });
    }
    const first = await request(app).get('/api/v1/admin/audit-log').query({ limit: 2 }).set(auth(admin.accessToken));
    expect(first.body).toHaveLength(2);
    const next = await request(app).get('/api/v1/admin/audit-log').query({ limit: 2, before: first.body[1].id }).set(auth(admin.accessToken));
    expect(next.body[0].id).toBeLessThan(first.body[1].id);
  });
});
