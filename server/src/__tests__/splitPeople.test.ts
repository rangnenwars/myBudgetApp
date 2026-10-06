import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { peopleLedger } from '../db/schema';
import { localToday } from '../lib/clock';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const TODAY = localToday().iso;

const addPerson = async (token: string, name: string) =>
  (await request(app).post('/api/v1/people').set(auth(token)).send({ name })).body as { id: number };

const splitWith = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/transactions/split-people')
    .set(auth(token))
    .send({ date: TODAY, category_key: 'lunch_dinner', total: 1800, method: 'equal', ...body });

const balance = async (token: string, id: number) => (await request(app).get(`/api/v1/people/${id}`).set(auth(token))).body.person.balance as number;
const txns = async (token: string) => (await request(app).get('/api/v1/transactions').set(auth(token))).body as { amount: number; category: string; note: string | null }[];

describe('POST /transactions/split-people', () => {
  it('requires authentication', async () => {
    expect((await request(app).post('/api/v1/transactions/split-people').send({})).status).toBe(401);
  });

  it('splits equally: your share is the spending, each friend owes theirs', async () => {
    const { accessToken } = await registerUser();
    const rahul = await addPerson(accessToken, 'Rahul');
    const priya = await addPerson(accessToken, 'Priya');

    const res = await splitWith(accessToken, { note: 'Dinner', people: [{ person_id: rahul.id }, { person_id: priya.id }] });
    expect(res.status).toBe(201);
    expect(res.body.myShare).toBe(600);
    expect(res.body.transaction).toMatchObject({ amount: 600, category: 'lunch_dinner', type: 'expense', note: 'Dinner' });
    expect(res.body.shares).toEqual([
      { personId: rahul.id, name: 'Rahul', amount: 600 },
      { personId: priya.id, name: 'Priya', amount: 600 },
    ]);

    expect(await balance(accessToken, rahul.id)).toBe(600);
    expect(await balance(accessToken, priya.id)).toBe(600);
    const rows = await txns(accessToken);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(600);

    const summary = await request(app)
      .get('/api/v1/reports/summary')
      .query({ startMonth: Number(TODAY.slice(5, 7)), startYear: Number(TODAY.slice(0, 4)), endMonth: Number(TODAY.slice(5, 7)), endYear: Number(TODAY.slice(0, 4)) })
      .set(auth(accessToken));
    expect(summary.body.totalExpense).toBe(600);

    const detail = (await request(app).get(`/api/v1/people/${rahul.id}`).set(auth(accessToken))).body;
    expect(detail.entries[0]).toMatchObject({ kind: 'split_share', amount: 600, note: 'Dinner' });
  });

  it('keeps the leftover paise with you so the parts always add up', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    const b = await addPerson(accessToken, 'B');
    const res = await splitWith(accessToken, { total: 100, people: [{ person_id: a.id }, { person_id: b.id }] });
    expect(res.body.shares.map((s: { amount: number }) => s.amount)).toEqual([33.33, 33.33]);
    expect(res.body.myShare).toBe(33.34);
    expect(33.33 + 33.33 + 33.34).toBeCloseTo(100, 10);
  });

  it('splits with custom amounts, and your share is the rest', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    const b = await addPerson(accessToken, 'B');
    const res = await splitWith(accessToken, { method: 'custom', people: [{ person_id: a.id, amount: 1000 }, { person_id: b.id, amount: 300 }] });
    expect(res.status).toBe(201);
    expect(res.body.myShare).toBe(500);
    expect(await balance(accessToken, a.id)).toBe(1000);
    expect(await balance(accessToken, b.id)).toBe(300);
  });

  it('records no spending when friends cover the whole bill, but still tracks what they owe', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    const res = await splitWith(accessToken, { method: 'custom', total: 500, people: [{ person_id: a.id, amount: 500 }] });
    expect(res.status).toBe(201);
    expect(res.body.transaction).toBeNull();
    expect(res.body.myShare).toBe(0);
    expect(await txns(accessToken)).toHaveLength(0);
    expect(await balance(accessToken, a.id)).toBe(500);
  });

  it('adds to what a person already owes', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    await request(app).post(`/api/v1/people/${a.id}/entries`).set(auth(accessToken)).send({ kind: 'lent', amount: 400 });
    await splitWith(accessToken, { total: 200, people: [{ person_id: a.id }] });
    expect(await balance(accessToken, a.id)).toBe(500);
  });

  it('rejects shares bigger than the total, missing custom amounts, duplicates and empty lists', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    const b = await addPerson(accessToken, 'B');
    const over = await splitWith(accessToken, { method: 'custom', total: 100, people: [{ person_id: a.id, amount: 70 }, { person_id: b.id, amount: 50 }] });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/more than the total/);
    expect((await splitWith(accessToken, { method: 'custom', people: [{ person_id: a.id }] })).status).toBe(400);
    expect((await splitWith(accessToken, { people: [{ person_id: a.id }, { person_id: a.id }] })).status).toBe(400);
    expect((await splitWith(accessToken, { people: [] })).status).toBe(400);
    expect((await splitWith(accessToken, { total: 0.01, people: [{ person_id: a.id }, { person_id: b.id }] })).status).toBe(400);
    expect(await txns(accessToken)).toHaveLength(0);
    expect(await balance(accessToken, a.id)).toBe(0);
  });

  it("saves nothing when a person isn't the caller's, or the category is wrong", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const mine = await addPerson(owner.accessToken, 'Mine');
    const theirs = await addPerson(other.accessToken, 'Theirs');

    const stranger = await splitWith(owner.accessToken, { people: [{ person_id: mine.id }, { person_id: theirs.id }] });
    expect(stranger.status).toBe(404);
    expect(await txns(owner.accessToken)).toHaveLength(0);
    expect(await balance(owner.accessToken, mine.id)).toBe(0);
    expect(await db.select().from(peopleLedger).where(eq(peopleLedger.userId, owner.user.id))).toHaveLength(0);

    expect((await splitWith(owner.accessToken, { category_key: 'salary_1', people: [{ person_id: mine.id }] })).status).toBe(400);
    expect((await splitWith(owner.accessToken, { category_key: 'no_such', people: [{ person_id: mine.id }] })).status).toBe(400);
    expect((await splitWith(owner.accessToken, { date: '2026-02-30', people: [{ person_id: mine.id }] })).status).toBe(400);
  });

  it("keeps the friends' lines when the user's own entry is deleted", async () => {
    const { accessToken, user } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    const res = await splitWith(accessToken, { total: 300, people: [{ person_id: a.id }] });
    await request(app).delete(`/api/v1/transactions/${res.body.transaction.id}`).set(auth(accessToken));
    expect(await balance(accessToken, a.id)).toBe(150);
    const lines = await db.select().from(peopleLedger).where(eq(peopleLedger.userId, user.id));
    expect(lines[0].transactionId).toBeNull();
  });

  it('lets a friend settle a split share like any other debt', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    await splitWith(accessToken, { total: 600, people: [{ person_id: a.id }] });
    const paid = await request(app).post(`/api/v1/people/${a.id}/entries`).set(auth(accessToken)).send({ kind: 'received', amount: 300 });
    expect(paid.body.person.balance).toBe(0);
  });
});
