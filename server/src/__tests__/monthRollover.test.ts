import request from 'supertest';
import { app, registerUser, RegisteredUser } from './helpers';
import { computeCategoryDeltas, computeSavingsRate } from '../calculations';

// One user followed across real month and year boundaries with the clock
// moved by hand (only Date is faked, so the database and HTTP work as usual).
// Repeating entries and loan EMIs post lazily when the user's data is read, so
// each step moves "today" and then reads, like opening the app on that day.
// Checks that posting, the monthly totals, the free-money day and Plan ahead
// all agree as October ends, November runs, and the app sits unopened over December.
//
// The story (all amounts in rupees, UTC clock as in every test):
//   salary 60,000 on the 1st (first entry 1 Sep) · rent 8,000 on the 2nd (from 2 Aug)
//   gym 500 on the 31st (from 31 Aug, so it falls back to the 30th in short months)
//   insurance 12,000 yearly on 15 Aug · a 10,000 loan with a 4,000 EMI, no interest
//   groceries 900 (20 Aug, the user's first entry), 600 (10 Sep), 1,000 (10 Oct)

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const at = (iso: string) => jest.setSystemTime(new Date(`${iso}T12:00:00Z`));
// Fakes only Date: timers and the event loop stay real, so the database and HTTP keep working.
const freezeDateAt = (iso: string) =>
  jest.useFakeTimers({
    now: new Date(`${iso}T12:00:00Z`),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });

type Point = { month: number; year: number; income: number; expense: number };

describe('month and year rollover for one user', () => {
  let user: RegisteredUser;
  let token: string;

  // A fresh token for the faked day: access tokens last 15 minutes.
  const signInAt = async (iso: string) => {
    at(iso);
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.user.email, password: 'password123' }).expect(200);
    token = res.body.accessToken;
  };

  const series = async (from: [number, number], to: [number, number]): Promise<Point[]> =>
    (await request(app).get('/api/v1/reports/monthly-series').query({ startMonth: from[1], startYear: from[0], endMonth: to[1], endYear: to[0] }).set(auth(token)).expect(200)).body;
  const month = async (year: number, m: number) => (await series([year, m], [year, m]))[0];
  const add = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/transactions').set(auth(token)).send({ repeat_no_end: true, ...body });

  beforeAll(async () => {
    freezeDateAt('2026-10-31');
    user = await registerUser();
    token = user.accessToken;

    await add({ amount: 900, type: 'expense', category_key: 'groceries_milk', date: '2026-08-20', repeat_frequency: undefined, repeat_no_end: undefined }).expect(201);
    await add({ amount: 12000, type: 'expense', category_key: 'life_insurance', date: '2026-08-15', repeat_frequency: 'yearly', note: 'Insurance' }).expect(201);
    await add({ amount: 8000, type: 'expense', category_key: 'property_tax', date: '2026-08-02', repeat_frequency: 'monthly', note: 'Rent' }).expect(201);
    await add({ amount: 500, type: 'expense', category_key: 'entertainment', date: '2026-08-31', repeat_frequency: 'monthly', note: 'Gym' }).expect(201);
    await add({ amount: 60000, type: 'income', category_key: 'salary_1', date: '2026-09-01', repeat_frequency: 'monthly', note: 'Salary' }).expect(201);
    await add({ amount: 600, type: 'expense', category_key: 'groceries_milk', date: '2026-09-10', repeat_frequency: undefined, repeat_no_end: undefined }).expect(201);
    await add({ amount: 1000, type: 'expense', category_key: 'groceries_milk', date: '2026-10-10', repeat_frequency: undefined, repeat_no_end: undefined }).expect(201);
    await request(app).post('/api/v1/loans').set(auth(token)).send({ name: 'Phone loan', principal: 10000, outstanding: 10000, emi: 4000 }).expect(201);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('31 Oct: October holds everything posted since the first entry, and November is still empty', async () => {
    expect(await month(2026, 10)).toMatchObject({ income: 60000, expense: 8000 + 500 + 1000 + 4000 });
    expect(await month(2026, 11)).toMatchObject({ income: 0, expense: 0 });
  });

  it('1 Nov: the 1st-of-month items post, the later ones wait, and October does not move', async () => {
    await signInAt('2026-11-01');
    // Salary (1st) and the loan EMI are due; rent (2nd) and the gym (30th) are not.
    expect(await month(2026, 11)).toMatchObject({ income: 60000, expense: 4000 });
    expect(await month(2026, 10)).toMatchObject({ income: 60000, expense: 13500 });
  });

  it('2 Nov: rent posts, and reading again does not post anything twice', async () => {
    await signInAt('2026-11-02');
    expect(await month(2026, 11)).toMatchObject({ income: 60000, expense: 12000 });
    expect(await month(2026, 11)).toMatchObject({ income: 60000, expense: 12000 });
    const rows = (await request(app).get('/api/v1/transactions').query({ month: 11, year: 2026 }).set(auth(token)).expect(200)).body;
    expect(rows.filter((r: { note: string }) => r.note === 'Rent')).toHaveLength(1);
    expect(rows.filter((r: { category: string }) => r.category === 'loan_emi')).toHaveLength(1);
  });

  it('2 Nov: the free-money day counts the same repeating items as the month does', async () => {
    const res = (await request(app).get('/api/v1/reports/free-money-day').set(auth(token)).expect(200)).body;
    // EMI 4,000 (6,000 still owed) + rent 8,000 + gym 500 + insurance 12,000 / 12.
    expect(res).toMatchObject({ status: 'ok', year: 2026, month: 11, income: 60000, committed: 13500 });
    expect(res.share).toBeCloseTo(0.225, 3);
  });

  it('2 Nov: Plan ahead starts in December and puts each item in its real month', async () => {
    const f = (await request(app).get('/api/v1/forecast').set(auth(token)).expect(200)).body;
    expect(f.months).toHaveLength(12);
    expect(f.months[0]).toMatchObject({ year: 2026, month: 12 });
    expect(f.months[11]).toMatchObject({ year: 2027, month: 11 });
    expect(f.incomeSource).toBe('repeating');

    // Groceries only: rent, gym, insurance and EMIs posted by themselves are left out of "typical".
    // The user's first month (Aug) is skipped, leaving Sep and Oct: (600 + 1,000) / 2.
    expect(f.typical).toMatchObject({ available: true, monthsUsed: 2, perMonth: 800 });
    expect(f.typical.categories).toEqual([expect.objectContaining({ category: 'groceries_milk', amount: 800 })]);

    const byKey = (y: number, m: number) => f.months.find((x: { year: number; month: number }) => x.year === y && x.month === m);
    // Dec: rent 8,000 + gym 500 + EMI 4,000 (the loan then has 2,000 left).
    expect(byKey(2026, 12)).toMatchObject({ income: 60000, fixed: 12500, known: 47500, likely: 46700 });
    // Jan: the last, smaller EMI.
    expect(byKey(2027, 1)).toMatchObject({ fixed: 10500, known: 49500 });
    // Feb: the 31st falls back to 28 Feb, and the loan is paid off.
    const feb = byKey(2027, 2);
    expect(feb.fixed).toBe(8500);
    expect(feb.items.find((i: { label: string }) => i.label === 'Gym').date).toBe('2027-02-28');
    // Aug 2027: the yearly insurance comes due.
    expect(byKey(2027, 8)).toMatchObject({ fixed: 20500, known: 39500 });
    expect(byKey(2027, 8).items.some((i: { label: string }) => i.label === 'Insurance')).toBe(true);
  });

  it('30 Nov: the gym falls back from the 31st to the 30th', async () => {
    await signInAt('2026-11-29');
    expect((await month(2026, 11)).expense).toBe(12000);
    await signInAt('2026-11-30');
    expect(await month(2026, 11)).toMatchObject({ income: 60000, expense: 12500 });
  });

  it('left unopened until 2 Jan: December and January both catch up, across the year boundary', async () => {
    await signInAt('2027-01-02');
    const points = await series([2026, 10], [2027, 1]);
    expect(points.map((p) => [p.year, p.month, p.income, p.expense])).toEqual([
      [2026, 10, 60000, 13500],
      [2026, 11, 60000, 12500],
      // Dec: rent 8,000 + gym 500 (31 Dec) + EMI 4,000.
      [2026, 12, 60000, 12500],
      // Jan so far: rent 8,000 + the final EMI 2,000; the gym is on the 31st.
      [2027, 1, 60000, 10000],
    ]);
  });

  it('Plan ahead after the new year starts in February and no longer includes the loan', async () => {
    const f = (await request(app).get('/api/v1/forecast').set(auth(token)).expect(200)).body;
    expect(f.months[0]).toMatchObject({ year: 2027, month: 2 });
    expect(f.months[11]).toMatchObject({ year: 2028, month: 1 });
    expect(f.months.every((m: { items: { kind: string }[] }) => m.items.every((i) => i.kind !== 'loan'))).toBe(true);
    expect(f.months[0]).toMatchObject({ income: 60000, fixed: 8500, known: 51500 });
  });
});

// Budgets, the budget class and the Home "vs last month" insights across the
// same boundaries. They read other months' totals, so they are where a month
// that has just ended could leak into the one that just began.
//
// The story: salary 60,000 and rent 8,000 repeat; groceries 3,000 (Sep) and 5,000
// (Oct) then 4,000 (Nov); travel 2,000 (Sep); a one-off 90,000 in October;
// a 10,000 loan with a 4,000 EMI; a 5,000 groceries limit and a 20,000 overall budget.
describe('budgets and month-on-month insights across month and year boundaries', () => {
  let user: RegisteredUser;
  let token: string;

  const signInAt = async (iso: string) => {
    at(iso);
    token = (await request(app).post('/api/v1/auth/login').send({ email: user.user.email, password: 'password123' }).expect(200)).body.accessToken;
  };
  const get = async (path: string, query: Record<string, unknown> = {}) => (await request(app).get(path).query(query).set(auth(token)).expect(200)).body;
  const groceryBudget = async (month?: number, year?: number) =>
    (await get('/api/v1/budgets', month ? { month, year } : {})).find((b: { category: string }) => b.category === 'groceries_milk');
  const overall = (month?: number, year?: number) => get('/api/v1/budgets/overall', month ? { month, year } : {});
  const budgetClass = async () => {
    const me = await get('/api/v1/auth/me');
    return me.budgetClass ?? me.user?.budgetClass;
  };
  const entry = (body: Record<string, unknown>) => request(app).post('/api/v1/transactions').set(auth(token)).send(body);
  const expense = (m: number, y: number) => get('/api/v1/reports/category-breakdown', { startMonth: m, startYear: y, endMonth: m, endYear: y, type: 'expense' });
  // What Home does: this month's and last month's category totals through computeCategoryDeltas.
  const deltasFor = async (m: number, y: number) => {
    const prev = m === 1 ? { month: 12, year: y - 1 } : { month: m - 1, year: y };
    const rows = (list: { category: string; total: number }[], mm: number, yy: number) =>
      list.map((c) => ({ type: 'expense' as const, amount: c.total, category: c.category, month: mm, year: yy }));
    return computeCategoryDeltas(rows(await expense(m, y), m, y), rows(await expense(prev.month, prev.year), prev.month, prev.year), 'expense').filter(
      (d) => d.current > 0 || d.previous > 0
    );
  };
  const delta = (list: { category: string }[], category: string) => list.find((d) => d.category === category);

  beforeAll(async () => {
    freezeDateAt('2026-10-31');
    user = await registerUser();
    token = user.accessToken;

    await entry({ amount: 60000, type: 'income', category_key: 'salary_1', date: '2026-09-01', repeat_frequency: 'monthly', repeat_no_end: true, note: 'Salary' }).expect(201);
    await entry({ amount: 8000, type: 'expense', category_key: 'property_tax', date: '2026-09-02', repeat_frequency: 'monthly', repeat_no_end: true, note: 'Rent' }).expect(201);
    await entry({ amount: 3000, type: 'expense', category_key: 'groceries_milk', date: '2026-09-10' }).expect(201);
    await entry({ amount: 2000, type: 'expense', category_key: 'travel', date: '2026-09-12' }).expect(201);
    await entry({ amount: 5000, type: 'expense', category_key: 'groceries_milk', date: '2026-10-10' }).expect(201);
    await entry({ amount: 90000, type: 'expense', category_key: 'misc_expenses', date: '2026-10-15' }).expect(201);
    await request(app).post('/api/v1/loans').set(auth(token)).send({ name: 'Phone loan', principal: 10000, outstanding: 10000, emi: 4000 }).expect(201);
    await request(app).put('/api/v1/budgets/groceries_milk').set(auth(token)).send({ monthly_limit: 5000 }).expect(200);
    await request(app).put('/api/v1/budgets/overall').set(auth(token)).send({ amount: 20000 }).expect(200);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('31 Oct: October is over budget, with a suggestion from September and a middle budget class', async () => {
    expect(await groceryBudget()).toMatchObject({ spent: 5000, ratio: 1, status: 'over' });
    // Day-to-day spending counts (groceries 5,000 + rent 8,000 + the one-off 90,000); the EMI does not.
    expect(await overall()).toMatchObject({ month: 10, year: 2026, spent: 103000, status: 'over', left: -83000, days_left: 1, per_day: 0, suggested: 13000 });
    // Sep 13,000 and Oct 107,000 (with the EMI) average 60,000.
    expect(await budgetClass()).toBe('middle');
  });

  it('1 Nov: November starts from the full budget, and October keeps its own result', async () => {
    await signInAt('2026-11-01');
    expect(await overall()).toMatchObject({ month: 11, spent: 0, left: 20000, ratio: 0, status: 'ok', days_left: 30, per_day: 666 });
    expect(await groceryBudget()).toMatchObject({ spent: 0, ratio: 0, status: 'ok' });
    // Looking back at October still shows what happened then, and a past month has no days left.
    expect(await groceryBudget(10, 2026)).toMatchObject({ spent: 5000, status: 'over' });
    expect(await overall(10, 2026)).toMatchObject({ spent: 103000, status: 'over', days_left: 0 });
  });

  it('6 Nov: spending this month counts only against November, and Home compares it with October', async () => {
    await signInAt('2026-11-06');
    await entry({ amount: 4000, type: 'expense', category_key: 'groceries_milk', date: '2026-11-06' }).expect(201);
    await entry({ amount: 700, type: 'expense', category_key: 'entertainment', date: '2026-11-05' }).expect(201);

    expect(await groceryBudget()).toMatchObject({ spent: 4000, ratio: 0.8, status: 'warning' });
    // Rent (posted on the 2nd) + groceries + entertainment.
    expect(await overall()).toMatchObject({ month: 11, spent: 12700, left: 7300, status: 'ok', days_left: 25, per_day: 292 });

    const deltas = await deltasFor(11, 2026);
    expect(delta(deltas, 'groceries_milk')).toMatchObject({ current: 4000, previous: 5000, deltaPct: -20 });
    expect(delta(deltas, 'property_tax')).toMatchObject({ current: 8000, previous: 8000, deltaPct: 0 });
    expect(delta(deltas, 'loan_emi')).toMatchObject({ current: 4000, previous: 4000, deltaPct: 0 });
    // Nothing last month, so Home says "New this month"; the October one-off is gone from this month.
    expect(delta(deltas, 'entertainment')).toMatchObject({ current: 700, previous: 0, deltaPct: null });
    expect(delta(deltas, 'misc_expenses')).toMatchObject({ current: 0, previous: 90000, deltaPct: -100 });
    // The travel spend of September is two months back, so it is not compared.
    expect(delta(deltas, 'travel')).toBeUndefined();

    const summary = await get('/api/v1/reports/summary', { startMonth: 11, startYear: 2026, endMonth: 11, endYear: 2026 });
    expect(summary).toMatchObject({ totalIncome: 60000, totalExpense: 16700 });
    expect(computeSavingsRate(summary)).toBeCloseTo(72.17, 1);
    expect(await budgetClass()).toBe('middle');
  });

  it('left unopened until 2 Jan: January is a fresh month, and October drops out of the budget class', async () => {
    await signInAt('2027-01-02');
    expect(await groceryBudget()).toMatchObject({ spent: 0, status: 'ok' });
    expect(await overall()).toMatchObject({ month: 1, year: 2027, spent: 8000, left: 12000, ratio: 0.4, status: 'ok', days_left: 30, per_day: 400 });
    // The suggestion averages the last three full months, Oct 103,000 + Nov 12,700 + Dec 8,000, so September has dropped out.
    expect((await overall()).suggested).toBe(41200);
    // The window is now Nov, Dec and Jan (16,700, 12,000 and 10,000), so the big October month no longer counts.
    expect(await budgetClass()).toBe('low');
  });

  it('2 Jan: the comparison crosses the year, December against January', async () => {
    const deltas = await deltasFor(1, 2027);
    expect(delta(deltas, 'property_tax')).toMatchObject({ current: 8000, previous: 8000, deltaPct: 0 });
    // The final, smaller EMI.
    expect(delta(deltas, 'loan_emi')).toMatchObject({ current: 2000, previous: 4000, deltaPct: -50 });
    expect(deltas.map((d) => d.category).sort()).toEqual(['loan_emi', 'property_tax']);
    expect(await groceryBudget(12, 2026)).toMatchObject({ spent: 0, status: 'ok' });
  });
});
