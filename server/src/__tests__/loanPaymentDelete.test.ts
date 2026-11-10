import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { loanPayments, transactions } from '../db/schema';
import { localToday } from '../lib/clock';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const TODAY = localToday().iso;
const MONTH = Number(TODAY.slice(5, 7));
const YEAR = Number(TODAY.slice(0, 4));
const paise = (n: number) => Math.round(n * 100);

type LoanRow = { id: number; outstanding: number; emi: number; part_paid: number };
type PaymentRow = { id: number; kind: 'part_payment' | 'emi'; amount: number; balance_after: number | null };

// A loan that counts as an expense gets this month's EMI posted automatically on the next request.
// Do that now (GET /loans), so every test starts from the settled state.
const createLoan = async (token: string, extra: Record<string, unknown> = {}) => {
  const loan = (await request(app).post('/api/v1/loans').set(auth(token)).send({ name: 'Home loan', principal: 500000, outstanding: 100000, emi: 10000, counts_as_expense: true, ...extra })).body as { id: number };
  await request(app).get('/api/v1/loans').set(auth(token));
  return loan;
};
const partPay = (token: string, loanId: number, amount: number, date = TODAY) => request(app).post(`/api/v1/loans/${loanId}/part-payment`).set(auth(token)).send({ amount, date });
const remove = (token: string, loanId: number, paymentId: number | string) => request(app).delete(`/api/v1/loans/${loanId}/payments/${paymentId}`).set(auth(token));
const loanOf = async (token: string, id: number) => ((await request(app).get('/api/v1/loans').set(auth(token))).body as LoanRow[]).find((l) => l.id === id)!;
const allPayments = async (token: string, id: number) => (await request(app).get(`/api/v1/loans/${id}/payments`).set(auth(token))).body as PaymentRow[];
// Part payments only: the automatic EMI rows are not what these tests are about.
const payments = async (token: string, id: number) => (await allPayments(token, id)).filter((p) => p.kind === 'part_payment');
const allTxns = async (token: string) => (await request(app).get('/api/v1/transactions').set(auth(token))).body as { id: number; category: string; amount: number; note: string }[];
const txns = async (token: string) => (await allTxns(token)).filter((t) => t.category === 'loan_part_payment');
const spent = async (token: string) =>
  (await request(app).get('/api/v1/reports/summary').query({ startMonth: MONTH, startYear: YEAR, endMonth: MONTH, endYear: YEAR }).set(auth(token))).body.totalExpense as number;

describe('DELETE /loans/:id/payments/:paymentId', () => {
  it('requires authentication', async () => {
    expect((await request(app).delete('/api/v1/loans/1/payments/1')).status).toBe(401);
  });

  it('undoes the newest part payment: balance, EMI, expense entry and list row all go back', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    const base = await spent(accessToken);
    const paid = await partPay(accessToken, loan.id, 20000);
    expect(paid.status).toBe(201);
    expect(paid.body.loan).toMatchObject({ outstanding: 80000, emi: 8000 });
    expect(paise(await spent(accessToken)) - paise(base)).toBe(2000000);

    const [row] = await payments(accessToken, loan.id);
    const res = await remove(accessToken, loan.id, row.id);
    expect(res.status).toBe(200);
    expect(res.body.expenseRemoved).toBe(true);
    expect(res.body.loan).toMatchObject({ outstanding: 100000, emi: 10000 });

    expect(await loanOf(accessToken, loan.id)).toMatchObject({ outstanding: 100000, emi: 10000, part_paid: 0 });
    expect(await payments(accessToken, loan.id)).toHaveLength(0);
    expect(await txns(accessToken)).toHaveLength(0);
    expect(await spent(accessToken)).toBe(base);
  });

  it('restores an EMI that does not divide evenly to the exact original', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, { outstanding: 100000, emi: 3333.33 });
    await partPay(accessToken, loan.id, 12345.67);
    const [row] = await payments(accessToken, loan.id);
    await remove(accessToken, loan.id, row.id);
    const after = await loanOf(accessToken, loan.id);
    expect(paise(after.outstanding)).toBe(10000000);
    expect(paise(after.emi)).toBe(333333);
  });

  it('a loan that logs no expense has nothing to remove from Transactions', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, { counts_as_expense: false });
    await partPay(accessToken, loan.id, 5000);
    expect(await txns(accessToken)).toHaveLength(0);
    const [row] = await payments(accessToken, loan.id);
    const res = await remove(accessToken, loan.id, row.id);
    expect(res.status).toBe(200);
    expect(res.body.expenseRemoved).toBe(false);
    expect((await loanOf(accessToken, loan.id)).outstanding).toBe(100000);
  });

  it('reopens a loan that the payment had paid off, keeping the EMI it had', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    expect((await partPay(accessToken, loan.id, 100000)).body.loan).toMatchObject({ outstanding: 0, emi: 10000 });
    const [row] = await payments(accessToken, loan.id);
    const res = await remove(accessToken, loan.id, row.id);
    expect(res.status).toBe(200);
    expect(res.body.loan).toMatchObject({ outstanding: 100000, emi: 10000 });
  });

  it('deleting an older part payment leaves the newer one, and moves the later balances by the same amount', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    const base = await spent(accessToken);
    await partPay(accessToken, loan.id, 20000); // 100000 -> 80000, EMI 8000
    await partPay(accessToken, loan.id, 40000); // 80000 -> 40000, EMI 4000
    const before = await payments(accessToken, loan.id);
    expect(before.map((p) => p.balance_after)).toEqual([40000, 80000]);

    const older = before[1];
    const res = await remove(accessToken, loan.id, older.id);
    expect(res.status).toBe(200);

    // 40000 left + 20000 put back = 60000. The EMI scales by the same ratio the payments used.
    expect(res.body.loan.outstanding).toBe(60000);
    expect(res.body.loan.emi).toBe(6000);

    const after = await payments(accessToken, loan.id);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ amount: 40000, balance_after: 60000 });
    const left = await txns(accessToken);
    expect(left).toHaveLength(1);
    expect(left[0].amount).toBe(40000);
    expect(paise(await spent(accessToken)) - paise(base)).toBe(4000000);
  });

  it('deleting every part payment, newest first, returns the loan to where it started', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, { outstanding: 90000, emi: 4500 });
    for (const amount of [10000, 15000.5, 0.01]) await partPay(accessToken, loan.id, amount);
    for (const row of await payments(accessToken, loan.id)) expect((await remove(accessToken, loan.id, row.id)).status).toBe(200);
    const after = await loanOf(accessToken, loan.id);
    expect(paise(after.outstanding)).toBe(9000000);
    expect(paise(after.emi)).toBe(450000);
    expect(await txns(accessToken)).toHaveLength(0);
  });

  it('a part payment of one paisa can be deleted and leaves the balance exactly as it was', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    await partPay(accessToken, loan.id, 0.01);
    const [row] = await payments(accessToken, loan.id);
    await remove(accessToken, loan.id, row.id);
    expect(paise((await loanOf(accessToken, loan.id)).outstanding)).toBe(10000000);
  });
});

describe('what cannot be deleted', () => {
  it('EMI rows are refused and nothing changes', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken, { counts_as_expense: false });
    expect((await request(app).post(`/api/v1/loans/${loan.id}/pay-emi`).set(auth(accessToken)).send({ date: TODAY })).status).toBe(201);
    const [emi] = await allPayments(accessToken, loan.id);
    expect(emi.kind).toBe('emi');
    const res = await remove(accessToken, loan.id, emi.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/EMI/);
    expect(await allPayments(accessToken, loan.id)).toHaveLength(1);
    expect((await loanOf(accessToken, loan.id)).outstanding).toBe(90000);
  });

  it("another user's payment is a 404 and changes nothing", async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    const loan = await createLoan(owner.accessToken);
    await partPay(owner.accessToken, loan.id, 20000);
    const [row] = await payments(owner.accessToken, loan.id);
    expect((await remove(stranger.accessToken, loan.id, row.id)).status).toBe(404);
    expect(await payments(owner.accessToken, loan.id)).toHaveLength(1);
    expect((await loanOf(owner.accessToken, loan.id)).outstanding).toBe(80000);
    expect(await txns(owner.accessToken)).toHaveLength(1);
  });

  it("a payment cannot be deleted through a different loan's URL", async () => {
    const { accessToken } = await registerUser();
    const a = await createLoan(accessToken, { name: 'A' });
    const b = await createLoan(accessToken, { name: 'B' });
    await partPay(accessToken, a.id, 20000);
    const [row] = await payments(accessToken, a.id);
    expect((await remove(accessToken, b.id, row.id)).status).toBe(404);
    expect((await loanOf(accessToken, a.id)).outstanding).toBe(80000);
    expect((await loanOf(accessToken, b.id)).outstanding).toBe(100000);
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999999999999'])('a payment id of "%s" is a 400', async (bad) => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    expect((await remove(accessToken, loan.id, bad)).status).toBe(400);
  });

  it('a payment or loan that does not exist is a 404', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    expect((await remove(accessToken, loan.id, 987654321)).status).toBe(404);
    expect((await remove(accessToken, 987654321, 1)).status).toBe(404);
  });

  it('deleting twice restores the balance only once', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    await partPay(accessToken, loan.id, 20000);
    const [row] = await payments(accessToken, loan.id);
    expect((await remove(accessToken, loan.id, row.id)).status).toBe(200);
    expect((await remove(accessToken, loan.id, row.id)).status).toBe(404);
    expect((await loanOf(accessToken, loan.id)).outstanding).toBe(100000);
  });

  it('two deletes at the same moment restore the balance only once', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    await partPay(accessToken, loan.id, 20000);
    const [row] = await payments(accessToken, loan.id);
    const results = await Promise.all([remove(accessToken, loan.id, row.id), remove(accessToken, loan.id, row.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    expect((await loanOf(accessToken, loan.id)).outstanding).toBe(100000);
  });

  it('a user without the Loans feature is refused', async () => {
    const { accessToken } = await registerUser({ features: [] });
    expect((await remove(accessToken, 1, 1)).status).toBe(403);
  });
});

describe('part payments made before the link existed', () => {
  const legacyPayment = async (token: string, userId: number, loanId: number, amount: number, name = 'Home loan') => {
    const [t] = await db.insert(transactions).values({ userId, category: 'loan_part_payment', amount, type: 'expense', note: `Part payment - ${name}`, date: TODAY, month: MONTH, year: YEAR }).returning();
    const [p] = await db.insert(loanPayments).values({ userId, loanId, kind: 'part_payment', amount, date: TODAY, balanceAfter: null }).returning();
    return { txnId: t.id, paymentId: p.id };
  };

  it('finds and removes the one matching expense entry', async () => {
    const reg = await registerUser();
    const loan = await createLoan(reg.accessToken, { outstanding: 80000, emi: 8000 });
    const { paymentId } = await legacyPayment(reg.accessToken, reg.user.id, loan.id, 20000);
    const res = await remove(reg.accessToken, loan.id, paymentId);
    expect(res.status).toBe(200);
    expect(res.body.expenseRemoved).toBe(true);
    expect(await txns(reg.accessToken)).toHaveLength(0);
    // No saved EMI: it is scaled back by the ratio. 100000 / 80000 * 8000 = 10000.
    expect(res.body.loan).toMatchObject({ outstanding: 100000, emi: 10000 });
  });

  it('deletes the payment but leaves the entries alone when none matches', async () => {
    const reg = await registerUser();
    const loan = await createLoan(reg.accessToken, { outstanding: 80000, emi: 8000 });
    const [p] = await db.insert(loanPayments).values({ userId: reg.user.id, loanId: loan.id, kind: 'part_payment', amount: 20000, date: TODAY, balanceAfter: null }).returning();
    await request(app).post('/api/v1/transactions').set(auth(reg.accessToken)).send({ amount: 20000, type: 'expense', category_key: 'groceries_milk', date: TODAY });
    const res = await remove(reg.accessToken, loan.id, p.id);
    expect(res.status).toBe(200);
    expect(res.body.expenseRemoved).toBe(false);
    expect((await allTxns(reg.accessToken)).filter((t) => t.category === 'groceries_milk')).toHaveLength(1);
  });

  it('does not guess when two entries match', async () => {
    const reg = await registerUser();
    const loan = await createLoan(reg.accessToken, { outstanding: 80000, emi: 8000 });
    const first = await legacyPayment(reg.accessToken, reg.user.id, loan.id, 20000);
    await legacyPayment(reg.accessToken, reg.user.id, loan.id, 20000);
    const res = await remove(reg.accessToken, loan.id, first.paymentId);
    expect(res.status).toBe(200);
    expect(res.body.expenseRemoved).toBe(false);
    expect(await txns(reg.accessToken)).toHaveLength(2);
  });

  it('never touches another user\'s matching entry', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const loan = await createLoan(owner.accessToken, { outstanding: 80000, emi: 8000 });
    const { paymentId } = await legacyPayment(owner.accessToken, owner.user.id, loan.id, 20000);
    await db.insert(transactions).values({ userId: other.user.id, category: 'loan_part_payment', amount: 20000, type: 'expense', note: 'Part payment - Home loan', date: TODAY, month: MONTH, year: YEAR });
    await db.delete(transactions).where(and(eq(transactions.userId, owner.user.id), eq(transactions.category, 'loan_part_payment')));
    expect((await remove(owner.accessToken, loan.id, paymentId)).status).toBe(200);
    expect(await txns(other.accessToken)).toHaveLength(1);
  });
});

describe('deleting the expense entry by hand, then the payment', () => {
  it('still works: the link was cleared, so no entry is found, and the loan is restored', async () => {
    const { accessToken } = await registerUser();
    const loan = await createLoan(accessToken);
    await partPay(accessToken, loan.id, 20000);
    const [entry] = await txns(accessToken);
    expect((await request(app).delete(`/api/v1/transactions/${entry.id}`).set(auth(accessToken))).status).toBe(204);
    const [row] = await payments(accessToken, loan.id);
    const res = await remove(accessToken, loan.id, row.id);
    expect(res.status).toBe(200);
    expect(res.body.expenseRemoved).toBe(false);
    expect(res.body.loan.outstanding).toBe(100000);
  });
});
