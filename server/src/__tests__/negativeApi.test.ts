import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, registerUser, promoteToAdmin, promoteToSupport, setUserActive, setFeatures, uniqueEmail, uniquePhone } from './helpers';
import { localToday } from '../lib/clock';

// The things that must NOT work: no token, wrong token, wrong role, someone else's data,
// malformed ids, bodies and query strings, and fields a client should never be able to set.
// Each case also checks that nothing was saved, so a "400" that still wrote a row fails.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const TODAY = localToday().iso;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const call = (method: Method, path: string, token?: string, body?: unknown) => {
  let r = request(app)[method](path);
  if (token) r = r.set(auth(token));
  return body === undefined ? r : r.send(body as object);
};

// ---------------------------------------------------------------------------
// 1. Not signed in, or signed in with something that isn't a valid session
// ---------------------------------------------------------------------------

const USER_ROUTES: [Method, string][] = [
  ['get', '/api/v1/auth/me'],
  ['patch', '/api/v1/auth/me/tier'],
  ['post', '/api/v1/auth/me/password'],
  ['post', '/api/v1/auth/me/logout-all'],
  ['get', '/api/v1/auth/me/export'],
  ['delete', '/api/v1/auth/me'],
  ['get', '/api/v1/categories'],
  ['post', '/api/v1/categories'],
  ['patch', '/api/v1/categories/x'],
  ['delete', '/api/v1/categories/x'],
  ['get', '/api/v1/transactions'],
  ['get', '/api/v1/transactions/page'],
  ['get', '/api/v1/transactions/range'],
  ['post', '/api/v1/transactions'],
  ['post', '/api/v1/transactions/batch'],
  ['post', '/api/v1/transactions/split'],
  ['post', '/api/v1/transactions/split-people'],
  ['patch', '/api/v1/transactions/1'],
  ['delete', '/api/v1/transactions/1'],
  ['get', '/api/v1/recurring'],
  ['post', '/api/v1/recurring'],
  ['patch', '/api/v1/recurring/1'],
  ['delete', '/api/v1/recurring/1'],
  ['get', '/api/v1/accounts'],
  ['post', '/api/v1/accounts'],
  ['patch', '/api/v1/accounts/1'],
  ['delete', '/api/v1/accounts/1'],
  ['get', '/api/v1/budgets'],
  ['get', '/api/v1/budgets/overall'],
  ['put', '/api/v1/budgets/overall'],
  ['put', '/api/v1/budgets/internet'],
  ['delete', '/api/v1/budgets/internet'],
  ['get', '/api/v1/people'],
  ['post', '/api/v1/people'],
  ['get', '/api/v1/people/1'],
  ['patch', '/api/v1/people/1'],
  ['delete', '/api/v1/people/1'],
  ['post', '/api/v1/people/1/entries'],
  ['delete', '/api/v1/people/1/entries/1'],
  ['get', '/api/v1/loans'],
  ['post', '/api/v1/loans'],
  ['patch', '/api/v1/loans/1'],
  ['get', '/api/v1/loans/1/payments'],
  ['post', '/api/v1/loans/1/pay-emi'],
  ['post', '/api/v1/loans/1/part-payment'],
  ['delete', '/api/v1/loans/1'],
  ['get', '/api/v1/investments'],
  ['post', '/api/v1/investments'],
  ['patch', '/api/v1/investments/1'],
  ['delete', '/api/v1/investments/1'],
  ['get', '/api/v1/goals'],
  ['post', '/api/v1/goals'],
  ['patch', '/api/v1/goals/1'],
  ['post', '/api/v1/goals/1/contributions'],
  ['get', '/api/v1/goals/1/contributions'],
  ['delete', '/api/v1/goals/1'],
  ['get', '/api/v1/reports/summary'],
  ['get', '/api/v1/reports/monthly-series'],
  ['get', '/api/v1/reports/category-breakdown'],
  ['get', '/api/v1/reports/export.csv'],
  ['get', '/api/v1/reports/debt-payoff'],
  ['get', '/api/v1/reports/goal-eta'],
  ['get', '/api/v1/reports/free-money-day'],
  ['get', '/api/v1/forecast'],
  ['post', '/api/v1/net-worth/snapshot'],
  ['get', '/api/v1/net-worth/history'],
  ['get', '/api/v1/features'],
  ['post', '/api/v1/features/goals/request'],
  ['get', '/api/v1/plan'],
  ['get', '/api/v1/plan/payment-details'],
  ['get', '/api/v1/plan/claims'],
  ['post', '/api/v1/plan/claims'],
  ['post', '/api/v1/plan/claims/1/cancel'],
  ['post', '/api/v1/issues'],
  ['get', '/api/v1/issues/mine'],
];

const STAFF_ROUTES: [Method, string][] = [
  ['get', '/api/v1/admin/users'],
  ['patch', '/api/v1/admin/users/1'],
  ['delete', '/api/v1/admin/users/1'],
  ['get', '/api/v1/admin/audit-log'],
  ['get', '/api/v1/admin/features'],
  ['put', '/api/v1/admin/features/defaults'],
  ['get', '/api/v1/admin/features/goals/users'],
  ['get', '/api/v1/admin/users/1/features'],
  ['put', '/api/v1/admin/users/1/features/goals'],
  ['get', '/api/v1/admin/plan'],
  ['put', '/api/v1/admin/plan'],
  ['get', '/api/v1/admin/plan/dry-run'],
  ['post', '/api/v1/admin/plan/notify-existing'],
  ['put', '/api/v1/admin/plan/enforcement'],
  ['get', '/api/v1/admin/plan/expiring'],
  ['get', '/api/v1/admin/payment-details'],
  ['put', '/api/v1/admin/payment-details'],
  ['get', '/api/v1/admin/payments'],
  ['get', '/api/v1/admin/payments/1/screenshot'],
  ['post', '/api/v1/admin/payments/1/confirm'],
  ['post', '/api/v1/admin/payments/1/reject'],
  ['post', '/api/v1/admin/users/1/payments'],
  ['get', '/api/v1/admin/users/1/access'],
  ['put', '/api/v1/admin/users/1/account-kind'],
  ['put', '/api/v1/admin/users/1/exception'],
  ['get', '/api/v1/admin/exceptions'],
  ['get', '/api/v1/system/metrics'],
  ['get', '/api/v1/issues'],
  ['patch', '/api/v1/issues/1'],
];

describe('not signed in', () => {
  it.each([...USER_ROUTES, ...STAFF_ROUTES])('%s %s is refused with 401', async (method, path) => {
    const res = await call(method, path);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });
});

describe('signed in with something that is not a session', () => {
  const secret = process.env.JWT_ACCESS_SECRET ?? 'test';
  const forged = (payload: object, key: string, opts: jwt.SignOptions = {}) => jwt.sign(payload, key, { expiresIn: '1h', ...opts });

  it.each([
    ['gibberish', 'not-a-token'],
    ['an empty token', ''],
    ['three dots', '...'],
    ['a token signed with another secret', forged({ sub: '1', userId: 1 }, 'another-secret')],
    ['an expired token', forged({ sub: '1', userId: 1 }, secret, { expiresIn: -60 })],
    ['a token with no algorithm', 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIiwidXNlcklkIjoxfQ.'],
  ])('%s is refused on a protected route', async (_label, token) => {
    const res = await request(app).get('/api/v1/transactions').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it.each([
    ['a different scheme', (t: string) => `Basic ${t}`],
    ['no scheme', (t: string) => t],
    ['a lower-case word only', () => 'bearer'],
  ])('an Authorization header with %s is refused', async (_label, build) => {
    const { accessToken } = await registerUser();
    const res = await request(app).get('/api/v1/transactions').set('Authorization', build(accessToken));
    expect(res.status).toBe(401);
  });

  it('a refresh token cannot be used as an access token', async () => {
    const { refreshToken } = await registerUser();
    expect((await call('get', '/api/v1/transactions', refreshToken)).status).toBe(401);
  });

  it('a deactivated account loses access straight away', async () => {
    const { accessToken, user } = await registerUser();
    expect((await call('get', '/api/v1/transactions', accessToken)).status).toBe(200);
    await setUserActive(user.id, false);
    expect([401, 403]).toContain((await call('get', '/api/v1/transactions', accessToken)).status);
  });
});

// ---------------------------------------------------------------------------
// 2. Signed in, but not allowed
// ---------------------------------------------------------------------------

describe('an ordinary user on staff routes', () => {
  it.each(STAFF_ROUTES)('%s %s is refused with 403', async (method, path) => {
    const { accessToken } = await registerUser();
    const res = await call(method, path, accessToken, {});
    expect(res.status).toBe(403);
  });
});

describe('support staff can look but not change', () => {
  const WRITES: [Method, string, object][] = [
    ['put', '/api/v1/admin/plan', { price_inr: 1 }],
    ['post', '/api/v1/admin/plan/notify-existing', {}],
    ['put', '/api/v1/admin/plan/enforcement', { on: true, password: 'x' }],
    ['put', '/api/v1/admin/payment-details', { upi_id: 'a@b' }],
    ['post', '/api/v1/admin/payments/1/confirm', { amount_inr: 200 }],
    ['post', '/api/v1/admin/payments/1/reject', { reason: 'no' }],
    ['post', '/api/v1/admin/users/1/payments', { amount_inr: 200, txn_id: 'ABCDEFGH1234' }],
    ['put', '/api/v1/admin/users/1/account-kind', { kind: 'company' }],
    ['put', '/api/v1/admin/users/1/exception', { on: true, reason: 'because' }],
    ['put', '/api/v1/admin/features/defaults', { goals: true, loans: true, investments: true }],
    ['put', '/api/v1/admin/users/1/features/goals', { on: true }],
    ['patch', '/api/v1/admin/users/1', { role: 'admin' }],
    ['delete', '/api/v1/admin/users/1', {}],
  ];

  it.each(WRITES)('%s %s is refused', async (method, path, body) => {
    const { accessToken, user } = await registerUser();
    await promoteToSupport(user.id);
    const res = await call(method, path, accessToken, body);
    expect(res.status).toBe(403);
  });

  it('cannot read payment screenshots', async () => {
    const { accessToken, user } = await registerUser();
    await promoteToSupport(user.id);
    expect((await call('get', '/api/v1/admin/payments/1/screenshot', accessToken)).status).toBe(403);
  });
});

describe('a feature the user does not have', () => {
  it.each([
    ['get', '/api/v1/loans'],
    ['post', '/api/v1/loans'],
    ['get', '/api/v1/investments'],
    ['post', '/api/v1/investments'],
    ['get', '/api/v1/goals'],
    ['post', '/api/v1/goals'],
  ] as [Method, string][])('%s %s is refused with 403', async (method, path) => {
    const { accessToken } = await registerUser({ features: [] });
    const res = await call(method, path, accessToken, { name: 'x', target_amount: 10, amount: 10, type: 'x', principal: 1, outstanding: 1, emi: 1 });
    expect(res.status).toBe(403);
  });

  it('switching a feature off stops a user who was using it', async () => {
    const { accessToken, user } = await registerUser();
    expect((await call('get', '/api/v1/goals', accessToken)).status).toBe(200);
    await setFeatures(user.id, []);
    expect((await call('get', '/api/v1/goals', accessToken)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 3. Somebody else's data
// ---------------------------------------------------------------------------

describe("another user's data", () => {
  const send = (token: string, path: string, body: object) => request(app).post(path).set(auth(token)).send(body);

  const makeAll = async (token: string) => {
    const txn = (await send(token, '/api/v1/transactions', { amount: 10, type: 'expense', category_key: 'groceries_milk', date: TODAY })).body.id as number;
    const account = (await send(token, '/api/v1/accounts', { name: 'Bank', type: 'bank', balance: 100 })).body.id as number;
    const person = (await send(token, '/api/v1/people', { name: 'Rahul' })).body.id as number;
    const loan = (await send(token, '/api/v1/loans', { name: 'Bike', principal: 1000, outstanding: 1000, emi: 100, counts_as_expense: false })).body.id as number;
    const investment = (await send(token, '/api/v1/investments', { name: 'Fund', type: 'mutual_fund', amount: 500 })).body.id as number;
    const goal = (await send(token, '/api/v1/goals', { name: 'Trip', target_amount: 1000 })).body.id as number;
    return { txn, account, person, loan, investment, goal };
  };

  const CASES: [string, Method, (ids: Awaited<ReturnType<typeof makeAll>>) => string, object][] = [
    ['edit a transaction', 'patch', (i) => `/api/v1/transactions/${i.txn}`, { amount: 99, type: 'expense', category_key: 'groceries_milk', date: TODAY }],
    ['delete a transaction', 'delete', (i) => `/api/v1/transactions/${i.txn}`, {}],
    ['edit an account', 'patch', (i) => `/api/v1/accounts/${i.account}`, { balance: 1 }],
    ['delete an account', 'delete', (i) => `/api/v1/accounts/${i.account}`, {}],
    ['open a person', 'get', (i) => `/api/v1/people/${i.person}`, {}],
    ['rename a person', 'patch', (i) => `/api/v1/people/${i.person}`, { name: 'Hacked' }],
    ['add to a persons ledger', 'post', (i) => `/api/v1/people/${i.person}/entries`, { kind: 'lent', amount: 5, date: TODAY }],
    ['delete a person', 'delete', (i) => `/api/v1/people/${i.person}`, {}],
    ['edit a loan', 'patch', (i) => `/api/v1/loans/${i.loan}`, { outstanding: 0 }],
    ['pay a loan EMI', 'post', (i) => `/api/v1/loans/${i.loan}/pay-emi`, { date: TODAY }],
    ['part-pay a loan', 'post', (i) => `/api/v1/loans/${i.loan}/part-payment`, { date: TODAY, amount: 10 }],
    ['read loan payments', 'get', (i) => `/api/v1/loans/${i.loan}/payments`, {}],
    ['delete a loan', 'delete', (i) => `/api/v1/loans/${i.loan}`, {}],
    ['edit an investment', 'patch', (i) => `/api/v1/investments/${i.investment}`, { current_value: 1 }],
    ['delete an investment', 'delete', (i) => `/api/v1/investments/${i.investment}`, {}],
    ['edit a goal', 'patch', (i) => `/api/v1/goals/${i.goal}`, { saved_amount: 999 }],
    ['add to a goal', 'post', (i) => `/api/v1/goals/${i.goal}/contributions`, { amount: 10, type: 'add' }],
    ['read goal contributions', 'get', (i) => `/api/v1/goals/${i.goal}/contributions`, {}],
    ['delete a goal', 'delete', (i) => `/api/v1/goals/${i.goal}`, {}],
  ];

  it.each(CASES)('cannot %s', async (_label, method, path, body) => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const ids = await makeAll(owner.accessToken);

    const res = await call(method, path(ids), stranger.accessToken, body);
    expect(res.status).toBe(404);

    // The owner still sees everything exactly as they left it.
    const get = async (p: string) => (await call('get', p, owner.accessToken)).body;
    expect(await get('/api/v1/transactions')).toHaveLength(1);
    expect((await get('/api/v1/transactions'))[0].amount).toBe(10);
    expect((await get('/api/v1/accounts'))[0].balance).toBe(100);
    expect((await get('/api/v1/loans'))[0].outstanding).toBe(1000);
    expect((await get('/api/v1/goals'))[0].saved_amount).toBe(0);
    expect((await get('/api/v1/people')).people[0].balance).toBe(0);
    expect((await get('/api/v1/people')).people[0].name).toBe('Rahul');
    expect(await get('/api/v1/investments')).toHaveLength(1);
  });

  it("a stranger's lists and reports are empty, not the owner's", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    await makeAll(owner.accessToken);
    for (const path of ['/api/v1/transactions', '/api/v1/accounts', '/api/v1/loans', '/api/v1/investments', '/api/v1/goals']) {
      expect((await call('get', path, stranger.accessToken)).body).toHaveLength(0);
    }
    expect((await call('get', '/api/v1/people', stranger.accessToken)).body.people).toHaveLength(0);
    const summary = await request(app).get('/api/v1/reports/summary').query({ startMonth: 1, startYear: 2000, endMonth: 12, endYear: 2100 }).set(auth(stranger.accessToken));
    expect(summary.body.totalExpense).toBe(0);
  });

  it("cannot split a bill with someone else's friend", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const person = (await send(owner.accessToken, '/api/v1/people', { name: 'Rahul' })).body.id;
    const res = await send(stranger.accessToken, '/api/v1/transactions/split-people', { date: TODAY, category_key: 'lunch_dinner', total: 100, method: 'equal', people: [{ person_id: person }] });
    expect([400, 404]).toContain(res.status);
    expect((await call('get', '/api/v1/transactions', stranger.accessToken)).body).toHaveLength(0);
    expect((await call('get', `/api/v1/people/${person}`, owner.accessToken)).body.person.balance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Ids that are not ids, and ids that do not exist
// ---------------------------------------------------------------------------

describe('malformed and missing ids', () => {
  const BAD_IDS = ['abc', '0', '-1', '1.5', '1e3', '99999999999999999999', '%20', 'null'];
  const RESOURCES: [Method, (id: string) => string, object][] = [
    ['patch', (id) => `/api/v1/transactions/${id}`, { amount: 1, type: 'expense', category_key: 'groceries_milk', date: TODAY }],
    ['delete', (id) => `/api/v1/transactions/${id}`, {}],
    ['patch', (id) => `/api/v1/accounts/${id}`, { balance: 1 }],
    ['delete', (id) => `/api/v1/accounts/${id}`, {}],
    ['get', (id) => `/api/v1/people/${id}`, {}],
    ['patch', (id) => `/api/v1/loans/${id}`, { outstanding: 1 }],
    ['post', (id) => `/api/v1/loans/${id}/pay-emi`, { date: TODAY }],
    ['delete', (id) => `/api/v1/goals/${id}`, {}],
    ['patch', (id) => `/api/v1/investments/${id}`, { current_value: 1 }],
    ['delete', (id) => `/api/v1/recurring/${id}`, {}],
  ];

  it.each(BAD_IDS)('the id "%s" is a 400 everywhere, never a 500', async (id) => {
    const { accessToken } = await registerUser();
    for (const [method, path, body] of RESOURCES) {
      const res = await call(method, path(id), accessToken, body);
      expect([400, 404]).toContain(res.status);
      expect(res.status).not.toBe(500);
    }
  });

  it('an id that is well-formed but does not exist is a 404', async () => {
    const { accessToken } = await registerUser();
    for (const [method, path, body] of RESOURCES) {
      expect((await call(method, path('987654321'), accessToken, body)).status).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Bad bodies
// ---------------------------------------------------------------------------

describe('bad request bodies', () => {
  const VALID_TXN = { amount: 10, type: 'expense', category_key: 'groceries_milk', date: TODAY };
  const DATES = ['2026-02-30', '2026-13-01', '2026-00-10', '26-01-01', '01/02/2026', '2026-1-5', 'yesterday', '', '2026-02-29', '2026-04-31', 20260101];

  it.each(DATES)('a transaction dated %p is refused and not saved', async (date) => {
    const { accessToken } = await registerUser();
    const res = await call('post', '/api/v1/transactions', accessToken, { ...VALID_TXN, date });
    expect(res.status).toBe(400);
    expect((await call('get', '/api/v1/transactions', accessToken)).body).toHaveLength(0);
  });

  it('accepts 29 February only in a leap year', async () => {
    const { accessToken } = await registerUser();
    expect((await call('post', '/api/v1/transactions', accessToken, { ...VALID_TXN, date: '2024-02-29' })).status).toBe(201);
    expect((await call('post', '/api/v1/transactions', accessToken, { ...VALID_TXN, date: '2026-02-29' })).status).toBe(400);
  });

  it.each([
    ['no amount', { type: 'expense', category_key: 'groceries_milk', date: TODAY }],
    ['no type', { amount: 10, category_key: 'groceries_milk', date: TODAY }],
    ['no category', { amount: 10, type: 'expense', date: TODAY }],
    ['no date', { amount: 10, type: 'expense', category_key: 'groceries_milk' }],
    ['an unknown type', { ...VALID_TXN, type: 'transfer' }],
    ['an empty category', { ...VALID_TXN, category_key: '' }],
    ['a category that does not exist', { ...VALID_TXN, category_key: 'no_such_category' }],
    ['an income category on an expense', { ...VALID_TXN, category_key: 'salary_1' }],
    ['an expense category on income', { ...VALID_TXN, type: 'income' }],
    ['a note that is too long', { ...VALID_TXN, note: 'x'.repeat(501) }],
    ['a category key that is too long', { ...VALID_TXN, category_key: 'k'.repeat(65) }],
    ['a repeat with no end', { ...VALID_TXN, repeat_frequency: 'monthly' }],
    ['an unknown repeat', { ...VALID_TXN, repeat_frequency: 'daily', repeat_no_end: true }],
    ['an array instead of an object', [VALID_TXN]],
    ['a string instead of an object', 'hello'],
    ['an empty object', {}],
  ])('a transaction with %s is refused and not saved', async (_label, body) => {
    const { accessToken } = await registerUser();
    const res = await call('post', '/api/v1/transactions', accessToken, body);
    expect(res.status).toBe(400);
    expect((await call('get', '/api/v1/transactions', accessToken)).body).toHaveLength(0);
  });

  it.each([
    ['no entries', { entries: [] }],
    ['51 entries', { entries: Array.from({ length: 51 }, () => VALID_TXN) }],
    ['one bad entry among good ones', { entries: [VALID_TXN, { ...VALID_TXN, amount: -1 }] }],
  ])('a batch with %s saves nothing', async (_label, body) => {
    const { accessToken } = await registerUser();
    expect((await call('post', '/api/v1/transactions/batch', accessToken, body)).status).toBe(400);
    expect((await call('get', '/api/v1/transactions', accessToken)).body).toHaveLength(0);
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a blank name', { name: '   ' }],
    ['a name that is too long', { name: 'n'.repeat(81) }],
    ['a number for a name', { name: 12345 }],
    ['an object for a name', { name: { first: 'a' } }],
    ['no name', {}],
  ])('a person with %s is refused', async (_label, body) => {
    const { accessToken } = await registerUser();
    expect((await call('post', '/api/v1/people', accessToken, body)).status).toBe(400);
    expect((await call('get', '/api/v1/people', accessToken)).body.people).toHaveLength(0);
  });

  it.each([
    ['an unknown kind', { kind: 'gifted', amount: 10 }],
    ['no kind', { amount: 10 }],
    ['an invalid due date', { kind: 'lent', amount: 10, due_date: '2026-02-30' }],
    ['an invalid date', { kind: 'lent', amount: 10, date: 'today' }],
    ['a note that is too long', { kind: 'lent', amount: 10, note: 'x'.repeat(501) }],
  ])('a person entry with %s is refused', async (_label, body) => {
    const { accessToken } = await registerUser();
    const p = (await call('post', '/api/v1/people', accessToken, { name: 'Rahul' })).body;
    expect((await call('post', `/api/v1/people/${p.id}/entries`, accessToken, { date: TODAY, ...body })).status).toBe(400);
    expect((await call('get', `/api/v1/people/${p.id}`, accessToken)).body.person.balance).toBe(0);
  });

  it.each([
    ['an unknown type', { name: 'X', type: 'crypto' }],
    ['no name', { type: 'bank' }],
    ['a name that is too long', { name: 'n'.repeat(61), type: 'bank' }],
  ])('an account with %s is refused', async (_label, body) => {
    const { accessToken } = await registerUser();
    expect((await call('post', '/api/v1/accounts', accessToken, body)).status).toBe(400);
    expect((await call('get', '/api/v1/accounts', accessToken)).body).toHaveLength(0);
  });

  it.each([
    ['an invalid deadline', { deadline: '2026-02-30' }],
    ['no name', { name: undefined }],
    ['a name that is too long', { name: 'n'.repeat(81) }],
  ])('a goal with %s is refused', async (_label, patch) => {
    const { accessToken } = await registerUser();
    const res = await call('post', '/api/v1/goals', accessToken, { name: 'Trip', target_amount: 100, ...patch });
    expect(res.status).toBe(400);
    expect((await call('get', '/api/v1/goals', accessToken)).body).toHaveLength(0);
  });

  it('an update with nothing to change is refused', async () => {
    const { accessToken } = await registerUser();
    const goal = (await call('post', '/api/v1/goals', accessToken, { name: 'Trip', target_amount: 100 })).body;
    const loan = (await call('post', '/api/v1/loans', accessToken, { name: 'L', principal: 100, outstanding: 100, emi: 10 })).body;
    const inv = (await call('post', '/api/v1/investments', accessToken, { name: 'F', type: 'fd', amount: 100 })).body;
    expect((await call('patch', `/api/v1/goals/${goal.id}`, accessToken, {})).status).toBe(400);
    expect((await call('patch', `/api/v1/loans/${loan.id}`, accessToken, {})).status).toBe(400);
    expect((await call('patch', `/api/v1/investments/${inv.id}`, accessToken, {})).status).toBe(400);
  });

  it('unknown fields are ignored and cannot set who owns a row', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const res = await call('post', '/api/v1/transactions', stranger.accessToken, { ...VALID_TXN, user_id: owner.user.id, userId: owner.user.id, id: 1, created_at: '2000-01-01' });
    expect(res.status).toBe(201);
    expect((await call('get', '/api/v1/transactions', owner.accessToken)).body).toHaveLength(0);
    expect((await call('get', '/api/v1/transactions', stranger.accessToken)).body).toHaveLength(1);
  });

  it('text that looks like code is stored as plain text and does no harm', async () => {
    const { accessToken } = await registerUser();
    const evil = ["'; DROP TABLE users; --", '<script>alert(1)</script>', '${process.exit(1)}', '\u0000null byte', '{"$ne":null}'];
    for (const note of evil) {
      const res = await call('post', '/api/v1/transactions', accessToken, { ...VALID_TXN, note });
      expect([201, 400]).toContain(res.status);
    }
    // A null byte cannot be stored: that is a 400, never a 500.
    expect((await call('post', '/api/v1/transactions', accessToken, { ...VALID_TXN, note: 'a b' })).status).toBe(400);
    expect((await call('post', '/api/v1/people', accessToken, { name: 'a b' })).status).toBe(400);
    const list = await call('get', '/api/v1/transactions', accessToken);
    expect(list.status).toBe(200);
    expect((await registerUser()).user.id).toBeGreaterThan(0);
  });

  it('a search for % or _ matches only that text', async () => {
    const { accessToken } = await registerUser();
    await call('post', '/api/v1/transactions', accessToken, { ...VALID_TXN, note: 'plain' });
    const res = await request(app).get('/api/v1/transactions/page').query({ q: '%' }).set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.items ?? res.body).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Bad requests on the wire
// ---------------------------------------------------------------------------

describe('bad requests on the wire', () => {
  it('broken JSON is a 400 with no stack trace', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/transactions').set(auth(accessToken)).set('Content-Type', 'application/json').send('{"amount": 10,');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|node_modules|at .*\.(ts|js)/);
  });

  it('a body over the size limit is refused with 413 and nothing is saved', async () => {
    const { accessToken } = await registerUser();
    const res = await call('post', '/api/v1/transactions', accessToken, { ...VALID(), note: 'x'.repeat(200_000) });
    expect(res.status).toBe(413);
    expect((await call('get', '/api/v1/transactions', accessToken)).body).toHaveLength(0);
  });

  it('form-encoded data is not accepted as JSON', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/transactions').set(auth(accessToken)).type('form').send('amount=10&type=expense');
    expect(res.status).toBe(400);
  });

  it('an unknown route is a clean 404', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/stack/i);
  });

  it('the wrong method on a real route is not a success', async () => {
    const { accessToken } = await registerUser();
    expect([404, 405]).toContain((await call('put', '/api/v1/transactions', accessToken, {})).status);
    expect([404, 405]).toContain((await call('delete', '/api/v1/auth/me/export', accessToken)).status);
  });

  const VALID = () => ({ amount: 10, type: 'expense', category_key: 'groceries_milk', date: TODAY });
});

// ---------------------------------------------------------------------------
// 7. Bad query strings
// ---------------------------------------------------------------------------

describe('bad query strings', () => {
  it.each([
    ['/api/v1/transactions', { month: 13, year: 2026 }],
    ['/api/v1/transactions', { month: 0, year: 2026 }],
    ['/api/v1/transactions', { month: 'May', year: 2026 }],
    ['/api/v1/transactions', { month: 5, year: 1999 }],
    ['/api/v1/transactions', { month: 5, year: 2101 }],
    ['/api/v1/transactions/page', { limit: 0 }],
    ['/api/v1/transactions/page', { limit: 201 }],
    ['/api/v1/transactions/page', { limit: 'ten' }],
    ['/api/v1/transactions/page', { type: 'transfer' }],
    ['/api/v1/transactions/range', { startMonth: 1, startYear: 2026 }],
    ['/api/v1/transactions/range', { startMonth: 13, startYear: 2026, endMonth: 1, endYear: 2026 }],
    ['/api/v1/reports/summary', { startMonth: 'a', startYear: 2026, endMonth: 1, endYear: 2026 }],
    ['/api/v1/reports/monthly-series', { startMonth: 1, startYear: 2026 }],
    ['/api/v1/reports/category-breakdown', { type: 'nothing' }],
    ['/api/v1/budgets', { month: 99, year: 2026 }],
  ])('%s with %o is a 400', async (path, query) => {
    const { accessToken } = await registerUser();
    const res = await request(app).get(path).query(query).set(auth(accessToken));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 8. Sign-up and sign-in
// ---------------------------------------------------------------------------

describe('sign-up and sign-in', () => {
  const register = (body: object) => request(app).post('/api/v1/auth/register').send(body);
  const good = () => ({ name: 'Asha', email: uniqueEmail('neg'), phone: uniquePhone(), password: 'password123' });

  it.each([
    ['no email', { email: undefined }],
    ['an email without @', { email: 'not-an-email' }],
    ['an email with spaces', { email: 'a b@test.local' }],
    ['a password of 7 characters', { password: 'abc1234' }],
    ['no password', { password: undefined }],
    ['a number for a password', { password: 12345678 }],
    ['no name', { name: undefined }],
    ['a blank name', { name: '   ' }],
    ['a phone number that is too short', { phone: '98765' }],
    ['a phone number with letters', { phone: '98765abcde' }],
    ['a phone number starting with 1', { phone: '1234567890' }],
  ])('registration with %s is refused', async (_label, patch) => {
    const res = await register({ ...good(), ...patch });
    expect(res.status).toBe(400);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('cannot register as an admin or choose a tier', async () => {
    const res = await register({ ...good(), role: 'admin', tier: 'pro', accountKind: 'company', isActive: true });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
    expect(res.body.user.accountKind ?? 'customer').toBe('customer');
  });

  it('a second account with the same email or phone is refused', async () => {
    const first = good();
    expect((await register(first)).status).toBe(201);
    expect((await register({ ...good(), email: first.email })).status).toBe(409);
    expect((await register({ ...good(), phone: first.phone })).status).toBe(409);
    expect((await register({ ...good(), email: first.email.toUpperCase() })).status).toBe(409);
  });

  it('a wrong password and an unknown email look the same, so nobody can find out who has an account', async () => {
    const { user } = await registerUser({ password: 'password123' });
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: uniqueEmail('ghost'), password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(JSON.stringify(wrong.body)).not.toMatch(/exist|not found|no such/i);
  });

  it.each([
    ['no password', (e: string) => ({ email: e })],
    ['no email', () => ({ password: 'password123' })],
    ['an empty body', () => ({})],
    ['an object for the password', (e: string) => ({ email: e, password: { $ne: '' } })],
    ['an array for the email', () => ({ email: ['a@b.c'], password: 'password123' })],
  ])('login with %s is refused', async (_label, build) => {
    const { user } = await registerUser();
    const res = await request(app).post('/api/v1/auth/login').send(build(user.email));
    expect([400, 401]).toContain(res.status);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('a deactivated user cannot sign in', async () => {
    const { user } = await registerUser({ password: 'password123' });
    await setUserActive(user.id, false);
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'password123' });
    expect([401, 403]).toContain(res.status);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('a used or invented refresh token gets no new session', async () => {
    const { refreshToken } = await registerUser();
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'invented' })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBeGreaterThanOrEqual(400);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken })).status).toBe(401);
  });

  it('changing a password needs the right current password and a long enough new one', async () => {
    const { accessToken } = await registerUser({ password: 'password123' });
    const change = (body: object) => call('post', '/api/v1/auth/me/password', accessToken, body);
    expect((await change({ currentPassword: 'wrong-wrong', newPassword: 'newpassword1' })).status).toBeGreaterThanOrEqual(400);
    expect((await change({ currentPassword: 'password123', newPassword: 'short' })).status).toBe(400);
    expect((await change({})).status).toBe(400);
  });

  it('deleting an account needs the password', async () => {
    const { accessToken } = await registerUser({ password: 'password123' });
    expect((await call('delete', '/api/v1/auth/me', accessToken, { password: 'wrong-wrong' })).status).toBeGreaterThanOrEqual(400);
    expect((await call('get', '/api/v1/auth/me', accessToken)).status).toBe(200);
  });

  it('an admin cannot be demoted, deactivated or deleted by an ordinary user, and cannot be changed by name alone', async () => {
    const admin = await registerUser();
    await promoteToAdmin(admin.user.id);
    const user = await registerUser();
    expect((await call('patch', `/api/v1/admin/users/${admin.user.id}`, user.accessToken, { isActive: false })).status).toBe(403);
    expect((await call('get', '/api/v1/auth/me', admin.accessToken)).body.role).toBe('admin');
  });
});

// ---------------------------------------------------------------------------
// 9. Paid plan: things a user must not be able to do
// ---------------------------------------------------------------------------

describe('paid plan abuse', () => {
  it.each([
    ['no transaction id', { note: 'paid' }],
    ['a transaction id that is too short', { txn_id: 'ABC' }],
    ['a transaction id with symbols', { txn_id: '!!!!@@@@####$$$$' }],
    ['a screenshot that is not an image', { txn_id: 'ABCDEFGH12345', screenshot: Buffer.from('not an image at all').toString('base64') }],
    ['a screenshot that is not base64', { txn_id: 'ABCDEFGH12345', screenshot: '***not base64***' }],
  ])('a payment claim with %s is refused and nothing is held', async (_label, body) => {
    const { accessToken } = await registerUser();
    const res = await call('post', '/api/v1/plan/claims', accessToken, body);
    expect(res.status).toBe(400);
    expect((await call('get', '/api/v1/plan/claims', accessToken)).body).toEqual(expect.not.arrayContaining([expect.objectContaining({ status: 'pending' })]));
  });

  it("cannot cancel or see another user's claim", async () => {
    const a = await registerUser();
    const b = await registerUser();
    const claim = await call('post', '/api/v1/plan/claims', a.accessToken, { txn_id: `TX${Date.now()}ABCD` });
    if (claim.status === 201) {
      expect((await call('post', `/api/v1/plan/claims/${claim.body.id}/cancel`, b.accessToken)).status).toBe(404);
      expect((await call('get', '/api/v1/plan/claims', b.accessToken)).body).toHaveLength(0);
    }
  });

  it('a user cannot set their own account kind, grant themselves an exception, or read the payment screenshot', async () => {
    const { accessToken, user } = await registerUser();
    expect((await call('put', `/api/v1/admin/users/${user.id}/account-kind`, accessToken, { kind: 'company' })).status).toBe(403);
    expect((await call('put', `/api/v1/admin/users/${user.id}/exception`, accessToken, { on: true, reason: 'me' })).status).toBe(403);
    expect((await call('get', '/api/v1/admin/payments/1/screenshot', accessToken)).status).toBe(403);
    expect((await call('get', '/api/v1/auth/me', accessToken)).body.accountKind ?? 'customer').toBe('customer');
  });

  it('the profile cannot be told it has more access than the server computed', async () => {
    const { accessToken } = await registerUser({ features: [] });
    const patch = await call('patch', '/api/v1/auth/me/tier', accessToken, { tier: 'pro', plan: { state: 'paid' }, features: ['goals'] });
    expect([200, 400, 403]).toContain(patch.status);
    expect((await call('get', '/api/v1/goals', accessToken)).status).toBe(403);
  });
});
