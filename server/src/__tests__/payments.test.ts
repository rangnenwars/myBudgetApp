import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app } from './helpers';
import {
  DAY, PASSWORD, UPI_ID, auth, blankPng, clearGrants, makeAdmin, makeCustomer, makeSupport, me, paidGrants, setKind, setPaymentDetails, setTrialEnd, uniqueShot, uniqueTxn, upiQrPng,
  useMemoryPlan, userGrants,
} from './planTestKit';
import { db } from '../db/client';
import { adminAuditLog, paymentClaims } from '../db/schema';
import { outbox } from '../lib/accountMail';
import { DEFAULT_PLAN } from '../lib/plan';
import * as paymentDetailsLib from '../lib/paymentDetails';
import { purgeClaimScreenshots } from '../lib/payments';

// Paying for the plan: the QR and UPI ID an admin sets, the "I have paid" a
// user sends, and the admin confirming the money arrived.

const plan = useMemoryPlan();
beforeEach(() => {
  plan.plan = { ...DEFAULT_PLAN };
  outbox.length = 0;
});

const claim = (token: string, body: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/plan/claims').set(auth(token)).send({ txn_id: uniqueTxn(), screenshot: { data: uniqueShot() }, ...body });

const confirm = (adminToken: string, id: number, body: Record<string, unknown> = {}) => request(app).post(`/api/v1/admin/payments/${id}/confirm`).set(auth(adminToken)).send(body);
const reject = (adminToken: string, id: number, body: Record<string, unknown> = {}) => request(app).post(`/api/v1/admin/payments/${id}/reject`).set(auth(adminToken)).send(body);

let admin: Awaited<ReturnType<typeof makeAdmin>>;
beforeAll(async () => {
  admin = await makeAdmin();
  await setPaymentDetails(admin.token);
});
afterAll(async () => {
  // Leave real, readable details behind for any other test file.
  await setPaymentDetails(admin.token);
});

describe('payment details (admin)', () => {
  const put = (token: string, body: Record<string, unknown>) => request(app).put('/api/v1/admin/payment-details').set(auth(token)).send(body);

  it('only an admin can change them; support can look', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    const body = { upi_id: UPI_ID, payee_name: 'Prapanji', qr: { data: await upiQrPng(UPI_ID) }, password: PASSWORD };
    expect((await put(support.token, body)).status).toBe(403);
    expect((await put(u.accessToken, body)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/payment-details').set(auth(support.token))).status).toBe(200);
    expect((await request(app).get('/api/v1/admin/payment-details').set(auth(u.accessToken))).status).toBe(403);
  });

  it('asks for the password, and refuses a wrong one', async () => {
    const body = { upi_id: UPI_ID, payee_name: 'Prapanji', qr: { data: await upiQrPng(UPI_ID) } };
    expect((await put(admin.token, body)).status).toBe(400);
    expect((await put(admin.token, { ...body, password: 'wrong-password' })).status).toBe(403);
  });

  it('refuses a QR that pays a different UPI ID than the one typed', async () => {
    const res = await put(admin.token, { upi_id: UPI_ID, payee_name: 'Prapanji', qr: { data: await upiQrPng('someone-else@ybl') }, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('someone-else@ybl');
    expect(res.body.error).toContain(UPI_ID);
  });

  it('asks the admin to confirm a QR it cannot read, and records that it was confirmed by hand', async () => {
    const body = { upi_id: UPI_ID, payee_name: 'Prapanji', qr: { data: blankPng() }, password: PASSWORD };
    const first = await put(admin.token, body);
    expect(first.status).toBe(422);
    expect(first.body.code).toBe('QR_UNREADABLE');
    const second = await put(admin.token, { ...body, confirm_unreadable: true });
    expect(second.status).toBe(200);
    expect(second.body.qr_verified).toBe(false);
    const audit = await db.select().from(adminAuditLog).where(eq(adminAuditLog.action, 'payment_details_changed'));
    expect(audit.some((a) => a.details?.includes('confirmed by hand'))).toBe(true);
    await setPaymentDetails(admin.token);
  });

  it('checks the UPI ID, the name and the image', async () => {
    const qr = { data: await upiQrPng(UPI_ID) };
    expect((await put(admin.token, { upi_id: 'not-a-upi-id', payee_name: 'Prapanji', qr, password: PASSWORD })).status).toBe(400);
    expect((await put(admin.token, { upi_id: UPI_ID, payee_name: 'P', qr, password: PASSWORD })).status).toBe(400);
    expect((await put(admin.token, { upi_id: UPI_ID, payee_name: 'Prapanji', qr: { data: Buffer.from('not an image at all').toString('base64') }, password: PASSWORD })).status).toBe(400);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]).toString('base64');
    expect((await put(admin.token, { upi_id: UPI_ID, payee_name: 'Prapanji', qr: { data: webp }, password: PASSWORD })).status).toBe(400);
  });

  it('refuses a QR image over 1 MB', async () => {
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1_100_000)]).toString('base64');
    const res = await put(admin.token, { upi_id: UPI_ID, payee_name: 'Prapanji', qr: { data: big }, password: PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/1 MB/);
  });

  it('saves a matching QR, tells every admin, and logs it', async () => {
    outbox.length = 0;
    const res = await setPaymentDetails(admin.token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, upi_id: UPI_ID, qr_verified: true });
    expect(outbox.some((m) => m.to === admin.email && /Payment details changed/.test(m.subject) && m.text.includes(UPI_ID))).toBe(true);
    const audit = await db.select().from(adminAuditLog).where(eq(adminAuditLog.actorId, admin.id));
    expect(audit.some((a) => a.action === 'payment_details_changed')).toBe(true);
  });
});

describe('what every user sees', () => {
  it('the QR, the UPI ID, the amount and a link that opens their UPI app', async () => {
    const u = await makeCustomer();
    const res = await request(app).get('/api/v1/plan/payment-details').set(auth(u.accessToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, upi_id: UPI_ID, payee_name: 'Prapanji', amount_inr: 200, period: 'year' });
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(res.body.upi_link).toContain('upi://pay?');
    expect(res.body.upi_link).toContain('am=200.00');
    expect(res.body.upi_link).toContain(encodeURIComponent(UPI_ID));
    expect(decodeURIComponent(res.body.upi_link)).toContain(u.user.email);
  });

  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/v1/plan/payment-details')).status).toBe(401);
  });

  it('says so when no details are set up', async () => {
    const spy = jest.spyOn(paymentDetailsLib, 'loadPaymentDetails').mockResolvedValue(null);
    try {
      const u = await makeCustomer();
      expect((await request(app).get('/api/v1/plan/payment-details').set(auth(u.accessToken))).body).toEqual({ configured: false });
      expect((await claim(u.accessToken)).status).toBe(409);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('"I have paid"', () => {
  it('records the transaction ID and screenshot as waiting, showing only the last four characters back', async () => {
    const u = await makeCustomer();
    const txn = uniqueTxn();
    const res = await claim(u.accessToken, { txn_id: txn, note: 'paid at 10:42' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', txn_id: `…${txn.slice(-4)}` });
    expect(JSON.stringify(res.body)).not.toContain(txn);

    const queue = (await request(app).get('/api/v1/admin/payments').set(auth(admin.token))).body.claims as { id: number; txnId: string; email: string; hasScreenshot: boolean; usedBefore: number }[];
    const mine = queue.find((c) => c.id === res.body.id)!;
    expect(mine).toMatchObject({ txnId: txn, email: u.user.email, hasScreenshot: true, usedBefore: 0 });
  });

  it('accepts a spaced or lower-case transaction ID and stores it tidy', async () => {
    const u = await makeCustomer();
    const res = await claim(u.accessToken, { txn_id: ' t2411 0987-ab12 ' });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(paymentClaims).where(eq(paymentClaims.id, res.body.id));
    expect(row.txnId).toBe('T24110987AB12');
    await db.update(paymentClaims).set({ status: 'cancelled' }).where(eq(paymentClaims.id, res.body.id));
  });

  it('needs a real transaction ID and a real image', async () => {
    const u = await makeCustomer();
    expect((await claim(u.accessToken, { txn_id: '123' })).status).toBe(400);
    expect((await claim(u.accessToken, { txn_id: '' })).status).toBe(400);
    expect((await request(app).post('/api/v1/plan/claims').set(auth(u.accessToken)).send({ txn_id: uniqueTxn() })).status).toBe(400);
    expect((await claim(u.accessToken, { screenshot: { data: Buffer.from('plain text').toString('base64') } })).status).toBe(400);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2.2 * 1024 * 1024)]).toString('base64');
    const res = await claim(u.accessToken, { screenshot: { data: big } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/2 MB/);
  });

  it('allows one waiting payment at a time, and cancelling frees the transaction ID', async () => {
    const u = await makeCustomer();
    const txn = uniqueTxn();
    const first = await claim(u.accessToken, { txn_id: txn });
    expect(first.status).toBe(201);
    expect((await claim(u.accessToken)).status).toBe(409);

    expect((await request(app).post(`/api/v1/plan/claims/${first.body.id}/cancel`).set(auth(u.accessToken))).body.status).toBe('cancelled');
    const again = await claim(u.accessToken, { txn_id: txn });
    expect(again.status).toBe(201);
  });

  it("nobody can cancel someone else's payment", async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const made = await claim(a.accessToken);
    expect((await request(app).post(`/api/v1/plan/claims/${made.body.id}/cancel`).set(auth(b.accessToken))).status).toBe(404);
  });

  it('one transaction ID can back one payment, whoever sends it', async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const txn = uniqueTxn();
    expect((await claim(a.accessToken, { txn_id: txn })).status).toBe(201);
    const dup = await claim(b.accessToken, { txn_id: txn.toLowerCase() });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already been used/);
  });

  it('one screenshot can back one payment', async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const shot = uniqueShot();
    expect((await claim(a.accessToken, { screenshot: { data: shot } })).status).toBe(201);
    expect((await claim(b.accessToken, { screenshot: { data: shot } })).status).toBe(409);
  });

  it('allows three submissions a day, counting cancelled ones', async () => {
    const u = await makeCustomer();
    for (let i = 0; i < 3; i++) {
      const made = await claim(u.accessToken);
      expect(made.status).toBe(201);
      await request(app).post(`/api/v1/plan/claims/${made.body.id}/cancel`).set(auth(u.accessToken));
    }
    const fourth = await claim(u.accessToken);
    expect(fourth.status).toBe(429);
    expect(fourth.body.error).toMatch(/3 payment details a day/);
  });

  it('company accounts do not pay', async () => {
    const u = await makeCustomer();
    await setKind(u.user.id, 'company');
    expect((await claim(u.accessToken)).status).toBe(400);
  });

  it("two people sending the same ID at the same moment: exactly one wins", async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const txn = uniqueTxn();
    const [x, y] = await Promise.all([claim(a.accessToken, { txn_id: txn }), claim(b.accessToken, { txn_id: txn })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
  });
});

describe('access while a payment is being checked', () => {
  const enforce = () => {
    plan.plan = { ...plan.plan, enforced: true, existing_notice_at: new Date().toISOString() };
  };

  it('keeps a lapsed user going for a few days, once per access period, and no longer than the claim waits', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -2);
    expect((await me(u.accessToken)).plan.state).toBe('none');

    const first = await claim(u.accessToken);
    expect(first.status).toBe(201);
    const held = await me(u.accessToken);
    expect(held.plan.state).toBe('grace');
    expect(held.features).toHaveLength(4);
    const hours = (new Date(held.plan.until).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(70);
    expect(hours).toBeLessThan(73);

    // Cancel and try again: the same access period gets no second grace.
    await request(app).post(`/api/v1/plan/claims/${first.body.id}/cancel`).set(auth(u.accessToken));
    expect((await me(u.accessToken)).plan.state).toBe('none');
    const second = await claim(u.accessToken);
    expect(second.status).toBe(201);
    expect((await me(u.accessToken)).plan.state).toBe('none');
  });

  it('ends the hold when the payment is rejected', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -2);
    const made = await claim(u.accessToken);
    expect((await me(u.accessToken)).plan.state).toBe('grace');
    await reject(admin.token, made.body.id, { reason: 'Not found in the bank record' }).expect(200);
    expect((await me(u.accessToken)).plan.state).toBe('none');
  });

  it('does nothing for someone whose plan is still running', async () => {
    enforce();
    const u = await makeCustomer();
    await claim(u.accessToken);
    expect((await me(u.accessToken)).plan.state).toBe('trial');
  });
});

describe('confirming a payment', () => {
  it('only an admin can: support and users are refused', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    expect((await confirm(support.token, made.body.id)).status).toBe(403);
    expect((await confirm(u.accessToken, made.body.id)).status).toBe(403);
    expect((await reject(support.token, made.body.id)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/payments').set(auth(u.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/payments').set(auth(support.token))).status).toBe(200);
  });

  it('adds a year that starts when the current period ends, so renewing early loses no time', async () => {
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, 20);
    const trialEnd = (await userGrants(u.user.id))[0].endsAt!;
    const made = await claim(u.accessToken);

    outbox.length = 0;
    const res = await confirm(admin.token, made.body.id);
    expect(res.status).toBe(200);
    const [paid] = await paidGrants(u.user.id);
    expect(paid.startsAt.getTime()).toBe(trialEnd.getTime());
    expect(paid.endsAt!.getUTCFullYear() - paid.startsAt.getUTCFullYear()).toBe(1);
    expect(paid).toMatchObject({ amountInr: 200, priceInr: 200 });
    expect(new Date(res.body.access_until).getTime()).toBe(paid.endsAt!.getTime());

    const receipt = outbox.find((m) => m.to === u.user.email && /Payment confirmed/.test(m.subject));
    expect(receipt).toBeDefined();
    expect(receipt!.text).toContain('₹200');
    expect(receipt!.text).toContain(paid.txnId!);

    const claims = (await request(app).get('/api/v1/plan/claims').set(auth(u.accessToken))).body;
    expect(claims[0]).toMatchObject({ status: 'confirmed', amount_inr: 200 });
  });

  it('starts from today when the plan has already ended, and the user is paid at once', async () => {
    plan.plan = { ...plan.plan, enforced: true, existing_notice_at: new Date().toISOString() };
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -10);
    const made = await claim(u.accessToken);
    await confirm(admin.token, made.body.id).expect(200);
    const [paid] = await paidGrants(u.user.id);
    expect(Math.abs(paid.startsAt.getTime() - Date.now())).toBeLessThan(10_000);
    const body = await me(u.accessToken);
    expect(body.plan.state).toBe('paid');
    expect(body.tier).toBe('pro');
  });

  it('stacks a second renewal after the first', async () => {
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, 5);
    const one = await claim(u.accessToken);
    await confirm(admin.token, one.body.id).expect(200);
    const two = await claim(u.accessToken);
    await confirm(admin.token, two.body.id).expect(200);
    const grants = (await paidGrants(u.user.id)).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
    expect(grants).toHaveLength(2);
    expect(grants[1].startsAt.getTime()).toBe(grants[0].endsAt!.getTime());
  });

  it('cannot be confirmed twice, even by two admins at once, and adds only one period', async () => {
    const other = await makeAdmin();
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    const [x, y] = await Promise.all([confirm(admin.token, made.body.id), confirm(other.token, made.body.id)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await paidGrants(u.user.id)).toHaveLength(1);
    expect((await confirm(admin.token, made.body.id)).status).toBe(409);
  });

  it('refuses an amount below the plan price, and saves the price at the time it was paid', async () => {
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    expect((await confirm(admin.token, made.body.id, { amount_inr: 100 })).status).toBe(400);
    expect(await paidGrants(u.user.id)).toHaveLength(0);

    plan.plan = { ...plan.plan, price_inr: 300 };
    await confirm(admin.token, made.body.id, { amount_inr: 300 }).expect(200);
    plan.plan = { ...plan.plan, price_inr: 400 };
    expect((await paidGrants(u.user.id))[0]).toMatchObject({ amountInr: 300, priceInr: 300 });
  });

  it('cannot confirm a cancelled or rejected payment', async () => {
    const u = await makeCustomer();
    const a = await claim(u.accessToken);
    await request(app).post(`/api/v1/plan/claims/${a.body.id}/cancel`).set(auth(u.accessToken));
    expect((await confirm(admin.token, a.body.id)).status).toBe(409);
    const b = await claim(u.accessToken);
    await reject(admin.token, b.body.id).expect(200);
    expect((await confirm(admin.token, b.body.id)).status).toBe(409);
    expect((await confirm(admin.token, 999999999)).status).toBe(404);
  });

  it('is in the audit log with who did it', async () => {
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    await confirm(admin.token, made.body.id).expect(200);
    const rows = await db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, u.user.id));
    const row = rows.find((r) => r.action === 'payment_confirmed')!;
    expect(row).toMatchObject({ actorId: admin.id, targetEmail: u.user.email });
    expect(row.details).toContain('₹200');
  });
});

describe('rejecting a payment', () => {
  it('tells the user why, frees the transaction ID, and leaves their access alone', async () => {
    const u = await makeCustomer();
    const txn = uniqueTxn();
    const made = await claim(u.accessToken, { txn_id: txn });
    outbox.length = 0;
    await reject(admin.token, made.body.id, { reason: 'Amount was ₹100', resend: false }).expect(200);

    expect(outbox.find((m) => m.to === u.user.email && /couldn't confirm/i.test(m.subject))!.text).toContain('Amount was ₹100');
    const mine = (await request(app).get('/api/v1/plan/claims').set(auth(u.accessToken))).body[0];
    expect(mine).toMatchObject({ status: 'rejected', reason: 'Amount was ₹100', asked_to_resend: false });
    expect(await paidGrants(u.user.id)).toHaveLength(0);

    const retry = await claim(u.accessToken, { txn_id: txn });
    expect(retry.status).toBe(201);
  });

  it('can ask the user to send it again', async () => {
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    outbox.length = 0;
    await reject(admin.token, made.body.id, { resend: true, reason: 'The screenshot is cut off' }).expect(200);
    expect(outbox.find((m) => m.to === u.user.email)!.subject).toMatch(/send your payment details again/i);
    expect((await request(app).get('/api/v1/plan/claims').set(auth(u.accessToken))).body[0].asked_to_resend).toBe(true);
  });

  it('flags an ID that was sent before and not accepted', async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const txn = uniqueTxn();
    const first = await claim(a.accessToken, { txn_id: txn });
    await reject(admin.token, first.body.id).expect(200);
    const second = await claim(b.accessToken, { txn_id: txn });
    const queue = (await request(app).get('/api/v1/admin/payments').set(auth(admin.token))).body.claims as { id: number; usedBefore: number }[];
    expect(queue.find((c) => c.id === second.body.id)!.usedBefore).toBe(1);
  });
});

describe('screenshots', () => {
  it('only an admin can open one, and it is never cached', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    expect((await request(app).get(`/api/v1/admin/payments/${made.body.id}/screenshot`).set(auth(support.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/admin/payments/${made.body.id}/screenshot`).set(auth(u.accessToken))).status).toBe(403);
    const ok = await request(app).get(`/api/v1/admin/payments/${made.body.id}/screenshot`).set(auth(admin.token));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['cache-control']).toContain('no-store');
  });

  it('are removed 30 days after the payment is decided, keeping the ID, amount and who confirmed it', async () => {
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    await confirm(admin.token, made.body.id).expect(200);
    await db.update(paymentClaims).set({ decidedAt: new Date(Date.now() - 31 * DAY) }).where(eq(paymentClaims.id, made.body.id));
    expect(await purgeClaimScreenshots()).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(paymentClaims).where(eq(paymentClaims.id, made.body.id));
    expect(row.screenshot).toBeNull();
    expect(row).toMatchObject({ status: 'confirmed', amountInr: 200, decidedBy: admin.id });
    expect((await request(app).get(`/api/v1/admin/payments/${made.body.id}/screenshot`).set(auth(admin.token))).status).toBe(404);
  });

  it('are kept while the payment is still waiting', async () => {
    const u = await makeCustomer();
    const made = await claim(u.accessToken);
    await db.update(paymentClaims).set({ createdAt: new Date(Date.now() - 40 * DAY) }).where(eq(paymentClaims.id, made.body.id));
    await purgeClaimScreenshots();
    const [row] = await db.select().from(paymentClaims).where(eq(paymentClaims.id, made.body.id));
    expect(row.screenshot).not.toBeNull();
  });
});

describe('recording a payment by hand', () => {
  const mark = (token: string, userId: number, body: Record<string, unknown>) => request(app).post(`/api/v1/admin/users/${userId}/payments`).set(auth(token)).send(body);

  it('adds the period, emails a receipt, and refuses a reference already used', async () => {
    const u = await makeCustomer();
    await clearGrants(u.user.id);
    const ref = uniqueTxn();
    outbox.length = 0;
    const res = await mark(admin.token, u.user.id, { amount_inr: 200, txn_id: ref, note: 'bank transfer' });
    expect(res.status).toBe(201);
    expect(await paidGrants(u.user.id)).toHaveLength(1);
    expect(outbox.some((m) => m.to === u.user.email && /Payment confirmed/.test(m.subject))).toBe(true);

    const other = await makeCustomer();
    expect((await mark(admin.token, other.user.id, { amount_inr: 200, txn_id: ref })).status).toBe(409);
    expect(await paidGrants(other.user.id)).toHaveLength(0);
  });

  it('is admin only, and needs a proper amount and reference', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    expect((await mark(support.token, u.user.id, { amount_inr: 200, txn_id: uniqueTxn() })).status).toBe(403);
    expect((await mark(admin.token, u.user.id, { amount_inr: 100, txn_id: uniqueTxn() })).status).toBe(400);
    expect((await mark(admin.token, u.user.id, { amount_inr: 200, txn_id: 'x' })).status).toBe(400);
    expect((await mark(admin.token, 999999999, { amount_inr: 200, txn_id: uniqueTxn() })).status).toBe(404);
    await setKind(u.user.id, 'company');
    expect((await mark(admin.token, u.user.id, { amount_inr: 200, txn_id: uniqueTxn() })).status).toBe(400);
  });
});
