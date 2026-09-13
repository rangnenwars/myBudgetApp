import request from 'supertest';
import { app, registerUser } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('loans CRUD', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request(app).get('/api/v1/loans')).status).toBe(401);
    expect((await request(app).post('/api/v1/loans').send({})).status).toBe(401);
  });

  it('lists only the caller\'s own loans', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    await request(app).post('/api/v1/loans').set(auth(userA.accessToken)).send({ name: 'A-only', principal: 1000, outstanding: 1000, emi: 100 });

    const aList = await request(app).get('/api/v1/loans').set(auth(userA.accessToken));
    expect(aList.status).toBe(200);
    expect(aList.body).toHaveLength(1);

    const bList = await request(app).get('/api/v1/loans').set(auth(userB.accessToken));
    expect(bList.body).toHaveLength(0);
  });

  it('creates a loan, defaulting is_active to true', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'Home loan', principal: 2000000, outstanding: 1800000, emi: 25000, interest_rate: 8.5 });

    expect(res.status).toBe(201);
    expect(res.body.is_active).toBe(true);
    expect(res.body.interest_rate).toBe(8.5);
  });

  it('rejects a negative outstanding balance', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'Bad loan', principal: 1000, outstanding: -1, emi: 100 });
    expect(res.status).toBe(400);
  });

  it('updates outstanding via PATCH', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'Car loan', principal: 500000, outstanding: 400000, emi: 10000 });

    const updated = await request(app).patch(`/api/v1/loans/${created.body.id}`).set(auth(accessToken)).send({ outstanding: 390000 });
    expect(updated.status).toBe(200);
    expect(updated.body.outstanding).toBe(390000);
  });

  it('updates any combination of editable fields via PATCH, not just outstanding', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'Car loan', principal: 500000, outstanding: 400000, emi: 10000 });

    const updated = await request(app)
      .patch(`/api/v1/loans/${created.body.id}`)
      .set(auth(accessToken))
      .send({ name: 'Car loan (refinanced)', emi: 9500, interest_rate: 7.9 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ name: 'Car loan (refinanced)', emi: 9500, interest_rate: 7.9, principal: 500000, outstanding: 400000 });
  });

  it('rejects an empty patch body', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Loan', principal: 1000, outstanding: 1000, emi: 100 });
    const res = await request(app).patch(`/api/v1/loans/${created.body.id}`).set(auth(accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it('cannot update or delete another user\'s loan', async () => {
    const userA = await registerUser();
    const userB = await registerUser();
    const loan = await request(app)
      .post('/api/v1/loans')
      .set(auth(userA.accessToken))
      .send({ name: 'Loan', principal: 1000, outstanding: 1000, emi: 100 });

    const crossUpdate = await request(app).patch(`/api/v1/loans/${loan.body.id}`).set(auth(userB.accessToken)).send({ outstanding: 0 });
    expect(crossUpdate.status).toBe(404);

    const crossDelete = await request(app).delete(`/api/v1/loans/${loan.body.id}`).set(auth(userB.accessToken));
    expect(crossDelete.status).toBe(404);
  });

  it('deletes a loan', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'To delete', principal: 1000, outstanding: 1000, emi: 100 });

    expect((await request(app).delete(`/api/v1/loans/${created.body.id}`).set(auth(accessToken))).status).toBe(204);
    const list = await request(app).get('/api/v1/loans').set(auth(accessToken));
    expect(list.body).toHaveLength(0);
  });
});
