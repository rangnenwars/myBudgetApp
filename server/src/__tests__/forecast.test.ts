import request from 'supertest';
import { app, registerUser } from './helpers';
import { buildForecast, ForecastInput, ruleDatesBetween } from '../lib/forecast';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// 31 Oct 2026, so the forecast covers Nov 2026 – Oct 2027.
const today = { year: 2026, month: 10, day: 31, iso: '2026-10-31' };
const ym = (year: number, month: number) => year * 12 + month - 1;

const rule = (over: Partial<ForecastInput['rules'][number]> = {}): ForecastInput['rules'][number] => ({
  type: 'expense',
  category: 'rent',
  amount: 8000,
  note: null,
  label: 'Rent',
  frequency: 'monthly',
  day_of_month: 1,
  next_due: '2026-11-01',
  posted_through: '2026-10-01',
  ends_on: null,
  ...over,
});

const input = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  today,
  rules: [],
  loans: [],
  loansOn: true,
  spendRows: [],
  firstEntryIndex: ym(2025, 1),
  labels: new Map([['food', 'Food'], ['rent', 'Rent']]),
  averageIncome: null,
  ...over,
});

describe('ruleDatesBetween', () => {
  it('falls back to the last day of short months and returns to the day after', () => {
    const dates = ruleDatesBetween(rule({ day_of_month: 31, next_due: '2026-11-30' }), '2026-11-01', '2027-03-31');
    expect(dates).toEqual(['2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('puts quarterly and yearly entries only in the months they fall due', () => {
    expect(ruleDatesBetween(rule({ frequency: 'quarterly', day_of_month: 10, next_due: '2026-12-10' }), '2026-11-01', '2027-10-31')).toEqual([
      '2026-12-10',
      '2027-03-10',
      '2027-06-10',
      '2027-09-10',
    ]);
    expect(ruleDatesBetween(rule({ frequency: 'yearly', day_of_month: 15, next_due: '2027-03-15' }), '2026-11-01', '2027-10-31')).toEqual(['2027-03-15']);
  });

  it('stops at the end date, and an already-ended rule gives nothing', () => {
    expect(ruleDatesBetween(rule({ ends_on: '2027-01-15' }), '2026-11-01', '2027-10-31')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(ruleDatesBetween(rule({ ends_on: '2026-10-20', next_due: '2026-11-01' }), '2026-11-01', '2027-10-31')).toEqual([]);
  });

  it('skips occurrences before the window starts', () => {
    expect(ruleDatesBetween(rule({ next_due: '2026-09-01' }), '2026-11-01', '2026-12-31')).toEqual(['2026-11-01', '2026-12-01']);
  });
});

describe('buildForecast', () => {
  it('covers the 12 months after the current one', () => {
    const f = buildForecast(input());
    expect(f.months).toHaveLength(12);
    expect(f.months[0]).toMatchObject({ year: 2026, month: 11 });
    expect(f.months[11]).toMatchObject({ year: 2027, month: 10 });
  });

  it('adds repeating income and bills, with a yearly bill landing in its own month', () => {
    const f = buildForecast(
      input({
        rules: [
          rule({ type: 'income', category: 'salary_1', label: 'Salary', amount: 60000, note: 'Salary' }),
          rule(),
          rule({ category: 'insurance', label: 'Insurance', amount: 12000, frequency: 'yearly', day_of_month: 15, next_due: '2027-03-15' }),
        ],
      })
    );
    expect(f.incomeSource).toBe('repeating');
    expect(f.months[0]).toMatchObject({ income: 60000, fixed: 8000, known: 52000 });
    const march = f.months.find((m) => m.year === 2027 && m.month === 3)!;
    expect(march).toMatchObject({ fixed: 20000, known: 40000 });
    expect(march.items.map((i) => i.label)).toEqual(['Salary', 'Rent', 'Insurance']);
  });

  it('does not count an ended income rule as income', () => {
    const f = buildForecast(input({ rules: [rule({ type: 'income', amount: 50000, ends_on: '2026-10-20' })], averageIncome: { amount: 30000 } }));
    expect(f.incomeSource).toBe('average');
    expect(f.months[0].income).toBe(30000);
  });

  it('reports no income when there is no rule and no average', () => {
    const f = buildForecast(input());
    expect(f.incomeSource).toBe('none');
    expect(f.months.every((m) => m.income === 0)).toBe(true);
  });

  it('pays a loan down month by month until it is cleared', () => {
    const f = buildForecast(input({ loans: [{ name: 'Phone', outstanding: 10000, emi: 4000, interest_rate: 0, counts_as_expense: true, emi_expensed_through: '2026-10-01' }] }));
    expect(f.months.slice(0, 4).map((m) => m.fixed)).toEqual([4000, 4000, 2000, 0]);
    expect(f.months[0].items[0]).toMatchObject({ kind: 'loan', label: 'Phone' });
  });

  it("counts this month's unposted EMI before projecting", () => {
    const f = buildForecast(input({ loans: [{ name: 'Phone', outstanding: 10000, emi: 4000, interest_rate: 0, counts_as_expense: true, emi_expensed_through: '2026-09-01' }] }));
    expect(f.months.slice(0, 3).map((m) => m.fixed)).toEqual([4000, 2000, 0]);
  });

  it('keeps EMIs of a loan that counts as an expense unnamed when Loans is off, and skips ones that do not', () => {
    const base = { outstanding: 10000, emi: 4000, interest_rate: 0, emi_expensed_through: '2026-10-01' };
    const f = buildForecast(
      input({
        loansOn: false,
        loans: [
          { name: 'Secret', counts_as_expense: true, ...base },
          { name: 'Hidden', counts_as_expense: false, ...base },
        ],
      })
    );
    expect(f.months[0].items).toEqual([expect.objectContaining({ kind: 'loan', label: 'Loan EMI', amount: 4000 })]);
  });

  describe('typical spending', () => {
    const food = (date: string, amount = 6000) => ({ category: 'food', amount, date });

    it('averages the last three full months by category', () => {
      const f = buildForecast(input({ spendRows: [food('2026-07-10'), food('2026-08-10'), food('2026-09-10', 3000), { category: 'rent', amount: 300, date: '2026-09-02' }] }));
      expect(f.typical).toMatchObject({ available: true, monthsUsed: 3, perMonth: 5100 });
      expect(f.typical.categories).toEqual([
        { category: 'food', label: 'Food', amount: 5000 },
        { category: 'rent', label: 'Rent', amount: 100 },
      ]);
      expect(f.basis).toBe('likely');
      expect(f.months[0]).toMatchObject({ known: 0, likely: -5100 });
    });

    it('leaves out loan EMIs and entries a repeating rule posted, so bills are not counted twice', () => {
      const f = buildForecast(
        input({
          rules: [rule({ amount: 8000, posted_through: '2026-10-01' })],
          spendRows: [
            { category: 'rent', amount: 8000, date: '2026-07-01' },
            { category: 'rent', amount: 8000, date: '2026-08-01' },
            { category: 'rent', amount: 7500, date: '2026-09-01' },
            { category: 'loan_emi', amount: 4000, date: '2026-09-01' },
            food('2026-09-05'),
          ],
        })
      );
      expect(f.typical.categories).toEqual([{ category: 'food', label: 'Food', amount: 2000 }]);
    });

    it('still counts a second entry in the same category on a rule day', () => {
      const f = buildForecast(
        input({
          rules: [rule({ posted_through: '2026-10-01' })],
          spendRows: [
            { category: 'rent', amount: 8000, date: '2026-09-01' },
            { category: 'rent', amount: 900, date: '2026-09-01' },
          ],
        })
      );
      expect(f.typical.categories).toEqual([{ category: 'rent', label: 'Rent', amount: 300 }]);
    });

    it("skips the month of the user's first entry, and falls back to known-only when no full month is left", () => {
      const partial = buildForecast(input({ firstEntryIndex: ym(2026, 8), spendRows: [food('2026-08-20', 9000), food('2026-09-10', 3000)] }));
      expect(partial.typical).toMatchObject({ monthsUsed: 1, perMonth: 3000 });

      const none = buildForecast(input({ firstEntryIndex: ym(2026, 9), spendRows: [food('2026-09-10', 3000)] }));
      expect(none.typical).toMatchObject({ available: false, monthsUsed: 0, perMonth: 0 });
      expect(none.basis).toBe('known');
      expect(none.months[0].likely).toBe(none.months[0].known);
    });

    it('is unavailable for a user with no entries at all', () => {
      expect(buildForecast(input({ firstEntryIndex: null })).typical.available).toBe(false);
    });
  });

  it('finds the tightest month and the average left over', () => {
    const f = buildForecast(
      input({
        rules: [
          rule({ type: 'income', category: 'salary_1', label: 'Salary', amount: 60000 }),
          rule({ amount: 10000 }),
          rule({ category: 'insurance', label: 'Insurance', amount: 55000, frequency: 'yearly', day_of_month: 15, next_due: '2027-03-15' }),
        ],
      })
    );
    expect(f.summary.tightest).toEqual({ year: 2027, month: 3, left: -5000 });
    expect(f.summary.averageLeft).toBe(Math.round(((11 * 50000 - 5000) / 12) * 100) / 100);
  });
});

describe('GET /forecast', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/forecast')).status).toBe(401);
  });

  it('refuses a user who does not have Plan ahead', async () => {
    const { accessToken } = await registerUser({ features: [] });
    const res = await request(app).get('/api/v1/forecast').set(auth(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.code ?? res.body.error?.code).toBe('FEATURE_NOT_ADDED');
  });

  it('returns 12 months built from the user’s repeating entries', async () => {
    const { accessToken } = await registerUser({ features: ['forecast'] });
    const now = new Date();
    const first = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const created = await request(app)
      .post('/api/v1/transactions')
      .set(auth(accessToken))
      .send({ amount: 50000, type: 'income', category_key: 'salary_1', date: first, note: 'Salary', repeat_monthly: true, repeat_no_end: true });
    expect(created.status).toBe(201);

    const res = await request(app).get('/api/v1/forecast').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.months).toHaveLength(12);
    expect(res.body.incomeSource).toBe('repeating');
    expect(res.body.months[0]).toMatchObject({ income: 50000, fixed: 0, known: 50000 });
    expect(res.body.months[0].items[0]).toMatchObject({ kind: 'income', label: 'Salary', amount: 50000 });
  });

  it('never shows another user’s entries', async () => {
    const alice = await registerUser({ features: ['forecast'] });
    const bob = await registerUser({ features: ['forecast'] });
    const now = new Date();
    const first = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    await request(app)
      .post('/api/v1/transactions')
      .set(auth(alice.accessToken))
      .send({ amount: 50000, type: 'income', category_key: 'salary_1', date: first, repeat_monthly: true, repeat_no_end: true });
    const res = await request(app).get('/api/v1/forecast').set(auth(bob.accessToken));
    expect(res.body.incomeSource).toBe('none');
    expect(res.body.months.every((m: { items: unknown[] }) => m.items.length === 0)).toBe(true);
  });
});
