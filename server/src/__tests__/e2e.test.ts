// A single, cohesive walk through the whole app lifecycle against the real
// API + real Postgres — the "does the whole system actually work together"
// counterpart to the focused per-route tests in the other files here.
import request from 'supertest';
import { app, uniqueEmail, uniquePhone } from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('end-to-end: a full user session', () => {
  it('register -> log real activity -> reports reflect it -> logout invalidates the session', async () => {
    const email = uniqueEmail('e2e');
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // 1. Register.
    const register = await request(app).post('/api/v1/auth/register').send({ name: 'E2E User', email, phone: uniquePhone(), password: 'password123' });
    expect(register.status).toBe(201);
    let { accessToken, refreshToken } = register.body;

    // 2. Log out immediately, then log back in with a fresh session — mirrors
    //    a real "close app, reopen later" cycle rather than reusing the
    //    register response's tokens for the rest of the flow.
    await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
    expect(login.status).toBe(200);
    ({ accessToken, refreshToken } = login.body);

    // 3. Bulk-log a month of activity, like the Input Expenses screen would.
    const entries = [
      { amount: 60000, type: 'income', category_key: 'salary_1' },
      { amount: 18000, type: 'expense', category_key: 'groceries_milk' },
      { amount: 5000, type: 'expense', category_key: 'fuel_petrol' },
      { amount: 3000, type: 'expense', category_key: 'internet' },
    ];
    for (const entry of entries) {
      const res = await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ ...entry, date: today });
      expect(res.status).toBe(201);
    }

    // 4. A loan, an investment, and a savings goal.
    const loan = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'Home loan', principal: 2000000, outstanding: 1900000, emi: 22000, interest_rate: 8.2 });
    expect(loan.status).toBe(201);

    const investment = await request(app)
      .post('/api/v1/investments')
      .set(auth(accessToken))
      .send({ name: 'SIP', type: 'Mutual fund', amount: 15000, current_value: 16500 });
    expect(investment.status).toBe(201);

    const goal = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Emergency fund', target_amount: 200000 });
    await request(app).patch(`/api/v1/goals/${goal.body.id}`).set(auth(accessToken)).send({ saved_amount: 40000 });

    // 5. Budget class should have recomputed from real spending (26,000 expense this month -> "low", under 30k).
    const me = await request(app).get('/api/v1/auth/me').set(auth(accessToken));
    expect(me.body.budgetClass).toBe('low');

    // 6. Reports reflect everything logged above, including the Home loan's 22,000 EMI,
    //    which is posted automatically as this month's expense (loans count as an expense by default).
    const rangeParams = { startMonth: now.getMonth() + 1, startYear: now.getFullYear(), endMonth: now.getMonth() + 1, endYear: now.getFullYear() };
    const summary = await request(app).get('/api/v1/reports/summary').query(rangeParams).set(auth(accessToken));
    expect(summary.body).toEqual({ totalIncome: 60000, totalExpense: 26000 + 22000, netSavings: 34000 - 22000 });

    const breakdown = await request(app).get('/api/v1/reports/category-breakdown').query({ ...rangeParams, type: 'expense' }).set(auth(accessToken));
    expect(breakdown.body).toEqual(
      expect.arrayContaining([
        { category: 'groceries_milk', total: 18000 },
        { category: 'fuel_petrol', total: 5000 },
        { category: 'internet', total: 3000 },
        { category: 'loan_emi', total: 22000 },
      ])
    );

    const debtPayoff = await request(app).get('/api/v1/reports/debt-payoff').set(auth(accessToken));
    expect(debtPayoff.body).toHaveLength(1);
    expect(debtPayoff.body[0].name).toBe('Home loan');

    // 7. Net worth: 16500 (investment) + 40000 (goal saved) - 1900000 (loan outstanding).
    const snapshot = await request(app).post('/api/v1/net-worth/snapshot').set(auth(accessToken));
    expect(snapshot.body.netWorth).toBe(16500 + 40000 - 1900000);

    // 8. Export as CSV.
    const csv = await request(app).get('/api/v1/reports/export.csv').query(rangeParams).set(auth(accessToken));
    expect(csv.status).toBe(200);
    expect(csv.text.split('\n')).toHaveLength(1 + entries.length + 1); // header + one row per transaction + the auto-posted loan EMI

    // 9. "Try Pro" toggle unlocks nothing server-enforced yet, but the flag itself must persist.
    const upgrade = await request(app).patch('/api/v1/auth/me/tier').set(auth(accessToken)).send({ tier: 'pro' });
    expect(upgrade.body.tier).toBe('pro');

    // 10. Logout ends the session — the same refresh token must stop working afterward.
    const logout = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(204);
    const deadRefresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(deadRefresh.status).toBe(401);

    // The access token itself keeps working until it naturally expires (15 min) —
    // logout only revokes the refresh token, matching the JWT access/refresh design.
    const stillWorks = await request(app).get('/api/v1/auth/me').set(auth(accessToken));
    expect(stillWorks.status).toBe(200);
  });

  it('two independent users never see each other\'s data across the whole flow', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const alice = await request(app).post('/api/v1/auth/register').send({ name: 'Alice', email: uniqueEmail('alice'), phone: uniquePhone(), password: 'password123' });
    const bob = await request(app).post('/api/v1/auth/register').send({ name: 'Bob', email: uniqueEmail('bob'), phone: uniquePhone(), password: 'password123' });

    await request(app).post('/api/v1/transactions').set(auth(alice.body.accessToken)).send({ amount: 1000, type: 'expense', category_key: 'fuel_petrol', date: today });
    await request(app).post('/api/v1/loans').set(auth(alice.body.accessToken)).send({ name: 'Alice loan', principal: 1000, outstanding: 1000, emi: 100 });

    const bobTxns = await request(app).get('/api/v1/transactions').set(auth(bob.body.accessToken));
    const bobLoans = await request(app).get('/api/v1/loans').set(auth(bob.body.accessToken));
    expect(bobTxns.body).toHaveLength(0);
    expect(bobLoans.body).toHaveLength(0);
  });
});
