import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('investments CRUD', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request(app).get('/api/v1/investments')).status).toBe(401);
    expect((await request(app).post('/api/v1/investments').send({})).status).toBe(401);
  });

  it('lists only the caller\'s own investments', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    await request(app).post('/api/v1/investments').set(auth(userA.accessToken)).send({ name: 'A-only', type: 'Gold', amount: 1000 });

    const aList = await request(app).get('/api/v1/investments').set(auth(userA.accessToken));
    expect(aList.status).toBe(200);
    expect(aList.body).toHaveLength(1);
    expect(aList.body[0].name).toBe('A-only');

    const bList = await request(app).get('/api/v1/investments').set(auth(userB.accessToken));
    expect(bList.body).toHaveLength(0);
  });

  it('rejects a non-positive amount', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'Bad', type: 'Gold', amount: 0 });
    expect(res.status).toBe(400);
  });

  it('computes returns_percent server-side, never trusting a client-supplied value', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/investments')
      .set(auth(accessToken))
      // Client sends no returns_percent at all — server derives it from amount/current_value.
      .send({ name: 'Index fund', type: 'Mutual fund', amount: 10000, current_value: 12000 });

    expect(res.status).toBe(201);
    expect(res.body.returns_percent).toBe(20);
  });

  it('falls back current_value to amount, and gain to 0%, when current_value is omitted', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/investments')
      .set(auth(accessToken))
      .send({ name: 'FD', type: 'Fixed deposit', amount: 5000 });

    expect(res.body.current_value).toBe(5000);
    expect(res.body.returns_percent).toBe(0);
  });

  it('computes a negative gain for a loss', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/investments')
      .set(auth(accessToken))
      .send({ name: 'Losing stock', type: 'Stock', amount: 10000, current_value: 8000 });

    expect(res.body.returns_percent).toBe(-20);
  });

  it('recomputes returns_percent on PATCH when current_value changes', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'Index fund', type: 'Mutual fund', amount: 10000, current_value: 10000 });

    const updated = await request(app).patch(`/api/v1/investments/${created.body.id}`).set(auth(accessToken)).send({ current_value: 11000 });
    expect(updated.status).toBe(200);
    expect(updated.body.returns_percent).toBe(10);
  });

  it('recomputes returns_percent on PATCH using the existing current_value when only amount changes', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'FD', type: 'Fixed deposit', amount: 10000, current_value: 12000 });

    const updated = await request(app).patch(`/api/v1/investments/${created.body.id}`).set(auth(accessToken)).send({ amount: 8000 });
    expect(updated.status).toBe(200);
    expect(updated.body.amount).toBe(8000);
    expect(updated.body.current_value).toBe(12000);
    expect(updated.body.returns_percent).toBe(50); // (12000-8000)/8000 * 100
  });

  it('updates name/type via PATCH without touching the numbers', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'Old name', type: 'Gold', amount: 1000 });

    const updated = await request(app).patch(`/api/v1/investments/${created.body.id}`).set(auth(accessToken)).send({ name: 'New name', type: 'Bonds' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'New name', type: 'Bonds', amount: 1000 });
  });

  it('rejects an empty patch body', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'Gold', type: 'Gold', amount: 1000 });
    const res = await request(app).patch(`/api/v1/investments/${created.body.id}`).set(auth(accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it('cannot update another user\'s investment', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const created = await request(app).post('/api/v1/investments').set(auth(userA.accessToken)).send({ name: 'Gold', type: 'Gold', amount: 1000 });

    const res = await request(app).patch(`/api/v1/investments/${created.body.id}`).set(auth(userB.accessToken)).send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it('deletes an investment, scoped to the owner', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const created = await request(app)
      .post('/api/v1/investments')
      .set(auth(userA.accessToken))
      .send({ name: 'Gold', type: 'Gold', amount: 1000 });

    expect((await request(app).delete(`/api/v1/investments/${created.body.id}`).set(auth(userB.accessToken))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/investments/${created.body.id}`).set(auth(userA.accessToken))).status).toBe(204);
  });
});
