import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('net worth snapshot + history', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request(app).post('/api/v1/net-worth/snapshot')).status).toBe(401);
    expect((await request(app).get('/api/v1/net-worth/history')).status).toBe(401);
  });

  it('computes net worth as investments + goals saved - loans outstanding', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'Fund', type: 'Mutual fund', amount: 20000, current_value: 20000 });
    await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Goal', target_amount: 10000 });
    const goal = (await request(app).get('/api/v1/goals').set(auth(accessToken))).body[0];
    await request(app).patch(`/api/v1/goals/${goal.id}`).set(auth(accessToken)).send({ saved_amount: 5000 });
    await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Loan', principal: 8000, outstanding: 8000, emi: 500 });

    const snapshot = await request(app).post('/api/v1/net-worth/snapshot').set(auth(accessToken));
    expect(snapshot.status).toBe(200);
    // 20000 (investments) + 5000 (goal saved) - 8000 (loan outstanding) = 17000
    expect(snapshot.body.netWorth).toBe(17000);
  });

  it('upserts rather than duplicating within the same month', async () => {
    const { accessToken } = await registerUser();
    await request(app).post('/api/v1/net-worth/snapshot').set(auth(accessToken));
    await request(app).post('/api/v1/net-worth/snapshot').set(auth(accessToken));

    const history = await request(app).get('/api/v1/net-worth/history').set(auth(accessToken));
    expect(history.body).toHaveLength(1);
  });

  it('scopes history to the requesting user', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    await request(app).post('/api/v1/net-worth/snapshot').set(auth(userA.accessToken));

    const bHistory = await request(app).get('/api/v1/net-worth/history').set(auth(userB.accessToken));
    expect(bHistory.body).toHaveLength(0);
  });
});
