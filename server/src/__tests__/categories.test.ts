import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('GET /api/v1/categories', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(401);
  });

  it('returns the system categories, none marked custom', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).get('/api/v1/categories').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.some((c: { key: string }) => c.key === 'groceries_milk')).toBe(true);
    expect(res.body.every((c: { isCustom: boolean }) => c.isCustom === false)).toBe(true);
  });

  it("does not include another user's custom categories", async () => {
    const owner = await registerUser();
    const other = await registerUser();

    const created = await request(app).post('/api/v1/categories').set(auth(owner.accessToken)).send({ name: 'Owner only', type: 'expense' });
    expect(created.status).toBe(201);

    const res = await request(app).get('/api/v1/categories').set(auth(other.accessToken));
    expect(res.body.some((c: { key: string }) => c.key === created.body.key)).toBe(false);
  });
});

describe('POST /api/v1/categories', () => {
  it('creates a custom category owned by the caller', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Pet supplies', type: 'expense' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ label: 'Pet supplies', type: 'expense', group: 'Custom', isCustom: true });
    expect(res.body.key).toMatch(/^custom_/);

    const list = await request(app).get('/api/v1/categories').set(auth(accessToken));
    expect(list.body.some((c: { key: string }) => c.key === res.body.key)).toBe(true);
  });

  it('rejects a blank name', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: '  ', type: 'expense' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid type', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Whatever', type: 'savings' });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/categories/:key', () => {
  it('lets the owner rename their own custom category, keeping the key stable', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Pet supplies', type: 'expense' });

    const renamed = await request(app).patch(`/api/v1/categories/${created.body.key}`).set(auth(accessToken)).send({ name: 'Pet care' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.key).toBe(created.body.key);
    expect(renamed.body.label).toBe('Pet care');
  });

  it("a rename doesn't break a transaction already referencing the category", async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Pet supplies', type: 'expense' });
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 100, type: 'expense', category_key: created.body.key, date: '2026-01-15' });

    const renamed = await request(app).patch(`/api/v1/categories/${created.body.key}`).set(auth(accessToken)).send({ name: 'Pet care' });
    expect(renamed.status).toBe(200);

    const txns = await request(app).get('/api/v1/transactions').set(auth(accessToken));
    expect(txns.body[0].category).toBe(created.body.key);
  });

  it('refuses to rename a system category', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).patch('/api/v1/categories/groceries_milk').set(auth(accessToken)).send({ name: 'Renamed' });
    expect(res.status).toBe(403);
  });

  it("hides another user's custom category behind a 404", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(owner.accessToken)).send({ name: 'Not yours', type: 'expense' });

    const res = await request(app).patch(`/api/v1/categories/${created.body.key}`).set(auth(other.accessToken)).send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it('rejects a blank name', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Pet supplies', type: 'expense' });
    const res = await request(app).patch(`/api/v1/categories/${created.body.key}`).set(auth(accessToken)).send({ name: '  ' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/categories/:key', () => {
  it('lets the owner delete their own unused custom category', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'Temp', type: 'expense' });

    const del = await request(app).delete(`/api/v1/categories/${created.body.key}`).set(auth(accessToken));
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/v1/categories').set(auth(accessToken));
    expect(list.body.some((c: { key: string }) => c.key === created.body.key)).toBe(false);
  });

  it('refuses to delete a system category', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).delete('/api/v1/categories/groceries_milk').set(auth(accessToken));
    expect(res.status).toBe(403);
  });

  it("hides another user's custom category behind a 404, not a 403", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(owner.accessToken)).send({ name: 'Not yours', type: 'expense' });

    const res = await request(app).delete(`/api/v1/categories/${created.body.key}`).set(auth(other.accessToken));
    expect(res.status).toBe(404);
  });

  it('refuses to delete a custom category that is still in use', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name: 'In use', type: 'expense' });

    const txn = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 100, type: 'expense', category_key: created.body.key, date: '2026-01-15' });
    expect(txn.status).toBe(201);

    const del = await request(app).delete(`/api/v1/categories/${created.body.key}`).set(auth(accessToken));
    expect(del.status).toBe(409);
  });

  it('returns 404 for a nonexistent key', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).delete('/api/v1/categories/does_not_exist').set(auth(accessToken));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/transactions category ownership', () => {
  it("rejects a transaction referencing another user's custom category", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const created = await request(app).post('/api/v1/categories').set(auth(owner.accessToken)).send({ name: 'Owner category', type: 'expense' });

    const res = await request(app)
      .post('/api/v1/transactions')
      .set(auth(other.accessToken))
      .send({ amount: 50, type: 'expense', category_key: created.body.key, date: '2026-01-15' });
    expect(res.status).toBe(400);
  });
});
