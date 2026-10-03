import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('transaction category must match its type', () => {
  it('rejects an expense in an income category on create', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 100, type: 'expense', category_key: 'salary_1', date: '2026-09-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/for income/);
  });

  it('rejects a PATCH that flips only the type, leaving the category on the wrong side', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 100, type: 'expense', category_key: 'internet', date: '2026-09-01' });
    expect((await request(app).patch(`/api/v1/transactions/${created.body.id}`).set(auth(accessToken)).send({ type: 'income' })).status).toBe(400);
    // Changing both together is fine.
    const ok = await request(app).patch(`/api/v1/transactions/${created.body.id}`).set(auth(accessToken)).send({ type: 'income', category_key: 'salary_1' });
    expect(ok.status).toBe(200);
  });
});

describe('deleting a transaction updates the budget class', () => {
  it('drops back once the big expense is removed', async () => {
    const { accessToken } = await registerUser();
    const today = new Date();
    const date = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const big = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 5_000_000, type: 'expense', category_key: 'internet', date });
    const before = (await request(app).get('/api/v1/auth/me').set(auth(accessToken))).body.budgetClass;

    await request(app).delete(`/api/v1/transactions/${big.body.id}`).set(auth(accessToken));
    const after = (await request(app).get('/api/v1/auth/me').set(auth(accessToken))).body.budgetClass;
    expect(after).not.toBe(before);
  });
});

describe('renaming a category', () => {
  it('refuses a name another visible category of the same type already has', async () => {
    const { accessToken } = await registerUser();
    const mine = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Hobby', type: 'expense' });
    expect((await request(app).patch(`/api/v1/categories/${mine.body.key}`).set(auth(accessToken)).send({ name: 'internet' })).status).toBe(409);
    expect((await request(app).patch(`/api/v1/categories/${mine.body.key}`).set(auth(accessToken)).send({ name: 'hobby' })).status).toBe(200);
  });
});

describe('editing a goal’s saved amount directly', () => {
  it('records the difference in the contribution history', async () => {
    const { accessToken } = await registerUser();
    const goal = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Trip', target_amount: 10000 });
    await request(app).patch(`/api/v1/goals/${goal.body.id}`).set(auth(accessToken)).send({ saved_amount: 2500 });
    await request(app).patch(`/api/v1/goals/${goal.body.id}`).set(auth(accessToken)).send({ saved_amount: 2000 });
    await request(app).patch(`/api/v1/goals/${goal.body.id}`).set(auth(accessToken)).send({ name: 'Trip 2' });

    const history = (await request(app).get(`/api/v1/goals/${goal.body.id}/contributions`).set(auth(accessToken))).body;
    expect(history.map((c: { type: string; amount: number }) => [c.type, c.amount]).sort()).toEqual([
      ['add', 2500],
      ['remove', 500],
    ]);
  });
});

describe('POST /transactions/batch', () => {
  it('saves every entry', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/transactions/batch')
      .set(auth(accessToken))
      .send({
        entries: [
          { amount: 100, type: 'expense', category_key: 'internet', date: '2026-09-01' },
          { amount: 200, type: 'expense', category_key: 'fuel_petrol', date: '2026-09-01' },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
  });

  it('saves nothing when any entry is invalid', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/transactions/batch')
      .set(auth(accessToken))
      .send({
        entries: [
          { amount: 100, type: 'expense', category_key: 'internet', date: '2026-09-01' },
          { amount: 200, type: 'expense', category_key: 'no_such_category', date: '2026-09-01' },
        ],
      });
    expect(res.status).toBe(400);
    const page = (await request(app).get('/api/v1/transactions/page').set(auth(accessToken))).body;
    expect(page.items).toHaveLength(0);
  });
});

describe('investment returns no longer overflow', () => {
  it('stores a 10,000× gain (999,900%) without a database error', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'Moonshot', type: 'Stock', amount: 100, current_value: 1_000_000 });
    expect(res.status).toBe(201);
    expect(res.body.returns_percent).toBe(999900);
  });
});
