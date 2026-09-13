import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('savings goals CRUD', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request(app).get('/api/v1/goals')).status).toBe(401);
    expect((await request(app).post('/api/v1/goals').send({})).status).toBe(401);
  });

  it('lists only the caller\'s own goals', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    await request(app).post('/api/v1/goals').set(auth(userA.accessToken)).send({ name: 'A-only', target_amount: 1000 });

    const aList = await request(app).get('/api/v1/goals').set(auth(userA.accessToken));
    expect(aList.status).toBe(200);
    expect(aList.body).toHaveLength(1);

    const bList = await request(app).get('/api/v1/goals').set(auth(userB.accessToken));
    expect(bList.body).toHaveLength(0);
  });

  it('creates a goal starting at zero saved', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Emergency fund', target_amount: 100000 });
    expect(res.status).toBe(201);
    expect(res.body.saved_amount).toBe(0);
    expect(res.body.color).toMatch(/^#/);
  });

  it('assigns different colors round-robin as goals accumulate', async () => {
    const { accessToken } = await registerUser();
    const first = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal 1', target_amount: 1000 });
    const second = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal 2', target_amount: 1000 });
    expect(first.body.color).not.toBe(second.body.color);
  });

  it('updates saved_amount via PATCH', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal', target_amount: 10000 });
    const updated = await request(app).patch(`/api/v1/goals/${created.body.id}`).set(auth(accessToken)).send({ saved_amount: 2500 });
    expect(updated.body.saved_amount).toBe(2500);
  });

  it('rejects a non-positive target amount', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Bad', target_amount: 0 });
    expect(res.status).toBe(400);
  });

  it('updates name and target_amount via PATCH, not just saved_amount', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal', target_amount: 10000 });
    const updated = await request(app).patch(`/api/v1/goals/${created.body.id}`).set(auth(accessToken)).send({ name: 'Renamed goal', target_amount: 20000 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Renamed goal', target_amount: 20000, saved_amount: 0 });
  });

  it('rejects an empty patch body', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal', target_amount: 1000 });
    const res = await request(app).patch(`/api/v1/goals/${created.body.id}`).set(auth(accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it('rejects a non-positive target_amount on PATCH', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal', target_amount: 1000 });
    const res = await request(app).patch(`/api/v1/goals/${created.body.id}`).set(auth(accessToken)).send({ target_amount: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects a negative saved_amount on PATCH', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal', target_amount: 1000 });
    const res = await request(app).patch(`/api/v1/goals/${created.body.id}`).set(auth(accessToken)).send({ saved_amount: -100 });
    expect(res.status).toBe(400);
  });

  it('returns 404 patching a nonexistent goal', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).patch('/api/v1/goals/999999999').set(auth(accessToken)).send({ saved_amount: 100 });
    expect(res.status).toBe(404);
  });

  it('cannot update another user\'s goal', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const created = await request(app).post('/api/v1/goals').set(auth(userA.accessToken)).send({ name: 'Goal', target_amount: 1000 });

    const crossUpdate = await request(app).patch(`/api/v1/goals/${created.body.id}`).set(auth(userB.accessToken)).send({ saved_amount: 500 });
    expect(crossUpdate.status).toBe(404);

    const stillZero = await request(app).get('/api/v1/goals').set(auth(userA.accessToken));
    expect(stillZero.body[0].saved_amount).toBe(0);
  });

  it('deletes a goal, scoped to the owner', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const created = await request(app).post('/api/v1/goals').set(auth(userA.accessToken)).send({ name: 'Goal', target_amount: 1000 });

    expect((await request(app).delete(`/api/v1/goals/${created.body.id}`).set(auth(userB.accessToken))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/goals/${created.body.id}`).set(auth(userA.accessToken))).status).toBe(204);
  });
});
