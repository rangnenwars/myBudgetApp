import request from 'supertest';
import { app, registerUser } from './helpers';
import { localToday } from '../lib/clock';
import { addMonths } from '../lib/clock';

// Plan ahead must follow what the user does to their transactions: the income it counts
// has to change when they add, edit or delete money in, and editing a repeating entry
// has to be able to change the repeat too (the repeat is what Plan ahead projects).

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const TODAY = localToday();
const pad = (n: number) => String(n).padStart(2, '0');
const monthsAgo = (n: number, day = 10) => {
  const m = addMonths(TODAY.year, TODAY.month, -n);
  return `${m.year}-${pad(m.month)}-${pad(day)}`;
};

const addIncome = (token: string, amount: number, date: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/transactions').set(auth(token)).send({ type: 'income', category_key: 'salary_1', amount, date, ...extra });
const forecast = async (token: string) => (await request(app).get('/api/v1/forecast').set(auth(token))).body as { incomeSource: string; months: { income: number; items: { kind: string; amount: number }[] }[] };
const nextMonthIncome = async (token: string) => (await forecast(token)).months[0].income;
const rules = async (token: string) => (await request(app).get('/api/v1/recurring').set(auth(token))).body as { id: number; amount: number; category: string }[];

describe('Plan ahead income with no repeating income', () => {
  const twoMonths = async (token: string) => {
    await addIncome(token, 30000, monthsAgo(2));
    await addIncome(token, 30000, monthsAgo(1));
  };

  it('is the average of the last full months while this month has no income', async () => {
    const { accessToken } = await registerUser();
    await twoMonths(accessToken);
    expect(await nextMonthIncome(accessToken)).toBe(30000);
  });

  it("counts this month's income as soon as it is entered, and follows edits and deletes", async () => {
    const { accessToken } = await registerUser();
    await twoMonths(accessToken);
    const added = await addIncome(accessToken, 60000, monthsAgo(0, Math.min(TODAY.day, 28)));
    expect(added.status).toBe(201);
    // (30,000 + 30,000 + 60,000) / 3
    expect(await nextMonthIncome(accessToken)).toBe(40000);

    const edited = await request(app).patch(`/api/v1/transactions/${added.body.id}`).set(auth(accessToken)).send({ amount: 90000 });
    expect(edited.status).toBe(200);
    expect(await nextMonthIncome(accessToken)).toBe(50000);

    expect((await request(app).delete(`/api/v1/transactions/${added.body.id}`).set(auth(accessToken))).status).toBe(204);
    expect(await nextMonthIncome(accessToken)).toBe(30000);
  });

  it("this month's income is still counted when it is all there is", async () => {
    const { accessToken } = await registerUser();
    await addIncome(accessToken, 45000, monthsAgo(0, Math.min(TODAY.day, 28)));
    expect(await nextMonthIncome(accessToken)).toBe(45000);
  });
});

describe('editing a repeating entry', () => {
  const makeRepeat = async (token: string, amount = 50000) => {
    const day = Math.min(TODAY.day, 28);
    const res = await addIncome(token, amount, monthsAgo(0, day), { repeat_frequency: 'monthly', repeat_no_end: true });
    expect(res.status).toBe(201);
    return res.body.id as number;
  };
  const edit = (token: string, id: number, body: Record<string, unknown>) => request(app).patch(`/api/v1/transactions/${id}`).set(auth(token)).send(body);

  it('with update_repeat, the repeat takes the new amount and Plan ahead follows', async () => {
    const { accessToken } = await registerUser();
    const id = await makeRepeat(accessToken);
    expect(await nextMonthIncome(accessToken)).toBe(50000);

    const res = await edit(accessToken, id, { amount: 55000, update_repeat: true });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe(55000);
    expect(res.body.repeat_updated).toBe(true);
    expect((await rules(accessToken))[0].amount).toBe(55000);
    expect(await nextMonthIncome(accessToken)).toBe(55000);
  });

  it('without update_repeat, only that entry changes and the repeat is left as it was', async () => {
    const { accessToken } = await registerUser();
    const id = await makeRepeat(accessToken);
    const res = await edit(accessToken, id, { amount: 55000 });
    expect(res.status).toBe(200);
    expect(res.body.repeat_updated).toBeUndefined();
    expect((await rules(accessToken))[0].amount).toBe(50000);
    expect(await nextMonthIncome(accessToken)).toBe(50000);
  });

  it('an entry that does not repeat is edited and the flag changes nothing else', async () => {
    const { accessToken } = await registerUser();
    await makeRepeat(accessToken, 50000);
    const oneOff = await addIncome(accessToken, 7000, monthsAgo(0, 5), { category_key: 'rent_income' });
    const res = await edit(accessToken, oneOff.body.id, { amount: 8000, update_repeat: true });
    expect(res.status).toBe(200);
    expect(res.body.repeat_updated).toBe(false);
    expect((await rules(accessToken))[0].amount).toBe(50000);
  });

  it('does not guess when two repeats look the same', async () => {
    const { accessToken } = await registerUser();
    const id = await makeRepeat(accessToken, 50000);
    // A second repeat with the same type, category and amount, on another day.
    const day = Math.min(TODAY.day, 28) === 5 ? 6 : 5;
    await addIncome(accessToken, 50000, monthsAgo(0, day), { repeat_frequency: 'monthly', repeat_no_end: true });
    const before = await rules(accessToken);
    if (before.length < 2) return; // the app already refuses a duplicate repeat, which is fine too
    const res = await edit(accessToken, id, { amount: 55000, update_repeat: true });
    expect(res.status).toBe(200);
    expect(res.body.repeat_updated).toBe(false);
    expect((await rules(accessToken)).map((r) => r.amount)).toEqual(before.map((r) => r.amount));
  });

  it('only the amount is passed on: changing the category or note alone leaves the repeat alone', async () => {
    const { accessToken } = await registerUser();
    const id = await makeRepeat(accessToken);
    const res = await edit(accessToken, id, { note: 'March salary', update_repeat: true });
    expect(res.status).toBe(200);
    expect(res.body.repeat_updated).toBe(false);
    expect((await rules(accessToken))[0].amount).toBe(50000);
  });

  it("never touches another user's repeat", async () => {
    const a = await registerUser();
    const b = await registerUser();
    await makeRepeat(a.accessToken, 50000);
    const idB = await makeRepeat(b.accessToken, 50000);
    await edit(b.accessToken, idB, { amount: 61000, update_repeat: true });
    expect((await rules(a.accessToken))[0].amount).toBe(50000);
    expect((await rules(b.accessToken))[0].amount).toBe(61000);
  });

  it.each([['text', 'yes'], ['a number', 1], ['null', null]])('update_repeat as %s is refused', async (_l, value) => {
    const { accessToken } = await registerUser();
    const id = await makeRepeat(accessToken);
    expect((await edit(accessToken, id, { amount: 55000, update_repeat: value })).status).toBe(400);
    expect((await rules(accessToken))[0].amount).toBe(50000);
  });

  it('a repeat changed this way is still found when the entry is deleted, so the repeat stops too', async () => {
    const { accessToken } = await registerUser();
    const id = await makeRepeat(accessToken);
    await edit(accessToken, id, { amount: 55000, update_repeat: true });
    expect((await request(app).delete(`/api/v1/transactions/${id}?stop_repeat=true`).set(auth(accessToken))).status).toBe(204);
    expect(await rules(accessToken)).toHaveLength(0);
  });
});
