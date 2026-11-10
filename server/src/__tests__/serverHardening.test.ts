import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { auth, makeAdmin, makeCustomer, setPaymentDetails, uniqueShot, uniqueTxn, useMemoryPlan } from './planTestKit';
import { db } from '../db/client';
import { loanPayments, paymentClaims } from '../db/schema';
import { DEFAULT_PLAN } from '../lib/plan';
import { localToday } from '../lib/clock';
import { shiftIsoDate } from '../../../utils/dates';

// Inputs and timing that must not corrupt data or break the app, however the API is called.

const TODAY = localToday().iso;
const plan = useMemoryPlan();
beforeEach(() => {
  plan.plan = { ...DEFAULT_PLAN };
});

describe('numbers must be numbers', () => {
  const txn = (token: string, amount: unknown) =>
    request(app).post('/api/v1/transactions').set(auth(token)).send({ amount, type: 'expense', category_key: 'internet', date: TODAY });

  it('rejects an array, a boolean, an object, null and an empty string as an amount, and saves nothing', async () => {
    const { accessToken } = await registerUser();
    for (const bad of [[5], true, false, { v: 5 }, null, '', '   ', 'abc', 'NaN', 'Infinity']) {
      const res = await txn(accessToken, bad);
      expect([bad, res.status]).toEqual([bad, 400]);
    }
    expect((await request(app).get('/api/v1/transactions').set(auth(accessToken))).body.items ?? []).toHaveLength(0);
  });

  it('still accepts a number and a plain numeric string', async () => {
    const { accessToken } = await registerUser();
    expect((await txn(accessToken, 250)).status).toBe(201);
    expect((await txn(accessToken, '250.50')).status).toBe(201);
    expect((await txn(accessToken, '1e3')).status).toBe(201);
  });

  it('applies the same rule to other number fields and to query strings', async () => {
    const { accessToken } = await registerUser();
    expect((await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'G', target_amount: [100] })).status).toBe(400);
    const goal = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'G', target_amount: 100 });
    expect((await request(app).patch(`/api/v1/goals/${goal.body.id}`).set(auth(accessToken)).send({ saved_amount: true })).status).toBe(400);
    expect((await request(app).patch(`/api/v1/goals/${goal.body.id}`).set(auth(accessToken)).send({ saved_amount: [5] })).status).toBe(400);
    expect((await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'A', type: 'bank', balance: [5] })).status).toBe(400);
    expect((await request(app).get('/api/v1/transactions/page?limit=abc').set(auth(accessToken))).status).toBe(400);
    expect((await request(app).get('/api/v1/transactions/page?limit=').set(auth(accessToken))).status).toBe(400);
  });
});

describe('validation errors are in plain words', () => {
  it('says what is wrong without zod jargon', async () => {
    const { accessToken } = await registerUser();
    const empty = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/required/i);
    expect(empty.body.error).not.toMatch(/Invalid input|expected .* received/i);

    const zero = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 0, type: 'expense', category_key: 'internet', date: TODAY });
    expect(zero.body.error).toBe('Amount must be at least ₹0.01.');

    const blank = await request(app).post('/api/v1/people').set(auth(accessToken)).send({ name: '   ' });
    expect(blank.status).toBe(400);
    expect(blank.body.error).not.toMatch(/Too small|expected string/i);

    const bad = await request(app).get('/api/v1/transactions/page?limit=500').set(auth(accessToken));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/too large/i);
  });
});

describe('editing keeps what you did not change', () => {
  it('renaming an account leaves its balance alone, and an empty edit is refused', async () => {
    const { accessToken } = await registerUser();
    const acct = await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'HDFC', type: 'bank', balance: 12500 });
    expect(acct.status).toBe(201);
    const rename = await request(app).patch(`/api/v1/accounts/${acct.body.id}`).set(auth(accessToken)).send({ name: 'HDFC savings' });
    expect(rename.status).toBe(200);
    expect(rename.body).toMatchObject({ name: 'HDFC savings', balance: 12500, type: 'bank' });
    expect((await request(app).patch(`/api/v1/accounts/${acct.body.id}`).set(auth(accessToken)).send({})).status).toBe(400);
    const list = (await request(app).get('/api/v1/accounts').set(auth(accessToken))).body as { id: number; balance: number }[];
    expect(list.find((a) => a.id === acct.body.id)?.balance).toBe(12500);
  });
});

describe('dates must be sensible', () => {
  const txn = (token: string, date: string) =>
    request(app).post('/api/v1/transactions').set(auth(token)).send({ amount: 10, type: 'expense', category_key: 'internet', date });

  it('refuses years outside 2000–2100', async () => {
    const { accessToken } = await registerUser();
    for (const date of ['0001-01-01', '1999-12-31', '9999-12-31', '2101-01-01']) {
      expect([date, (await txn(accessToken, date)).status]).toEqual([date, 400]);
    }
    expect((await txn(accessToken, '2000-01-01')).status).toBe(201);
  });

  it('refuses an entry dated in the future, but allows today and a day of timezone slack', async () => {
    const { accessToken } = await registerUser();
    expect((await txn(accessToken, TODAY)).status).toBe(201);
    expect((await txn(accessToken, shiftIsoDate(TODAY, 1))).status).toBe(201);
    const far = await txn(accessToken, shiftIsoDate(TODAY, 30));
    expect(far.status).toBe(400);
    expect(far.body.error).toMatch(/future/i);
  });

  it('applies the same rule when editing, to the ledger and to part payments', async () => {
    const { accessToken } = await registerUser();
    const created = await txn(accessToken, TODAY);
    const edit = await request(app).patch(`/api/v1/transactions/${created.body.id}`).set(auth(accessToken)).send({ date: shiftIsoDate(TODAY, 90) });
    expect(edit.status).toBe(400);
    const person = await request(app).post('/api/v1/people').set(auth(accessToken)).send({ name: 'Asha' });
    const entry = await request(app).post(`/api/v1/people/${person.body.id}/entries`).set(auth(accessToken)).send({ kind: 'lent', amount: 5, date: shiftIsoDate(TODAY, 90) });
    expect(entry.status).toBe(400);
  });

  it('still lets a deadline or a repeat end date be in the future', async () => {
    const { accessToken } = await registerUser();
    const goal = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Trip', target_amount: 5000, deadline: shiftIsoDate(TODAY, 200) });
    expect(goal.status).toBe(201);
  });
});

describe('two payment submissions at the same moment', () => {
  it('leave exactly one waiting claim', async () => {
    const admin = await makeAdmin();
    await setPaymentDetails(admin.token);
    const u = await makeCustomer();
    const send = () => request(app).post('/api/v1/plan/claims').set(auth(u.accessToken)).send({ txn_id: uniqueTxn(), screenshot: { data: uniqueShot() } });
    const results = await Promise.all([send(), send(), send(), send()]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status !== 201).every((r) => r.status === 409)).toBe(true);
    const pending = await db.select().from(paymentClaims).where(eq(paymentClaims.userId, u.user.id));
    expect(pending.filter((c) => c.status === 'pending')).toHaveLength(1);
  });
});

describe('marking an EMI paid', () => {
  it('lowers the balance and writes its history together, once per tap, even for simultaneous taps', async () => {
    const { accessToken } = await registerUser({ features: ['loans'] });
    const loan = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'Family', principal: 100000, outstanding: 50000, emi: 5000, counts_as_expense: false });
    expect(loan.status).toBe(201);
    const pay = () => request(app).post(`/api/v1/loans/${loan.body.id}/pay-emi`).set(auth(accessToken)).send({ date: TODAY });
    const results = await Promise.all([pay(), pay(), pay()]);
    expect(results.every((r) => r.status === 201)).toBe(true);

    const after = (await request(app).get('/api/v1/loans').set(auth(accessToken))).body.find((l: { id: number }) => l.id === loan.body.id);
    expect(after.outstanding).toBe(35000);
    const history = await db.select().from(loanPayments).where(eq(loanPayments.loanId, loan.body.id));
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.balanceAfter as number).sort((a, b) => b - a)).toEqual([45000, 40000, 35000]);
  });
});
