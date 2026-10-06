import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { peopleLedger } from '../db/schema';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const addPerson = async (token: string, name = 'Rahul') => {
  const res = await request(app).post('/api/v1/people').set(auth(token)).send({ name });
  expect(res.status).toBe(201);
  return res.body as { id: number; name: string; balance: number };
};

const entry = (token: string, id: number, body: Record<string, unknown>) =>
  request(app).post(`/api/v1/people/${id}/entries`).set(auth(token)).send(body);

const detail = async (token: string, id: number) => (await request(app).get(`/api/v1/people/${id}`).set(auth(token))).body;

describe('people', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/people')).status).toBe(401);
    expect((await request(app).post('/api/v1/people').send({ name: 'X' })).status).toBe(401);
    expect((await request(app).post('/api/v1/people/1/entries').send({})).status).toBe(401);
  });

  it('creates a person with a zero balance and lists them', async () => {
    const { accessToken } = await registerUser();
    const rahul = await addPerson(accessToken);
    expect(rahul).toMatchObject({ name: 'Rahul', balance: 0 });
    const list = await request(app).get('/api/v1/people').set(auth(accessToken));
    expect(list.body).toMatchObject({ youGet: 0, youOwe: 0 });
    expect(list.body.people).toHaveLength(1);
  });

  it('rejects blank, over-long and duplicate names (any letter case)', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).post('/api/v1/people').set(auth(accessToken)).send({ name: '   ' })).status).toBe(400);
    expect((await request(app).post('/api/v1/people').set(auth(accessToken)).send({ name: 'x'.repeat(61) })).status).toBe(400);
    await addPerson(accessToken, 'Rahul');
    const dup = await request(app).post('/api/v1/people').set(auth(accessToken)).send({ name: 'rahul' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already in your list/);
  });

  it('lets two users keep a person with the same name', async () => {
    const a = await registerUser();
    const b = await registerUser();
    await addPerson(a.accessToken, 'Amit');
    await addPerson(b.accessToken, 'Amit');
  });

  it('tracks money lent, part payments and settling to zero', async () => {
    const { accessToken } = await registerUser();
    const amit = await addPerson(accessToken, 'Amit');

    const lent = await entry(accessToken, amit.id, { kind: 'lent', amount: 5000, note: 'laptop repair', due_date: '2099-01-31' });
    expect(lent.status).toBe(201);
    expect(lent.body.entry.amount).toBe(5000);
    expect(lent.body.person).toMatchObject({ balance: 5000, dueDate: '2099-01-31', overdue: false });

    const part = await entry(accessToken, amit.id, { kind: 'received', amount: 2000 });
    expect(part.body.entry.amount).toBe(-2000);
    expect(part.body.person.balance).toBe(3000);

    const list = await request(app).get('/api/v1/people').set(auth(accessToken));
    expect(list.body).toMatchObject({ youGet: 3000, youOwe: 0 });

    const rest = await entry(accessToken, amit.id, { kind: 'received', amount: 3000 });
    expect(rest.body.person).toMatchObject({ balance: 0, dueDate: null });
  });

  it('tracks money borrowed and repaid', async () => {
    const { accessToken } = await registerUser();
    const sana = await addPerson(accessToken, 'Sana');
    const borrowed = await entry(accessToken, sana.id, { kind: 'borrowed', amount: 500 });
    expect(borrowed.body.entry.amount).toBe(-500);
    expect(borrowed.body.person.balance).toBe(-500);
    expect((await request(app).get('/api/v1/people').set(auth(accessToken))).body).toMatchObject({ youGet: 0, youOwe: 500 });

    const repaid = await entry(accessToken, sana.id, { kind: 'repaid', amount: 200 });
    expect(repaid.body.person.balance).toBe(-300);
  });

  it('refuses a payment bigger than what is owed, in either direction', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    expect((await entry(accessToken, p.id, { kind: 'received', amount: 10 })).body.error).toMatch(/doesn't owe you anything/);
    expect((await entry(accessToken, p.id, { kind: 'repaid', amount: 10 })).body.error).toMatch(/don't owe/);

    await entry(accessToken, p.id, { kind: 'lent', amount: 100 });
    const tooMuch = await entry(accessToken, p.id, { kind: 'received', amount: 150 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatch(/only owes you ₹100/);
    expect((await detail(accessToken, p.id)).person.balance).toBe(100);
  });

  it('adds rupees and paise without floating-point drift', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    await entry(accessToken, p.id, { kind: 'lent', amount: 0.1 });
    await entry(accessToken, p.id, { kind: 'lent', amount: 0.2 });
    expect((await detail(accessToken, p.id)).person.balance).toBe(0.3);
    expect((await entry(accessToken, p.id, { kind: 'received', amount: 0.3 })).body.person.balance).toBe(0);
  });

  it('writes off what is left, keeping the history', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    await entry(accessToken, p.id, { kind: 'lent', amount: 1000 });
    await entry(accessToken, p.id, { kind: 'received', amount: 400 });
    expect((await entry(accessToken, p.id, { kind: 'written_off', amount: 100 })).status).toBe(400);
    const off = await entry(accessToken, p.id, { kind: 'written_off' });
    expect(off.status).toBe(201);
    expect(off.body.entry).toMatchObject({ kind: 'written_off', amount: -600 });
    const d = await detail(accessToken, p.id);
    expect(d.person.balance).toBe(0);
    expect(d.entries.map((e: { kind: string }) => e.kind)).toEqual(['written_off', 'received', 'lent']);
    expect((await entry(accessToken, p.id, { kind: 'written_off' })).status).toBe(400);
  });

  it('requires an amount for everything except a write-off, and rejects bad amounts and dates', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    expect((await entry(accessToken, p.id, { kind: 'lent' })).status).toBe(400);
    expect((await entry(accessToken, p.id, { kind: 'lent', amount: 0 })).status).toBe(400);
    expect((await entry(accessToken, p.id, { kind: 'lent', amount: -5 })).status).toBe(400);
    expect((await entry(accessToken, p.id, { kind: 'gift', amount: 5 })).status).toBe(400);
    expect((await entry(accessToken, p.id, { kind: 'lent', amount: 5, date: '2026-02-30' })).status).toBe(400);
  });

  it('flags a balance as overdue once its due date has passed, and lets the date be changed or cleared', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    const lent = await entry(accessToken, p.id, { kind: 'lent', amount: 800, due_date: '2020-01-01' });
    expect(lent.body.person.overdue).toBe(true);
    expect((await request(app).get('/api/v1/people').set(auth(accessToken))).body.people[0].overdue).toBe(true);

    const moved = await request(app).patch(`/api/v1/people/${p.id}`).set(auth(accessToken)).send({ due_date: '2099-12-31' });
    expect(moved.body).toMatchObject({ dueDate: '2099-12-31', overdue: false, balance: 800 });
    const cleared = await request(app).patch(`/api/v1/people/${p.id}`).set(auth(accessToken)).send({ due_date: null });
    expect(cleared.body.dueDate).toBeNull();
  });

  it('is never overdue when nothing is owed', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    await request(app).patch(`/api/v1/people/${p.id}`).set(auth(accessToken)).send({ due_date: '2020-01-01' });
    expect((await detail(accessToken, p.id)).person.overdue).toBe(false);
  });

  it('renames a person, refusing a name already used', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'Amit');
    await addPerson(accessToken, 'Rahul');
    expect((await request(app).patch(`/api/v1/people/${a.id}`).set(auth(accessToken)).send({ name: 'Amit K' })).body.name).toBe('Amit K');
    expect((await request(app).patch(`/api/v1/people/${a.id}`).set(auth(accessToken)).send({ name: 'RAHUL' })).status).toBe(409);
    expect((await request(app).patch(`/api/v1/people/${a.id}`).set(auth(accessToken)).send({})).status).toBe(400);
  });

  it('undoes a mistaken line and recomputes the balance', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    await entry(accessToken, p.id, { kind: 'lent', amount: 500, due_date: '2099-01-01' });
    const paid = await entry(accessToken, p.id, { kind: 'received', amount: 500 });
    expect(paid.body.person.balance).toBe(0);
    const del = await request(app).delete(`/api/v1/people/${p.id}/entries/${paid.body.entry.id}`).set(auth(accessToken));
    expect(del.status).toBe(204);
    expect((await detail(accessToken, p.id)).person.balance).toBe(500);
    expect((await request(app).delete(`/api/v1/people/${p.id}/entries/${paid.body.entry.id}`).set(auth(accessToken))).status).toBe(404);
  });

  it('deletes a person together with their lines', async () => {
    const { accessToken, user } = await registerUser();
    const p = await addPerson(accessToken);
    await entry(accessToken, p.id, { kind: 'lent', amount: 50 });
    expect((await request(app).delete(`/api/v1/people/${p.id}`).set(auth(accessToken))).status).toBe(204);
    expect((await request(app).get(`/api/v1/people/${p.id}`).set(auth(accessToken))).status).toBe(404);
    expect(await db.select().from(peopleLedger).where(eq(peopleLedger.userId, user.id))).toHaveLength(0);
    expect((await request(app).delete(`/api/v1/people/${p.id}`).set(auth(accessToken))).status).toBe(404);
  });

  it("never exposes or changes another user's people", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const p = await addPerson(owner.accessToken);
    const e = await entry(owner.accessToken, p.id, { kind: 'lent', amount: 100 });

    expect((await request(app).get('/api/v1/people').set(auth(other.accessToken))).body.people).toHaveLength(0);
    expect((await request(app).get(`/api/v1/people/${p.id}`).set(auth(other.accessToken))).status).toBe(404);
    expect((await request(app).patch(`/api/v1/people/${p.id}`).set(auth(other.accessToken)).send({ name: 'Mine' })).status).toBe(404);
    expect((await entry(other.accessToken, p.id, { kind: 'lent', amount: 1 })).status).toBe(404);
    expect((await request(app).delete(`/api/v1/people/${p.id}/entries/${e.body.entry.id}`).set(auth(other.accessToken))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/people/${p.id}`).set(auth(other.accessToken))).status).toBe(404);
    expect((await detail(owner.accessToken, p.id)).person.balance).toBe(100);
  });

  it('rejects a non-numeric id', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).get('/api/v1/people/abc').set(auth(accessToken))).status).toBe(400);
  });
});
