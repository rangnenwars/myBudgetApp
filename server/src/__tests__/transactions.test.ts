import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('transactions CRUD', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request(app).get('/api/v1/transactions')).status).toBe(401);
    expect((await request(app).post('/api/v1/transactions').send({})).status).toBe(401);
  });

  it('creates and lists a transaction scoped to the current month/year', async () => {
    const { accessToken } = await registerUser();
    const today = new Date().toISOString().slice(0, 10);

    const create = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 1500, type: 'expense', category_key: 'fuel_petrol', date: today, note: 'petrol' });
    expect(create.status).toBe(201);
    expect(create.body.category).toBe('fuel_petrol');
    expect(create.body.amount).toBe(1500);

    const list = await request(app).get('/api/v1/transactions').set(auth(accessToken));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].note).toBe('petrol');
  });

  it('filters the list by ?month=&year=', async () => {
    const { accessToken } = await registerUser();
    const now = new Date();
    const thisMonthDate = now.toISOString().slice(0, 10);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 10);

    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 100, type: 'expense', category_key: 'fuel_petrol', date: thisMonthDate });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 200, type: 'expense', category_key: 'fuel_petrol', date: lastMonth });

    const res = await request(app)
      .get('/api/v1/transactions')
      .query({ month: now.getMonth() + 1, year: now.getFullYear() })
      .set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount).toBe(100);
  });

  it('rejects a non-positive amount', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: -5, type: 'expense', category_key: 'fuel_petrol', date: '2026-06-01' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid type', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 100, type: 'savings', category_key: 'fuel_petrol', date: '2026-06-01' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed date', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 100, type: 'expense', category_key: 'fuel_petrol', date: '06/01/2026' });
    expect(res.status).toBe(400);
  });

  it('updates amount, category, note and date via PATCH', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 100, type: 'expense', category_key: 'fuel_petrol', date: '2026-06-01', note: 'oops' });

    const updated = await request(app)
      .patch(`/api/v1/transactions/${created.body.id}`)
      .set(auth(accessToken))
      .send({ amount: 150, category_key: 'groceries_milk', note: 'fixed', date: '2026-07-15' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ amount: 150, category: 'groceries_milk', note: 'fixed', date: '2026-07-15', month: 7, year: 2026 });
  });

  it('rejects a PATCH to a category that is not a system category or the caller\'s own', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(owner.accessToken)).send({ name: 'Owner-only', type: 'expense' });
    const txn = await request(app)
      .post('/api/v1/transactions')
      .set(auth(other.accessToken))
      .send({ amount: 100, type: 'expense', category_key: 'fuel_petrol', date: '2026-06-01' });

    const res = await request(app).patch(`/api/v1/transactions/${txn.body.id}`).set(auth(other.accessToken)).send({ category_key: created.body.key });
    expect(res.status).toBe(400);
  });

  it('rejects an empty patch body', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 100, type: 'expense', category_key: 'fuel_petrol', date: '2026-06-01' });
    const res = await request(app).patch(`/api/v1/transactions/${created.body.id}`).set(auth(accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it('recomputes budget_class after an edit changes the amount', async () => {
    const { accessToken } = await registerUser();
    const today = new Date().toISOString().slice(0, 10);
    const created = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 1000, type: 'expense', category_key: 'groceries_milk', date: today });

    await request(app).patch(`/api/v1/transactions/${created.body.id}`).set(auth(accessToken)).send({ amount: 45000 });

    const after = await request(app).get('/api/v1/auth/me').set(auth(accessToken));
    expect(after.body.budgetClass).toBe('middle');
  });

  it('cannot update another user\'s transaction', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const created = await request(app)
      .post('/api/v1/transactions')
      .set(auth(userA.accessToken))
      .send({ amount: 200, type: 'expense', category_key: 'fuel_petrol', date: '2026-06-01' });

    const res = await request(app).patch(`/api/v1/transactions/${created.body.id}`).set(auth(userB.accessToken)).send({ amount: 1 });
    expect(res.status).toBe(404);
  });

  it('never returns another user\'s transactions (scoping)', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const today = new Date().toISOString().slice(0, 10);

    await request(app)
      .post('/api/v1/transactions')
      .set(auth(userA.accessToken))
      .send({ amount: 999, type: 'expense', category_key: 'fuel_petrol', date: today });

    const bList = await request(app).get('/api/v1/transactions').set(auth(userB.accessToken));
    expect(bList.body).toHaveLength(0);
  });

  it('cannot delete another user\'s transaction', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const today = new Date().toISOString().slice(0, 10);

    const created = await request(app)
      .post('/api/v1/transactions')
      .set(auth(userA.accessToken))
      .send({ amount: 200, type: 'expense', category_key: 'fuel_petrol', date: today });

    const crossDelete = await request(app).delete(`/api/v1/transactions/${created.body.id}`).set(auth(userB.accessToken));
    expect(crossDelete.status).toBe(404);

    const stillThere = await request(app).get('/api/v1/transactions').set(auth(userA.accessToken));
    expect(stillThere.body).toHaveLength(1);
  });

  it('deletes a transaction', async () => {
    const { accessToken } = await registerUser();
    const today = new Date().toISOString().slice(0, 10);
    const created = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 200, type: 'expense', category_key: 'fuel_petrol', date: today });

    const del = await request(app).delete(`/api/v1/transactions/${created.body.id}`).set(auth(accessToken));
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/v1/transactions').set(auth(accessToken));
    expect(list.body).toHaveLength(0);
  });

  it('recomputes budget_class server-side after adding a transaction', async () => {
    const { accessToken } = await registerUser();
    const today = new Date().toISOString().slice(0, 10);

    const before = await request(app).get('/api/v1/auth/me').set(auth(accessToken));
    expect(before.body.budgetClass).toBeNull();

    // 45,000 falls in the "middle" bracket (30k–100k) per classifyLocal.
    await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 45000, type: 'expense', category_key: 'groceries_milk', date: today });

    const after = await request(app).get('/api/v1/auth/me').set(auth(accessToken));
    expect(after.body.budgetClass).toBe('middle');
  });
});

describe('GET /api/v1/transactions/range', () => {
  it('only returns transactions inside the requested month range', async () => {
    const { accessToken } = await registerUser();
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;

    // A transaction dated 6 months ago, likely outside the default "last 3 months" range used below.
    const old = new Date(now.getFullYear(), now.getMonth() - 6, 15);
    const oldDate = old.toISOString().slice(0, 10);

    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 100, type: 'expense', category_key: 'fuel_petrol', date: thisMonth });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 200, type: 'expense', category_key: 'fuel_petrol', date: oldDate });

    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const res = await request(app)
      .get('/api/v1/transactions/range')
      .query({ startMonth: start.getMonth() + 1, startYear: start.getFullYear(), endMonth: now.getMonth() + 1, endYear: now.getFullYear() })
      .set(auth(accessToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].amount).toBe(100);
  });
});
