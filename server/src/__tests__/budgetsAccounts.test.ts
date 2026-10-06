import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('accounts', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/accounts')).status).toBe(401);
  });

  it('creates, lists, updates and deletes accounts, isolated per user', async () => {
    const { accessToken } = await registerUser();
    const other = await registerUser();

    const created = await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'HDFC Savings', type: 'bank', balance: 25000.5 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'HDFC Savings', type: 'bank', balance: 25000.5 });

    expect((await request(app).get('/api/v1/accounts').set(auth(other.accessToken))).body).toEqual([]);
    expect((await request(app).patch(`/api/v1/accounts/${created.body.id}`).set(auth(other.accessToken)).send({ balance: 1 })).status).toBe(404);

    const patched = await request(app).patch(`/api/v1/accounts/${created.body.id}`).set(auth(accessToken)).send({ balance: 30000 });
    expect(patched.body.balance).toBe(30000);

    expect((await request(app).delete(`/api/v1/accounts/${created.body.id}`).set(auth(accessToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/accounts').set(auth(accessToken))).body).toEqual([]);
  });

  it('rejects an unknown type or empty patch', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'X', type: 'crypto' })).status).toBe(400);
    const created = await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Wallet', type: 'wallet' });
    expect(created.body.balance).toBe(0);
    expect((await request(app).patch(`/api/v1/accounts/${created.body.id}`).set(auth(accessToken)).send({})).status).toBe(400);
  });

  it('counts in the net-worth snapshot: balances add, credit-card dues subtract', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Bank', type: 'bank', balance: 10000 });
    await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Card', type: 'credit_card', balance: 2500 });
    const snap = await request(app).post('/api/v1/net-worth/snapshot').set(auth(accessToken));
    expect(snap.body.netWorth).toBe(7500);
  });
});

describe('budgets', () => {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const today = `${year}-${String(month).padStart(2, '0')}-01`;

  it('sets a limit and reports spending against it with ok / warning / over', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).put('/api/v1/budgets/internet').set(auth(accessToken)).send({ monthly_limit: 1000 })).status).toBe(200);
    expect((await request(app).put('/api/v1/budgets/fuel_petrol').set(auth(accessToken)).send({ monthly_limit: 2000 })).status).toBe(200);
    expect((await request(app).put('/api/v1/budgets/groceries_milk').set(auth(accessToken)).send({ monthly_limit: 500 })).status).toBe(200);

    const add = (category_key: string, amount: number) =>
      request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount, type: 'expense', category_key, date: today });
    await add('internet', 850); // 85% → warning
    await add('fuel_petrol', 500); // 25% → ok
    await add('groceries_milk', 300);
    await add('groceries_milk', 300); // 120% → over

    const res = await request(app).get('/api/v1/budgets').query({ month, year }).set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { category: 'groceries_milk', monthly_limit: 500, spent: 600, ratio: 1.2, status: 'over' },
      { category: 'internet', monthly_limit: 1000, spent: 850, ratio: 0.85, status: 'warning' },
      { category: 'fuel_petrol', monthly_limit: 2000, spent: 500, ratio: 0.25, status: 'ok' },
    ]);
  });

  it('replaces an existing limit rather than adding a second one, and deletes it', async () => {
    const { accessToken } = await registerUser();
    await request(app).put('/api/v1/budgets/internet').set(auth(accessToken)).send({ monthly_limit: 1000 });
    await request(app).put('/api/v1/budgets/internet').set(auth(accessToken)).send({ monthly_limit: 1500 });
    const list = await request(app).get('/api/v1/budgets').set(auth(accessToken));
    expect(list.body).toEqual([expect.objectContaining({ category: 'internet', monthly_limit: 1500, spent: 0, status: 'ok' })]);

    expect((await request(app).delete('/api/v1/budgets/internet').set(auth(accessToken))).status).toBe(204);
    expect((await request(app).delete('/api/v1/budgets/internet').set(auth(accessToken))).status).toBe(404);
  });

  it('only allows expense categories the user can see', async () => {
    const { accessToken } = await registerUser();
    const other = await registerUser();
    const theirs = await request(app).post('/api/v1/categories').set(auth(other.accessToken)).send({ name: 'Private', type: 'expense' });

    expect((await request(app).put('/api/v1/budgets/salary_1').set(auth(accessToken)).send({ monthly_limit: 100 })).status).toBe(400);
    expect((await request(app).put(`/api/v1/budgets/${theirs.body.key}`).set(auth(accessToken)).send({ monthly_limit: 100 })).status).toBe(400);
    expect((await request(app).put('/api/v1/budgets/internet').set(auth(accessToken)).send({ monthly_limit: -1 })).status).toBe(400);
  });

  it("removes a custom category's budget when the category is deleted", async () => {
    const { accessToken } = await registerUser();
    const cat = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Hobby', type: 'expense' });
    await request(app).put(`/api/v1/budgets/${cat.body.key}`).set(auth(accessToken)).send({ monthly_limit: 300 });
    expect((await request(app).delete(`/api/v1/categories/${cat.body.key}`).set(auth(accessToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/budgets').set(auth(accessToken))).body).toEqual([]);
  });
});

describe('GET /transactions/page', () => {
  const seed = async (token: string) => {
    const add = (body: Record<string, unknown>) => request(app).post('/api/v1/transactions').set(auth(token)).send({ type: 'expense', category_key: 'internet', ...body });
    for (let day = 1; day <= 5; day++) await add({ amount: 100 + day, date: `2026-08-0${day}`, note: day === 3 ? 'Airtel 50% off' : null });
    await add({ amount: 9000, type: 'income', category_key: 'salary_1', date: '2026-08-10', note: 'August salary' });
  };

  it('pages newest-first with a cursor until the end', async () => {
    const { accessToken } = await registerUser();
    await seed(accessToken);

    const first = await request(app).get('/api/v1/transactions/page').query({ limit: 4 }).set(auth(accessToken));
    expect(first.status).toBe(200);
    expect(first.body.items.map((t: { date: string }) => t.date)).toEqual(['2026-08-10', '2026-08-05', '2026-08-04', '2026-08-03']);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app).get('/api/v1/transactions/page').query({ limit: 4, cursor: first.body.nextCursor }).set(auth(accessToken));
    expect(second.body.items.map((t: { date: string }) => t.date)).toEqual(['2026-08-02', '2026-08-01']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('searches notes and category names (case-insensitive, % taken literally), and filters by type and date', async () => {
    const { accessToken } = await registerUser();
    await seed(accessToken);
    const page = (query: Record<string, unknown>) => request(app).get('/api/v1/transactions/page').query(query).set(auth(accessToken));

    expect((await page({ q: 'airtel' })).body.items).toHaveLength(1);
    expect((await page({ q: '50%' })).body.items).toHaveLength(1);
    expect((await page({ q: '%' })).body.items).toHaveLength(1);
    expect((await page({ q: 'salary' })).body.items.map((t: { amount: number }) => t.amount)).toEqual([9000]);
    expect((await page({ q: '9000' })).body.items).toHaveLength(1);
    expect((await page({ type: 'expense' })).body.items).toHaveLength(5);
    expect((await page({ from: '2026-08-02', to: '2026-08-04' })).body.items).toHaveLength(3);
    expect((await page({ category: 'salary_1' })).body.items).toHaveLength(1);
  });

  it("never returns another user's rows and rejects a bad cursor or limit", async () => {
    const { accessToken } = await registerUser();
    const other = await registerUser();
    await seed(other.accessToken);
    expect((await request(app).get('/api/v1/transactions/page').set(auth(accessToken))).body).toEqual({ items: [], nextCursor: null });
    expect((await request(app).get('/api/v1/transactions/page').query({ cursor: 'x' }).set(auth(accessToken))).status).toBe(400);
    expect((await request(app).get('/api/v1/transactions/page').query({ limit: 1000 }).set(auth(accessToken))).status).toBe(400);
  });
});

describe('overall monthly budget', () => {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();
  const day = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const iso = (y: number, m: number, d = 1) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const lastMonth = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/budgets/overall')).status).toBe(401);
  });

  it('starts empty, with a suggestion from last months spending', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 14230, type: 'expense', category_key: 'groceries_milk', date: iso(lastMonth.y, lastMonth.m) });
    const res = await request(app).get('/api/v1/budgets/overall').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ amount: null, spent: 0, suggested: 14200, status: null, per_day: null });
  });

  it('counts day-to-day spending, leaves EMIs and investments out, and works out per day', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).put('/api/v1/budgets/overall').set(auth(accessToken)).send({ amount: 15000 })).body).toEqual({ amount: 15000, include_commitments: false });
    const add = (category_key: string, amount: number) =>
      request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount, type: 'expense', category_key, date: iso(year, month) });
    await add('groceries_milk', 6000);
    await add('entertainment', 3200);
    await add('loan_emi', 8000); // Loans & EMIs — not counted
    await add('mutual_funds', 5000); // Investments — not counted
    await request(app).put('/api/v1/budgets/groceries_milk').set(auth(accessToken)).send({ monthly_limit: 5000 });
    await request(app).put('/api/v1/budgets/loan_emi').set(auth(accessToken)).send({ monthly_limit: 8000 }); // outside the total

    const res = await request(app).get('/api/v1/budgets/overall').set(auth(accessToken));
    const daysLeft = daysInMonth - day + 1;
    expect(res.body).toMatchObject({ amount: 15000, spent: 9200, left: 5800, allocated: 5000, status: 'ok', days_left: daysLeft, per_day: Math.floor(5800 / daysLeft) });

    await request(app).put('/api/v1/budgets/overall').set(auth(accessToken)).send({ amount: 15000, include_commitments: true });
    const withCommitments = await request(app).get('/api/v1/budgets/overall').set(auth(accessToken));
    expect(withCommitments.body).toMatchObject({ spent: 22200, allocated: 13000, status: 'over', per_day: 0 });
  });

  it('starts every month fresh (no carry-over) and shows no days left for a past month', async () => {
    const { accessToken } = await registerUser();
    await request(app).put('/api/v1/budgets/overall').set(auth(accessToken)).send({ amount: 10000 });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 2000, type: 'expense', category_key: 'groceries_milk', date: iso(lastMonth.y, lastMonth.m) });
    const past = await request(app).get('/api/v1/budgets/overall').query({ month: lastMonth.m, year: lastMonth.y }).set(auth(accessToken));
    expect(past.body).toMatchObject({ spent: 2000, left: 8000, days_left: 0, per_day: 0 });
    const current = await request(app).get('/api/v1/budgets/overall').set(auth(accessToken));
    expect(current.body).toMatchObject({ spent: 0, left: 10000 });
  });

  it('is private to each user, rejects a bad amount, and can be removed', async () => {
    const { accessToken } = await registerUser();
    const other = await registerUser();
    await request(app).put('/api/v1/budgets/overall').set(auth(accessToken)).send({ amount: 9000 });
    expect((await request(app).get('/api/v1/budgets/overall').set(auth(other.accessToken))).body.amount).toBeNull();
    expect((await request(app).put('/api/v1/budgets/overall').set(auth(accessToken)).send({ amount: 0 })).status).toBe(400);
    expect((await request(app).delete('/api/v1/budgets/overall').set(auth(accessToken))).status).toBe(204);
    expect((await request(app).delete('/api/v1/budgets/overall').set(auth(accessToken))).status).toBe(404);
    expect((await request(app).get('/api/v1/budgets/overall').set(auth(accessToken))).body.amount).toBeNull();
  });
});
