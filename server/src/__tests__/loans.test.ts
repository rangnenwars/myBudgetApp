import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { loans } from '../db/schema';
import { monthsToPost } from '../lib/loanEmiExpenses';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const now = new Date();
const CUR_YEAR = now.getUTCFullYear();
const CUR_MONTH = now.getUTCMonth() + 1;
const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;
const CUR_START = ym(CUR_YEAR, CUR_MONTH);
const monthsAgoStart = (n: number) => {
  const d = new Date(Date.UTC(CUR_YEAR, CUR_MONTH - 1 - n, 1));
  return ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
};
const listTxns = async (token: string) => (await request(app).get('/api/v1/transactions').set(auth(token))).body as { category: string; amount: number; date: string; note: string; month: number; year: number; id: number }[];

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

  it('defaults counts_as_expense to true and lets it be set on create', async () => {
    const { accessToken } = await registerUser();
    const base = { name: 'Loan', principal: 1000, outstanding: 1000, emi: 100 };
    const defaulted = await request(app).post('/api/v1/loans').set(auth(accessToken)).send(base);
    expect(defaulted.body.counts_as_expense).toBe(true);

    const excluded = await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ ...base, counts_as_expense: false });
    expect(excluded.status).toBe(201);
    expect(excluded.body.counts_as_expense).toBe(false);
  });

  it('toggles counts_as_expense via PATCH without touching other fields', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Loan', principal: 1000, outstanding: 900, emi: 100 });

    const off = await request(app).patch(`/api/v1/loans/${created.body.id}`).set(auth(accessToken)).send({ counts_as_expense: false });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ counts_as_expense: false, outstanding: 900, emi: 100 });
  });

  it('rejects a non-boolean counts_as_expense', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ name: 'Loan', principal: 1000, outstanding: 1000, emi: 100, counts_as_expense: 'maybe' });
    expect(res.status).toBe(400);
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

  // Manual "mark EMI paid" is only for loans that don't count as an expense —
  // counted loans are paid down automatically when their EMI posts.
  describe('POST /loans/:id/pay-emi', () => {
    const createLoan = async (token: string, extra: Record<string, unknown> = {}) =>
      (await request(app).post('/api/v1/loans').set(auth(token)).send({ name: 'Car loan', principal: 500000, outstanding: 400000, emi: 10000, counts_as_expense: false, ...extra })).body;
    const payEmi = (token: string, id: number) => request(app).post(`/api/v1/loans/${id}/pay-emi`).set(auth(token)).send({ date: '2026-09-05' });

    it('is refused for a loan whose EMI is posted and paid down automatically, leaving it untouched', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { counts_as_expense: true });
      expect(await listTxns(accessToken)).toHaveLength(1); // the auto-posted EMI for this month

      const res = await payEmi(accessToken, loan.id);
      expect(res.status).toBe(400);
      const list = await request(app).get('/api/v1/loans').set(auth(accessToken));
      expect(list.body[0].outstanding).toBe(400000);
      expect(await listTxns(accessToken)).toHaveLength(1);
    });

    it('lowers the balance of a loan that does not count as an expense, with no expense at all', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { name: 'From cousin', counts_as_expense: false, outstanding: 60000, emi: 5000 });

      const res = await payEmi(accessToken, loan.id);
      expect(res.status).toBe(201);
      expect(res.body.loan.outstanding).toBe(55000);
      expect(await listTxns(accessToken)).toHaveLength(0);
    });

    it('takes only the remaining balance on the final instalment', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { outstanding: 4000 });

      const res = await payEmi(accessToken, loan.id);
      expect(res.status).toBe(201);
      expect(res.body.loan.outstanding).toBe(0);
    });

    it('rejects paying a loan that is already fully paid', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { outstanding: 4000 });
      await payEmi(accessToken, loan.id);

      expect((await payEmi(accessToken, loan.id)).status).toBe(400);
    });

    it('rejects a malformed date', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);
      const res = await request(app).post(`/api/v1/loans/${loan.id}/pay-emi`).set(auth(accessToken)).send({ date: '05/09/2026' });
      expect(res.status).toBe(400);
    });

    it("returns 404 for another user's loan and leaves it untouched", async () => {
      const owner = await registerUser();
      const other = await registerUser();
      const loan = await createLoan(owner.accessToken);

      expect((await payEmi(other.accessToken, loan.id)).status).toBe(404);
      const list = await request(app).get('/api/v1/loans').set(auth(owner.accessToken));
      expect(list.body[0].outstanding).toBe(400000);
    });

    it('requires authentication', async () => {
      expect((await request(app).post('/api/v1/loans/1/pay-emi').send({ date: '2026-09-05' })).status).toBe(401);
    });
  });

  describe('automatic monthly EMI expenses', () => {
    const createLoan = async (token: string, extra: Record<string, unknown> = {}) =>
      (await request(app).post('/api/v1/loans').set(auth(token)).send({ name: 'Home loan', principal: 500000, outstanding: 300000, emi: 20000, ...extra })).body;

    it("posts the current month's EMI as an expense the first time data is read, and only once", async () => {
      const { accessToken } = await registerUser();
      await createLoan(accessToken);

      const first = await listTxns(accessToken);
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ category: 'loan_emi', amount: 20000, date: CUR_START, month: CUR_MONTH, year: CUR_YEAR, note: 'EMI - Home loan' });

      await listTxns(accessToken);
      await request(app).get('/api/v1/loans').set(auth(accessToken));
      expect(await listTxns(accessToken)).toHaveLength(1);
    });

    it('is included in report totals and the category breakdown', async () => {
      const { accessToken } = await registerUser();
      await createLoan(accessToken);
      const range = { startMonth: CUR_MONTH, startYear: CUR_YEAR, endMonth: CUR_MONTH, endYear: CUR_YEAR };

      const summary = await request(app).get('/api/v1/reports/summary').query(range).set(auth(accessToken));
      expect(summary.body.totalExpense).toBe(20000);
      const breakdown = await request(app).get('/api/v1/reports/category-breakdown').query({ ...range, type: 'expense' }).set(auth(accessToken));
      expect(breakdown.body).toEqual([{ category: 'loan_emi', total: 20000 }]);
    });

    it('skips loans that are excluded from expenses or already fully paid, and posts one per counted loan', async () => {
      const { accessToken } = await registerUser();
      await createLoan(accessToken, { name: 'Counted A', emi: 1000 });
      await createLoan(accessToken, { name: 'Counted B', emi: 2000 });
      await createLoan(accessToken, { name: 'Excluded', emi: 3000, counts_as_expense: false });
      await createLoan(accessToken, { name: 'Paid off', emi: 4000, outstanding: 0 });

      const txns = await listTxns(accessToken);
      expect(txns.map((t) => t.note).sort()).toEqual(['EMI - Counted A', 'EMI - Counted B']);
    });

    it('does not bring back an auto-posted transaction the user deleted', async () => {
      const { accessToken } = await registerUser();
      await createLoan(accessToken);
      const [posted] = await listTxns(accessToken);

      expect((await request(app).delete(`/api/v1/transactions/${posted.id}`).set(auth(accessToken))).status).toBe(204);
      expect(await listTxns(accessToken)).toHaveLength(0);
    });

    it('does not double-post when several requests arrive at once', async () => {
      const { accessToken } = await registerUser();
      await createLoan(accessToken);

      await Promise.all(Array.from({ length: 6 }, () => request(app).get('/api/v1/transactions').set(auth(accessToken))));
      expect(await listTxns(accessToken)).toHaveLength(1);
    });

    it('catches up the months missed since the last posting, one EMI per month, oldest first', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);
      await db.update(loans).set({ emi_expensed_through: monthsAgoStart(3) }).where(eq(loans.id, loan.id));

      const txns = await listTxns(accessToken);
      expect(txns.map((t) => t.date).sort()).toEqual([monthsAgoStart(2), monthsAgoStart(1), CUR_START]);
      expect(txns.every((t) => t.amount === 20000)).toBe(true);
    });

    it('does not back-fill the months a loan was off when it is switched back on', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { counts_as_expense: false });
      await db.update(loans).set({ emi_expensed_through: monthsAgoStart(3) }).where(eq(loans.id, loan.id));

      await request(app).patch(`/api/v1/loans/${loan.id}`).set(auth(accessToken)).send({ counts_as_expense: true });
      const txns = await listTxns(accessToken);
      expect(txns).toHaveLength(1);
      expect(txns[0]).toMatchObject({ month: CUR_MONTH, year: CUR_YEAR });
    });

    it('does not double-post when a loan is switched off and on again within the same month', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);
      await listTxns(accessToken);

      await request(app).patch(`/api/v1/loans/${loan.id}`).set(auth(accessToken)).send({ counts_as_expense: false });
      await request(app).patch(`/api/v1/loans/${loan.id}`).set(auth(accessToken)).send({ counts_as_expense: true });
      expect(await listTxns(accessToken)).toHaveLength(1);
    });

    it('stops posting once the loan is fully paid off', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { outstanding: 20000 });
      await listTxns(accessToken); // first posting: expense only

      // Two months to catch up: the first clears the balance, the second posts nothing.
      await db.update(loans).set({ emi_expensed_through: monthsAgoStart(2) }).where(eq(loans.id, loan.id));
      expect(await listTxns(accessToken)).toHaveLength(2);
      const [row] = await db.select().from(loans).where(eq(loans.id, loan.id));
      expect(row.outstanding).toBe(0);

      await db.update(loans).set({ emi_expensed_through: monthsAgoStart(1) }).where(eq(loans.id, loan.id));
      expect(await listTxns(accessToken)).toHaveLength(2);
    });

    it("does not reduce the balance on a loan's first posting — the balance entered is already today's", async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);
      await listTxns(accessToken);
      const [row] = await db.select().from(loans).where(eq(loans.id, loan.id));
      expect(row.outstanding).toBe(300000);
    });

    it('pays the balance down by each posted month\'s principal (no rate: the whole EMI)', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);
      await db.update(loans).set({ emi_expensed_through: monthsAgoStart(3) }).where(eq(loans.id, loan.id));
      await listTxns(accessToken);
      const [row] = await db.select().from(loans).where(eq(loans.id, loan.id));
      expect(row.outstanding).toBe(240000); // 3 × 20,000
    });

    it('splits each EMI into interest and principal at the loan rate, and caps the final instalment', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { outstanding: 100000, emi: 10000, interest_rate: 12 });
      await db.update(loans).set({ emi_expensed_through: monthsAgoStart(1) }).where(eq(loans.id, loan.id));
      const [emiTxn] = await listTxns(accessToken);
      expect(emiTxn.amount).toBe(10000);
      let [row] = await db.select().from(loans).where(eq(loans.id, loan.id));
      expect(row.outstanding).toBe(91000); // 1,000 interest (1% a month), 9,000 principal

      await db.update(loans).set({ outstanding: 5000, emi_expensed_through: monthsAgoStart(1) }).where(eq(loans.id, loan.id));
      const txns = await listTxns(accessToken);
      expect(txns.map((t) => t.amount).sort((a, b) => a - b)).toEqual([5050, 10000]); // 5,000 + 50 interest
      [row] = await db.select().from(loans).where(eq(loans.id, loan.id));
      expect(row.outstanding).toBe(0);
    });
  });

  describe('loan details', () => {
    it('saves and updates tenure, start date, type, lender and note', async () => {
      const { accessToken } = await registerUser();
      const res = await request(app)
        .post('/api/v1/loans')
        .set(auth(accessToken))
        .send({ name: 'Home', principal: 5000000, outstanding: 4000000, emi: 45000, interest_rate: 8.5, tenure_months: 240, start_date: '2022-04-01', loan_type: 'home', lender: 'HDFC', note: 'Flat' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ tenure_months: 240, start_date: '2022-04-01', loan_type: 'home', lender: 'HDFC', note: 'Flat', interest_rate: 8.5 });

      const patched = await request(app).patch(`/api/v1/loans/${res.body.id}`).set(auth(accessToken)).send({ lender: 'SBI', note: null });
      expect(patched.body).toMatchObject({ lender: 'SBI', note: null, tenure_months: 240 });
    });

    it('rejects an out-of-range interest rate or amount with 400', async () => {
      const { accessToken } = await registerUser();
      const base = { name: 'X', principal: 1000, outstanding: 1000, emi: 100 };
      expect((await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ ...base, interest_rate: 150 })).status).toBe(400);
      expect((await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ ...base, principal: 1e13 })).status).toBe(400);
      expect((await request(app).post('/api/v1/loans').set(auth(accessToken)).send({ ...base, start_date: '2026-02-30' })).status).toBe(400);
    });
  });

  describe('monthsToPost', () => {
    it('is just the current month for a loan that was never posted', () => {
      expect(monthsToPost(null, 2026, 9)).toEqual([{ year: 2026, month: 9 }]);
    });
    it('is empty when already posted for the current month', () => {
      expect(monthsToPost('2026-09-01', 2026, 9)).toEqual([]);
    });
    it('lists each missed month oldest first, across a year boundary', () => {
      expect(monthsToPost('2025-11-01', 2026, 2)).toEqual([
        { year: 2025, month: 12 },
        { year: 2026, month: 1 },
        { year: 2026, month: 2 },
      ]);
    });
    it('caps a very long gap at the most recent 24 months', () => {
      const months = monthsToPost('2020-01-01', 2026, 9);
      expect(months).toHaveLength(24);
      expect(months[months.length - 1]).toEqual({ year: 2026, month: 9 });
    });
  });

  describe('POST /loans/:id/part-payment', () => {
    const createLoan = async (token: string, extra: Record<string, unknown> = {}) =>
      (await request(app).post('/api/v1/loans').set(auth(token)).send({ name: 'Home loan', principal: 500000, outstanding: 100000, emi: 10000, ...extra })).body;
    const partPay = (token: string, id: number, body: Record<string, unknown>) =>
      request(app).post(`/api/v1/loans/${id}/part-payment`).set(auth(token)).send(body);

    it('lowers outstanding, scales the EMI to keep the tenure, and logs a part-payment expense', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);

      const res = await partPay(accessToken, loan.id, { amount: 25000, date: '2026-09-05' });
      expect(res.status).toBe(201);
      expect(res.body.loan).toMatchObject({ outstanding: 75000, emi: 7500, principal: 500000 });
      expect(res.body.transaction).toMatchObject({ amount: 25000, type: 'expense', category: 'loan_part_payment', date: '2026-09-05', note: 'Part payment - Home loan' });

      // This month's regular EMI (10,000, auto-posted before the payment) plus the 25,000 part payment.
      const breakdown = await request(app)
        .get('/api/v1/reports/category-breakdown')
        .query({ startMonth: 9, startYear: 2026, endMonth: 9, endYear: 2026, type: 'expense' })
        .set(auth(accessToken));
      expect(breakdown.body).toEqual(expect.arrayContaining([{ category: 'loan_part_payment', total: 25000 }]));
    });

    it('uses the adjusted EMI for the next "mark EMI paid"', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { counts_as_expense: false });
      await partPay(accessToken, loan.id, { amount: 50000, date: '2026-09-05' });

      const next = await request(app).post(`/api/v1/loans/${loan.id}/pay-emi`).set(auth(accessToken)).send({ date: '2026-09-06' });
      expect(next.body.loan).toMatchObject({ emi: 5000, outstanding: 45000 });
    });

    it('lowers the balance but logs no expense when the loan does not count as an expense', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { counts_as_expense: false });

      const res = await partPay(accessToken, loan.id, { amount: 20000, date: '2026-09-05' });
      expect(res.status).toBe(201);
      expect(res.body.loan).toMatchObject({ outstanding: 80000, emi: 8000 });
      expect(res.body.transaction).toBeNull();
      expect(await listTxns(accessToken)).toHaveLength(0);
    });

    it('closes the loan and keeps the EMI when the payment equals the outstanding balance', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);

      const res = await partPay(accessToken, loan.id, { amount: 100000, date: '2026-09-05' });
      expect(res.status).toBe(201);
      expect(res.body.loan).toMatchObject({ outstanding: 0, emi: 10000 });
      expect(res.body.transaction.amount).toBe(100000);
    });

    it('rejects a payment larger than the outstanding balance without changing anything', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);

      const res = await partPay(accessToken, loan.id, { amount: 100000.01, date: '2026-09-05' });
      expect(res.status).toBe(400);
      const list = await request(app).get('/api/v1/loans').set(auth(accessToken));
      expect(list.body[0]).toMatchObject({ outstanding: 100000, emi: 10000 });
      expect((await listTxns(accessToken)).filter((t) => t.category === 'loan_part_payment')).toHaveLength(0);
    });

    it('rejects a payment on a loan that is already fully paid', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken, { outstanding: 0 });
      expect((await partPay(accessToken, loan.id, { amount: 100, date: '2026-09-05' })).status).toBe(400);
    });

    it.each([[0], [-5], ['abc']])('rejects an invalid amount (%s)', async (amount) => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);
      expect((await partPay(accessToken, loan.id, { amount, date: '2026-09-05' })).status).toBe(400);
    });

    it('rejects a malformed date', async () => {
      const { accessToken } = await registerUser();
      const loan = await createLoan(accessToken);
      expect((await partPay(accessToken, loan.id, { amount: 1000, date: '05/09/2026' })).status).toBe(400);
    });

    it("returns 404 for another user's loan and leaves it untouched", async () => {
      const owner = await registerUser();
      const other = await registerUser();
      const loan = await createLoan(owner.accessToken);

      expect((await partPay(other.accessToken, loan.id, { amount: 1000, date: '2026-09-05' })).status).toBe(404);
      const list = await request(app).get('/api/v1/loans').set(auth(owner.accessToken));
      expect(list.body[0]).toMatchObject({ outstanding: 100000, emi: 10000 });
    });

    it('requires authentication', async () => {
      expect((await request(app).post('/api/v1/loans/1/part-payment').send({ amount: 100, date: '2026-09-05' })).status).toBe(401);
    });
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

describe('POST /api/v1/loans/:id/part-payment under concurrency', () => {
  it('simultaneous part payments each reduce the balance — none is lost', async () => {
    const { accessToken } = await registerUser();
    const loan = await request(app)
      .post('/api/v1/loans')
      .set(auth(accessToken))
      .send({ name: 'Race', principal: 10000, outstanding: 10000, emi: 1000, counts_as_expense: false });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post(`/api/v1/loans/${loan.body.id}/part-payment`).set(auth(accessToken)).send({ amount: 1000, date: '2026-09-15' })
      )
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const [row] = await db.select().from(loans).where(eq(loans.id, loan.body.id));
    expect(row.outstanding).toBe(5000);
  });
});
