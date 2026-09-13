import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const monthRangeParams = (monthsBack = 0) => {
  const now = new Date();
  return { startMonth: now.getMonth() + 1, startYear: now.getFullYear(), endMonth: now.getMonth() + 1, endYear: now.getFullYear() };
};

describe('reports auth', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/reports/summary').query(monthRangeParams());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/reports/summary', () => {
  it('sums income and expense for the range', async () => {
    const { accessToken } = await registerUser();
    const today = new Date().toISOString().slice(0, 10);
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 50000, type: 'income', category_key: 'salary_1', date: today });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 15000, type: 'expense', category_key: 'groceries_milk', date: today });

    const res = await request(app).get('/api/v1/reports/summary').query(monthRangeParams()).set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ totalIncome: 50000, totalExpense: 15000, netSavings: 35000 });
  });
});

describe('GET /api/v1/reports/monthly-series', () => {
  it('returns one point per month in range, zero-filled where there are no transactions', async () => {
    const { accessToken } = await registerUser();
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 10);

    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 1000, type: 'income', category_key: 'salary_1', date: today });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 400, type: 'expense', category_key: 'fuel_petrol', date: prev });

    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const res = await request(app)
      .get('/api/v1/reports/monthly-series')
      .query({ startMonth: start.getMonth() + 1, startYear: start.getFullYear(), endMonth: now.getMonth() + 1, endYear: now.getFullYear() })
      .set(auth(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3); // 3-month inclusive range

    const oldestMonth = res.body[0];
    expect(oldestMonth).toEqual({ month: start.getMonth() + 1, year: start.getFullYear(), label: expect.any(String), income: 0, expense: 0, net: 0 });

    const currentMonth = res.body[res.body.length - 1];
    expect(currentMonth).toMatchObject({ month: now.getMonth() + 1, year: now.getFullYear(), income: 1000, expense: 0, net: 1000 });
  });
});

describe('GET /api/v1/reports/category-breakdown', () => {
  it('groups by category and sorts descending', async () => {
    const { accessToken } = await registerUser();
    const today = new Date().toISOString().slice(0, 10);
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 500, type: 'expense', category_key: 'fuel_petrol', date: today });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 2000, type: 'expense', category_key: 'groceries_milk', date: today });

    const res = await request(app).get('/api/v1/reports/category-breakdown').query({ ...monthRangeParams(), type: 'expense' }).set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body[0]).toEqual({ category: 'groceries_milk', total: 2000 });
    expect(res.body[1]).toEqual({ category: 'fuel_petrol', total: 500 });
  });
});

describe('GET /api/v1/reports/export.csv', () => {
  it('returns a CSV with the transaction rows', async () => {
    const { accessToken } = await registerUser();
    const today = new Date().toISOString().slice(0, 10);
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 1234, type: 'expense', category_key: 'internet', note: 'wifi', date: today });

    const res = await request(app).get('/api/v1/reports/export.csv').query(monthRangeParams()).set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toBe('date,type,category,amount,note');
    expect(res.text).toContain('internet');
    expect(res.text).toContain('wifi');
  });
});

describe('GET /api/v1/reports/debt-payoff', () => {
  it('orders by smallest balance first under the snowball strategy', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Big', principal: 100000, outstanding: 100000, emi: 5000 });
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Small', principal: 5000, outstanding: 5000, emi: 5000 });

    const res = await request(app).get('/api/v1/reports/debt-payoff').query({ strategy: 'snowball' }).set(auth(accessToken));
    expect(res.status).toBe(200);
    // Small loan (5000 outstanding, 5000 EMI) clears in month 1.
    expect(res.body[0].name).toBe('Small');
    expect(res.body[0].payoffMonths).toBe(1);
  });

  it('prioritizes the higher interest-rate loan under the avalanche strategy', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'LowRate', principal: 5000, outstanding: 5000, emi: 100, interest_rate: 5 });
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'HighRate', principal: 5000, outstanding: 5000, emi: 100, interest_rate: 20 });

    const res = await request(app).get('/api/v1/reports/debt-payoff').query({ strategy: 'avalanche', extraPerMonth: 400 }).set(auth(accessToken));
    const highRate = res.body.find((r: { name: string }) => r.name === 'HighRate');
    const lowRate = res.body.find((r: { name: string }) => r.name === 'LowRate');
    expect(highRate.payoffMonths).toBeLessThan(lowRate.payoffMonths);
  });
});

describe('GET /api/v1/reports/goal-eta', () => {
  it('returns one ETA entry per goal', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal A', target_amount: 10000 });
    await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal B', target_amount: 20000 });

    const res = await request(app).get('/api/v1/reports/goal-eta').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.goals).toHaveLength(2);
  });
});
