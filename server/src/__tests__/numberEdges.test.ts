import request from 'supertest';
import { app, registerUser } from './helpers';
import { localToday } from '../lib/clock';

// Money maths at the edges: bounds, rounding to paise, sums that must not drift,
// shares that must add back to the total, and balances that must land on exactly zero.
// Everything is compared in whole paise so a stray 0.30000000000000004 fails loudly.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const TODAY = localToday().iso;
const MONTH = Number(TODAY.slice(5, 7));
const YEAR = Number(TODAY.slice(0, 4));
const paise = (n: number) => Math.round(n * 100);
const isTwoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const addTxn = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/transactions').set(auth(token)).send({ type: 'expense', category_key: 'groceries_milk', date: TODAY, ...body });

const monthSummary = async (token: string) =>
  (await request(app).get('/api/v1/reports/summary').query({ startMonth: MONTH, startYear: YEAR, endMonth: MONTH, endYear: YEAR }).set(auth(token))).body as {
    totalIncome: number;
    totalExpense: number;
  };

describe('amount bounds on a transaction', () => {
  it.each([
    ['zero', 0],
    ['negative', -5],
    ['a tiny negative', -0.01],
    ['text', 'abc'],
    ['empty text', ''],
    ['null', null],
    ['Infinity as text', 'Infinity'],
    ['one paise over the maximum', 10_000_000_000],
    ['far over the maximum', 1e15],
  ])('rejects %s', async (_label, amount) => {
    const { accessToken } = await registerUser();
    const res = await addTxn(accessToken, { amount });
    expect(res.status).toBe(400);
    expect((await request(app).get('/api/v1/transactions').set(auth(accessToken))).body).toHaveLength(0);
  });

  it.each([
    ['one paise', 0.01],
    ['a whole rupee', 1],
    ['the largest allowed', 9_999_999_999.99],
  ])('accepts %s and stores it exactly', async (_label, amount) => {
    const { accessToken } = await registerUser();
    const res = await addTxn(accessToken, { amount });
    expect(res.status).toBe(201);
    expect(paise(res.body.amount)).toBe(paise(amount));
  });

  it('keeps no more than paise when given a fraction of a paisa', async () => {
    const { accessToken } = await registerUser();
    const res = await addTxn(accessToken, { amount: 10.005 });
    expect(res.status).toBe(201);
    expect(isTwoDecimals(res.body.amount)).toBe(true);
    expect(Math.abs(res.body.amount - 10.005)).toBeLessThan(0.0051);
  });

  it('accepts an amount sent as text digits (the app sends numbers, other clients may not)', async () => {
    const { accessToken } = await registerUser();
    const res = await addTxn(accessToken, { amount: '250.50' });
    expect(res.status).toBe(201);
    expect(res.body.amount).toBe(250.5);
  });
});

describe('totals do not drift', () => {
  it('thirty entries of 0.10 add up to exactly 3.00', async () => {
    const { accessToken } = await registerUser();
    for (let i = 0; i < 30; i++) expect((await addTxn(accessToken, { amount: 0.1 })).status).toBe(201);
    expect(paise((await monthSummary(accessToken)).totalExpense)).toBe(300);
  });

  it('mixed awkward amounts add up to the paise', async () => {
    const { accessToken } = await registerUser();
    const amounts = [0.1, 0.2, 0.3, 19.99, 0.01, 1234.56, 7.07, 3333.33];
    for (const amount of amounts) await addTxn(accessToken, { amount });
    expect((await addTxn(accessToken, { amount: 5000.25, type: 'income', category_key: 'salary_1' })).status).toBe(201);
    const expected = amounts.reduce((sum, a) => sum + paise(a), 0);
    const summary = await monthSummary(accessToken);
    expect(paise(summary.totalExpense)).toBe(expected);
    expect(paise(summary.totalIncome)).toBe(500025);
  });

  it('editing an amount changes the total by exactly the difference', async () => {
    const { accessToken } = await registerUser();
    const a = await addTxn(accessToken, { amount: 100.1 });
    await addTxn(accessToken, { amount: 200.2 });
    const patched = await request(app).patch(`/api/v1/transactions/${a.body.id}`).set(auth(accessToken)).send({ amount: 100.11, type: 'expense', category_key: 'groceries_milk', date: TODAY });
    expect(patched.status).toBe(200);
    expect(paise((await monthSummary(accessToken)).totalExpense)).toBe(30031);
  });

  it('deleting every entry brings the total back to exactly zero', async () => {
    const { accessToken } = await registerUser();
    const ids: number[] = [];
    for (const amount of [0.1, 0.2, 0.7]) ids.push((await addTxn(accessToken, { amount })).body.id);
    for (const id of ids) expect((await request(app).delete(`/api/v1/transactions/${id}`).set(auth(accessToken))).status).toBe(204);
    expect((await monthSummary(accessToken)).totalExpense).toBe(0);
  });
});

describe('splitting a bill between categories', () => {
  const split = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/transactions/split').set(auth(token)).send({ type: 'expense', date: TODAY, ...body });

  it('accepts lines that add up to the total to the paise', async () => {
    const { accessToken } = await registerUser();
    const res = await split(accessToken, {
      total: 100,
      lines: [
        { category_key: 'groceries_milk', amount: 33.33 },
        { category_key: 'internet', amount: 33.33 },
        { category_key: 'fuel_petrol', amount: 33.34 },
      ],
    });
    expect(res.status).toBe(201);
    expect(paise((await monthSummary(accessToken)).totalExpense)).toBe(10000);
  });

  it.each([
    ['one paise short', 99.99],
    ['one paise over', 100.01],
    ['half', 50],
    ['double', 200],
  ])('refuses lines that are %s of the total, and saves nothing', async (_label, lineTotal) => {
    const { accessToken } = await registerUser();
    const res = await split(accessToken, {
      total: 100,
      lines: [
        { category_key: 'groceries_milk', amount: lineTotal - 10 },
        { category_key: 'internet', amount: 10 },
      ],
    });
    expect(res.status).toBe(400);
    expect((await monthSummary(accessToken)).totalExpense).toBe(0);
  });
});

describe('splitting a bill with people', () => {
  const addPerson = async (token: string, name: string) => (await request(app).post('/api/v1/people').set(auth(token)).send({ name })).body as { id: number };
  const splitWith = (token: string, body: Record<string, unknown>) =>
    request(app).post('/api/v1/transactions/split-people').set(auth(token)).send({ date: TODAY, category_key: 'lunch_dinner', method: 'equal', ...body });

  it.each([
    [100, 2],
    [100, 3],
    [0.05, 3],
    [1000.01, 7],
    [99999.99, 13],
  ])('an equal split of %s between you and %s friends adds back to the total', async (total, friends) => {
    const { accessToken } = await registerUser();
    const people: { person_id: number }[] = [];
    for (let i = 0; i < friends; i++) people.push({ person_id: (await addPerson(accessToken, `Friend ${i}`)).id });
    const res = await splitWith(accessToken, { total, people });
    expect(res.status).toBe(201);
    const shares = (res.body.shares as { amount: number }[]).reduce((sum, s) => sum + paise(s.amount), 0);
    expect(shares + paise(res.body.myShare)).toBe(paise(total));
    for (const s of res.body.shares as { amount: number }[]) expect(isTwoDecimals(s.amount)).toBe(true);
  });

  it('refuses a bill too small to give everyone a paisa, and saves nothing', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    const b = await addPerson(accessToken, 'B');
    const res = await splitWith(accessToken, { total: 0.01, people: [{ person_id: a.id }, { person_id: b.id }] });
    expect(res.status).toBe(400);
    expect((await monthSummary(accessToken)).totalExpense).toBe(0);
  });

  it('a custom split must not give friends more than the bill', async () => {
    const { accessToken } = await registerUser();
    const a = await addPerson(accessToken, 'A');
    const b = await addPerson(accessToken, 'B');
    const res = await splitWith(accessToken, { total: 100, method: 'custom', people: [{ person_id: a.id, amount: 60 }, { person_id: b.id, amount: 40.01 }] });
    expect(res.status).toBe(400);
    expect((await monthSummary(accessToken)).totalExpense).toBe(0);
  });
});

describe('a loan paid down in EMIs', () => {
  const createLoan = async (token: string, body: Record<string, unknown>) =>
    (await request(app).post('/api/v1/loans').set(auth(token)).send({ name: 'Bike', principal: 1000, outstanding: 1000, emi: 333.33, counts_as_expense: false, ...body })).body as {
      id: number;
      outstanding: number;
      emi: number;
    };
  const payEmi = (token: string, id: number) => request(app).post(`/api/v1/loans/${id}/pay-emi`).set(auth(token)).send({ date: TODAY });
  const partPay = (token: string, id: number, amount: number) => request(app).post(`/api/v1/loans/${id}/part-payment`).set(auth(token)).send({ date: TODAY, amount });

  it('ends on exactly zero, with a smaller last payment, and then refuses more', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, {});
    const balances: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await payEmi(accessToken, loan.id);
      expect(res.status).toBe(201);
      balances.push(res.body.loan.outstanding);
    }
    expect(balances.map(paise)).toEqual([66667, 33334, 1, 0]);
    expect(balances[3]).toBe(0);
    expect((await payEmi(accessToken, loan.id)).status).toBe(400);
  });

  it('the payments listed add up to what was borrowed', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, {});
    for (let i = 0; i < 4; i++) await payEmi(accessToken, loan.id);
    const list = await request(app).get(`/api/v1/loans/${loan.id}/payments`).set(auth(accessToken));
    expect(list.status).toBe(200);
    const paid = (list.body as { amount: number }[]).reduce((sum, p) => sum + paise(p.amount), 0);
    expect(paid).toBe(100000);
  });

  it.each([
    ['zero', 0],
    ['negative', -100],
    ['more than is owed', 1000.01],
  ])('refuses a part payment of %s and leaves the balance alone', async (_label, amount) => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, {});
    expect((await partPay(accessToken, loan.id, amount)).status).toBe(400);
    const loans = await request(app).get('/api/v1/loans').set(auth(accessToken));
    expect(loans.body[0].outstanding).toBe(1000);
  });

  it('a part payment of one paise lowers the balance by one paise', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, {});
    const res = await partPay(accessToken, loan.id, 0.01);
    expect(res.status).toBe(201);
    expect(paise(res.body.loan.outstanding)).toBe(99999);
  });

  it('a part payment equal to the balance closes the loan on exactly zero', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, {});
    const res = await partPay(accessToken, loan.id, 1000);
    expect(res.status).toBe(201);
    expect(res.body.loan.outstanding).toBe(0);
    expect(res.body.loan.emi).toBe(333.33);
  });

  it('a part payment keeps the number of remaining EMIs the same', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, { principal: 1200, outstanding: 1200, emi: 100 });
    const res = await partPay(accessToken, loan.id, 600);
    expect(res.status).toBe(201);
    expect(res.body.loan.outstanding).toBe(600);
    expect(res.body.loan.emi).toBe(50);
  });

  it.each([
    ['interest of 100% or more', { interest_rate: 100 }],
    ['negative interest', { interest_rate: -1 }],
    ['zero EMI', { emi: 0 }],
    ['negative balance', { outstanding: -1 }],
    ['zero principal', { principal: 0 }],
    ['a tenure of 0 months', { tenure_months: 0 }],
    ['a tenure over 600 months', { tenure_months: 601 }],
    ['a fractional tenure', { tenure_months: 12.5 }],
  ])('refuses to create a loan with %s', async (_label, patch) => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Bad', principal: 1000, outstanding: 1000, emi: 100, ...patch });
    expect(res.status).toBe(400);
    expect((await request(app).get('/api/v1/loans').set(auth(accessToken))).body).toHaveLength(0);
  });
});

describe('savings goals', () => {
  const createGoal = async (token: string, body: Record<string, unknown> = {}) =>
    (await request(app).post('/api/v1/goals').set(auth(token)).send({ name: 'Trip', target_amount: 1000, ...body })).body as { id: number };
  const contribute = (token: string, id: number, amount: number, type: 'add' | 'remove') =>
    request(app).post(`/api/v1/goals/${id}/contributions`).set(auth(token)).send({ amount, type });
  const saved = async (token: string, id: number) => ((await request(app).get('/api/v1/goals').set(auth(token))).body as { id: number; saved_amount: number }[]).find((g) => g.id === id)!.saved_amount;

  it('three additions of 0.10 make exactly 0.30', async () => {
    const { accessToken } = await registerUser();
    const goal = await createGoal(accessToken);
    for (let i = 0; i < 3; i++) expect((await contribute(accessToken, goal.id, 0.1, 'add')).status).toBe(201);
    expect(paise(await saved(accessToken, goal.id))).toBe(30);
  });

  it('refuses to take out more than is saved, and leaves the balance alone', async () => {
    const { accessToken } = await registerUser();
    const goal = await createGoal(accessToken);
    await contribute(accessToken, goal.id, 100, 'add');
    expect((await contribute(accessToken, goal.id, 100.01, 'remove')).status).toBe(400);
    expect(await saved(accessToken, goal.id)).toBe(100);
  });

  it('taking out exactly what is saved leaves exactly zero', async () => {
    const { accessToken } = await registerUser();
    const goal = await createGoal(accessToken);
    await contribute(accessToken, goal.id, 33.33, 'add');
    await contribute(accessToken, goal.id, 66.67, 'add');
    expect((await contribute(accessToken, goal.id, 100, 'remove')).status).toBe(201);
    expect(await saved(accessToken, goal.id)).toBe(0);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['text', 'ten'],
  ])('refuses a contribution of %s', async (_label, amount) => {
    const { accessToken } = await registerUser();
    const goal = await createGoal(accessToken);
    expect((await request(app).post(`/api/v1/goals/${goal.id}/contributions`).set(auth(accessToken)).send({ amount, type: 'add' })).status).toBe(400);
    expect(await saved(accessToken, goal.id)).toBe(0);
  });

  it('refuses a target of zero or less', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'X', target_amount: 0 })).status).toBe(400);
    expect((await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'X', target_amount: -10 })).status).toBe(400);
  });
});

describe('what you are owed by people', () => {
  const addPerson = async (token: string, name = 'Rahul') => (await request(app).post('/api/v1/people').set(auth(token)).send({ name })).body as { id: number };
  const entry = (token: string, id: number, body: Record<string, unknown>) => request(app).post(`/api/v1/people/${id}/entries`).set(auth(token)).send({ date: TODAY, ...body });
  const balanceOf = async (token: string, id: number) => (await request(app).get(`/api/v1/people/${id}`).set(auth(token))).body.person.balance as number;

  it('lending 0.10 and 0.20 gives exactly 0.30, and getting 0.30 back gives exactly zero', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    await entry(accessToken, p.id, { kind: 'lent', amount: 0.1 });
    await entry(accessToken, p.id, { kind: 'lent', amount: 0.2 });
    expect(await balanceOf(accessToken, p.id)).toBe(0.3);
    expect((await entry(accessToken, p.id, { kind: 'received', amount: 0.3 })).status).toBe(201);
    expect(await balanceOf(accessToken, p.id)).toBe(0);
  });

  it('many small amounts still add up to the paise', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    for (let i = 0; i < 25; i++) await entry(accessToken, p.id, { kind: 'lent', amount: 0.07 });
    expect(paise(await balanceOf(accessToken, p.id))).toBe(175);
  });

  it('getting back one paise more than you lent is refused', async () => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    await entry(accessToken, p.id, { kind: 'lent', amount: 100 });
    expect((await entry(accessToken, p.id, { kind: 'received', amount: 100.01 })).status).toBe(400);
    expect(await balanceOf(accessToken, p.id)).toBe(100);
  });

  it.each([
    ['zero', 0],
    ['negative', -50],
    ['text', 'fifty'],
    ['above the maximum', 10_000_000_000],
  ])('an entry of %s is refused', async (_label, amount) => {
    const { accessToken } = await registerUser();
    const p = await addPerson(accessToken);
    expect((await entry(accessToken, p.id, { kind: 'lent', amount })).status).toBe(400);
    expect(await balanceOf(accessToken, p.id)).toBe(0);
  });
});

describe('budgets', () => {
  const setLimit = (token: string, category: string, monthly_limit: number) => request(app).put(`/api/v1/budgets/${category}`).set(auth(token)).send({ monthly_limit });
  const status = async (token: string) =>
    ((await request(app).get('/api/v1/budgets').query({ month: MONTH, year: YEAR }).set(auth(token))).body as { category: string; ratio: number; status: string; spent: number }[]).find((b) => b.category === 'internet')!;

  it('moves from ok to warning to over as spending grows, never backwards', async () => {
    const { accessToken } = await registerUser();
    await setLimit(accessToken, 'internet', 1000);
    const order = ['ok', 'warning', 'over'];
    let last = -1;
    for (const spend of [100, 700, 99.99, 100.01, 99.99, 400, 0.01]) {
      await addTxn(accessToken, { amount: spend, category_key: 'internet' });
      const s = await status(accessToken);
      const rank = order.indexOf(s.status);
      expect(rank).toBeGreaterThanOrEqual(last);
      last = rank;
    }
    expect(last).toBe(2);
  });

  it('reaching the limit counts as over, and 80 percent is the warning line', async () => {
    const { accessToken } = await registerUser();
    await setLimit(accessToken, 'internet', 1000);
    await addTxn(accessToken, { amount: 1000, category_key: 'internet' });
    const onLimit = await status(accessToken);
    expect(onLimit.ratio).toBe(1);
    expect(onLimit.status).toBe('over');
    const other = await registerUser();
    await setLimit(other.accessToken, 'internet', 1000);
    await addTxn(other.accessToken, { amount: 799.99, category_key: 'internet' });
    expect((await status(other.accessToken)).status).toBe('ok');
    await addTxn(other.accessToken, { amount: 0.01, category_key: 'internet' });
    expect((await status(other.accessToken)).status).toBe('warning');
  });

  it('spending nothing is ok at ratio zero', async () => {
    const { accessToken } = await registerUser();
    await setLimit(accessToken, 'internet', 1000);
    const s = await status(accessToken);
    expect(s).toMatchObject({ spent: 0, ratio: 0, status: 'ok' });
  });

  it.each([0, -100, 'lots', 10_000_000_000])('refuses a limit of %s', async (limit) => {
    const { accessToken } = await registerUser();
    expect((await request(app).put('/api/v1/budgets/internet').set(auth(accessToken)).send({ monthly_limit: limit })).status).toBe(400);
  });

  it.each([0, -1, 'x'])('refuses an overall monthly budget of %s', async (amount) => {
    const { accessToken } = await registerUser();
    expect((await request(app).put('/api/v1/budgets/overall').set(auth(accessToken)).send({ amount })).status).toBe(400);
  });
});

describe('accounts and investments', () => {
  it('an account balance can be negative (a credit card) but only within the limit', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Card', type: 'credit_card', balance: -2500.5 })).status).toBe(201);
    expect((await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Card 2', type: 'credit_card', balance: -1e13 })).status).toBe(400);
    expect((await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Bank', type: 'bank', balance: 'lots' })).status).toBe(400);
  });

  it('an investment can be worth zero but not less', async () => {
    const { accessToken } = await registerUser();
    const body = { name: 'Fund', type: 'mutual_fund', amount: 1000 };
    expect((await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ ...body, current_value: 0 })).status).toBe(201);
    expect((await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ ...body, current_value: -0.01 })).status).toBe(400);
    expect((await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ ...body, amount: 0 })).status).toBe(400);
  });
});

describe('free-money day with unusual numbers', () => {
  const freeMoney = (token: string) => request(app).get('/api/v1/reports/free-money-day').set(auth(token));

  it('does not blow up with no income at all', async () => {
    const { accessToken } = await registerUser();
    const res = await freeMoney(accessToken);
    expect(res.status).toBe(200);
  });

  it('does not return NaN or Infinity when income is tiny against large bills', async () => {
    const { accessToken } = await registerUser();
    expect((await addTxn(accessToken, { amount: 0.01, type: 'income', category_key: 'salary_1' })).status).toBe(201);
    const res = await freeMoney(accessToken);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/NaN|Infinity/);
  });
});
