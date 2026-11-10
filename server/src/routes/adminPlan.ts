import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { accessGrants, paymentClaims, paymentSettings, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAdminAction } from '../lib/auditLog';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { requireFeatureViewer } from '../middleware/requireFeatureStaff';
import { passwordCheckLimiter } from '../middleware/rateLimit';
import { activeException, getAccess } from '../lib/access';
import { claimRejectedMail, paymentDetailsChangedMail, receiptMail } from '../lib/accessMail';
import { notifyExistingUsers } from '../lib/accessNotices';
import { sendAccountMail } from '../lib/accountMail';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { decodeImageUpload, toDataUrl } from '../lib/imageUpload';
import { UPI_ID_RE, checkQr, loadPaymentDetails, normalizeUpiId } from '../lib/paymentDetails';
import { addPaidPeriod, duplicateTxnError, isDuplicateTxn, normalizeTxnId } from '../lib/payments';
import { getPlan, planEditSchema, savePlan } from '../lib/plan';
import { idParam, num } from '../lib/validation';

// The admin side of the paid plan: pricing, whether it is enforced, the
// payment details users see, confirming payments, company accounts and
// exceptions. Staff can read; only an admin changes anything, and every change
// is in the audit log. Anything that moves money or switches the rule on or off
// also asks for the admin's password again.
const router = Router();

const DAY_MS = 86_400_000;
const listQuery = z.object({ limit: num((n) => n.int().min(1).max(200)).default(100) });

const actorEmail = async (id: number) => (await db.select({ email: users.email }).from(users).where(eq(users.id, id)))[0]?.email ?? 'unknown';

/** Re-checks the signed-in admin's password: the second lock on actions that matter. */
const verifyPassword = async (userId: number, password: string | undefined) => {
  if (!password) throw badRequest('Enter your password to confirm.');
  const [me] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!me || !(await bcrypt.compare(password, me.hash))) throw forbidden('Your password is not correct.');
};

const findUser = async (id: number) => {
  const [u] = await db.select({ id: users.id, email: users.email, name: users.name, kind: users.accountKind, role: users.role }).from(users).where(eq(users.id, id));
  if (!u) throw notFound('User not found.');
  return u;
};

const audit = async (adminId: number, target: { id: number | null; email: string }, action: string, details: string) =>
  recordAdminAction({ actorId: adminId, actorEmail: await actorEmail(adminId), targetId: target.id, targetEmail: target.email, action, details });

const SYSTEM_TARGET = { id: null, email: 'plan settings' };

// ---------------------------------------------------------------- plan settings

router.get(
  '/plan',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (_req, res) => {
    const [plan, payment, stats] = await Promise.all([
      getPlan(),
      loadPaymentDetails(),
      db.execute<{ customers: number; company: number; trials: number; paid: number; exceptions: number; pending: number }>(sql`
        select
          (select count(*)::int from users where account_kind = 'customer') as customers,
          (select count(*)::int from users where account_kind = 'company') as company,
          (select count(distinct user_id)::int from access_grants g join users u on u.id = g.user_id where u.account_kind = 'customer' and g.kind = 'trial' and g.revoked_at is null and g.starts_at <= now() and g.ends_at > now()) as trials,
          (select count(distinct user_id)::int from access_grants where kind = 'paid' and revoked_at is null and starts_at <= now() and ends_at > now()) as paid,
          (select count(distinct user_id)::int from access_grants where kind = 'exception' and revoked_at is null and starts_at <= now() and (ends_at is null or ends_at > now())) as exceptions,
          (select count(*)::int from payment_claims where status = 'pending') as pending`),
    ]);
    res.json({ plan, payments_set_up: payment != null, stats: stats.rows[0] });
  })
);

router.put(
  '/plan',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = planEditSchema.parse(req.body);
    const before = await getPlan();
    const after = await savePlan(body, req.userId!);
    const changes: string[] = [];
    if (before.price_inr !== after.price_inr) changes.push(`price ₹${before.price_inr} -> ₹${after.price_inr}`);
    if (before.period !== after.period) changes.push(`period ${before.period} -> ${after.period}`);
    if (before.trial_months !== after.trial_months) changes.push(`free months ${before.trial_months} -> ${after.trial_months}`);
    if (before.notice_days !== after.notice_days) changes.push(`notice days ${before.notice_days} -> ${after.notice_days}`);
    if (before.features.join() !== after.features.join()) changes.push(`features ${before.features.join('+') || 'none'} -> ${after.features.join('+') || 'none'}`);
    if (changes.length) await audit(req.userId!, SYSTEM_TARGET, 'plan_changed', changes.join(', '));
    res.json(after);
  })
);

// Who would lose the plan if enforcement were switched on right now: the dry run.
router.get(
  '/plan/dry-run',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await db.execute<{ id: number; email: string; name: string; plan_end: string | null }>(sql`
      select u.id, u.email, u.name,
             max(g.ends_at) filter (where g.kind in ('trial','paid') and g.revoked_at is null) as plan_end
      from users u
      left join access_grants g on g.user_id = u.id
      where u.account_kind = 'customer' and u.is_active
      group by u.id
      having not coalesce(bool_or(g.revoked_at is null and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())), false)
      order by plan_end desc nulls last
      limit ${q.limit}`);
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users where account_kind = 'customer' and is_active`)).rows;
    const plan = await getPlan();
    res.json({ enforced: plan.enforced, existing_notice_at: plan.existing_notice_at, customers: n, would_lose: rows.rows.length, users: rows.rows.map((r) => ({ ...r, id: Number(r.id) })) });
  })
);

// Tell everyone who already has an account when their free access ends. Safe to run again.
router.post(
  '/plan/notify-existing',
  requireAuth,
  requireAdmin,
  passwordCheckLimiter,
  asyncHandler(async (req, res) => {
    await verifyPassword(req.userId!, z.object({ password: z.string() }).parse(req.body).password);
    const result = await notifyExistingUsers(req.userId!);
    await audit(req.userId!, SYSTEM_TARGET, 'plan_notice_sent', `${result.emailed} emailed, ${result.extended} end dates moved to the notice period, ${result.customers} customers`);
    res.json(result);
  })
);

// The big switch. Turning it ON needs the notice to have gone out first, so nobody finds out by being locked.
router.put(
  '/plan/enforcement',
  requireAuth,
  requireAdmin,
  passwordCheckLimiter,
  asyncHandler(async (req, res) => {
    const body = z.object({ on: z.boolean(), password: z.string() }).parse(req.body);
    await verifyPassword(req.userId!, body.password);
    const plan = await getPlan();
    if (plan.enforced === body.on) {
      res.json(plan);
      return;
    }
    if (body.on) {
      const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from users where account_kind = 'customer' and is_active`)).rows;
      if (!plan.existing_notice_at && n > 0) {
        throw conflict('Send the notice to existing users first, so nobody is locked without warning.');
      }
    }
    const after = await savePlan({ enforced: body.on, enforced_at: body.on ? new Date().toISOString() : plan.enforced_at }, req.userId!);
    await audit(req.userId!, SYSTEM_TARGET, 'plan_enforcement', body.on ? 'enforcement turned ON' : 'enforcement turned OFF');
    res.json(after);
  })
);

// ---------------------------------------------------------------- payment details

router.get(
  '/payment-details',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (_req, res) => {
    const [row] = await db
      .select({ upiId: paymentSettings.upiId, payeeName: paymentSettings.payeeName, verified: paymentSettings.qrVerified, updatedAt: paymentSettings.updatedAt, by: users.email })
      .from(paymentSettings)
      .leftJoin(users, eq(users.id, paymentSettings.updatedBy));
    const details = await loadPaymentDetails();
    res.json(row && details ? { configured: true, upi_id: row.upiId, payee_name: row.payeeName, qr: details.qr, qr_verified: row.verified, updated_at: row.updatedAt, updated_by: row.by } : { configured: false });
  })
);

const paymentDetailsSchema = z.object({
  upi_id: z.string().trim().regex(UPI_ID_RE, 'Enter a valid UPI ID, like name@bank.'),
  payee_name: z.string().trim().min(2, 'Enter the name to show.').max(60),
  qr: z.object({ data: z.string().min(1) }),
  password: z.string(),
  // Set after the app said the QR couldn't be read and the admin checked it by hand.
  confirm_unreadable: z.boolean().optional(),
});

router.put(
  '/payment-details',
  requireAuth,
  requireAdmin,
  passwordCheckLimiter,
  asyncHandler(async (req, res) => {
    const body = paymentDetailsSchema.parse(req.body);
    await verifyPassword(req.userId!, body.password);
    const qr = decodeImageUpload(body.qr.data, { maxBytes: 1024 * 1024, allowed: ['image/png', 'image/jpeg'], what: 'QR image' });

    // The QR must pay the UPI ID shown beside it. If it can't be read, an admin may confirm it by hand, once, on purpose.
    const check = checkQr(qr.buf, qr.mimeType, body.upi_id);
    let verified = true;
    if (!check.ok && check.reason === 'mismatch') {
      throw badRequest(`This QR pays ${check.found}, not ${normalizeUpiId(body.upi_id)}. Upload the right QR or correct the UPI ID.`);
    }
    if (!check.ok && check.reason === 'unreadable') {
      if (!body.confirm_unreadable) throw new AppError(422, "We couldn't read this QR code, so we can't check it matches the UPI ID. Use a clearer image, or confirm you've checked it yourself.", 'QR_UNREADABLE');
      verified = false;
    }

    const [before] = await db.select({ upiId: paymentSettings.upiId }).from(paymentSettings);
    const now = new Date();
    const values = { upiId: normalizeUpiId(body.upi_id), payeeName: body.payee_name, qrImage: qr.buf, qrMimeType: qr.mimeType, qrSize: qr.buf.length, qrVerified: verified, updatedBy: req.userId!, updatedAt: now };
    await db.insert(paymentSettings).values({ id: 1, ...values }).onConflictDoUpdate({ target: paymentSettings.id, set: values });

    const by = await actorEmail(req.userId!);
    await audit(req.userId!, SYSTEM_TARGET, 'payment_details_changed', `UPI ID ${before?.upiId ?? 'not set'} -> ${values.upiId}${verified ? '' : ' (QR confirmed by hand)'}`);
    // Every admin is told, so a swapped QR can't go unnoticed.
    const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
    await Promise.all(admins.map((a) => sendAccountMail(paymentDetailsChangedMail(a.email, by, values.upiId)).catch((err) => console.error('Payment details email failed:', err))));
    res.json({ configured: true, upi_id: values.upiId, payee_name: values.payeeName, qr_verified: verified, updated_at: now });
  })
);

// ---------------------------------------------------------------- payments to confirm

const statusQuery = z.object({ status: z.enum(['pending', 'confirmed', 'rejected', 'cancelled', 'all']).default('pending'), limit: num((n) => n.int().min(1).max(200)).default(100) });

router.get(
  '/payments',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (req, res) => {
    const q = statusQuery.parse(req.query);
    const where = q.status === 'all' ? undefined : eq(paymentClaims.status, q.status);
    const rows = await db
      .select({
        id: paymentClaims.id,
        status: paymentClaims.status,
        source: paymentClaims.source,
        txnId: paymentClaims.txnId,
        amountInr: paymentClaims.amountInr,
        note: paymentClaims.userNote,
        createdAt: paymentClaims.createdAt,
        decidedAt: paymentClaims.decidedAt,
        reason: paymentClaims.decisionReason,
        graceUntil: paymentClaims.graceUntil,
        hasScreenshot: sql<boolean>`${paymentClaims.screenshot} is not null`,
        userId: users.id,
        email: users.email,
        name: users.name,
        // The same ID was sent before and not accepted: worth a look.
        usedBefore: sql<number>`(select count(*)::int from payment_claims o where o.txn_id = ${paymentClaims.txnId} and o.id <> ${paymentClaims.id})`,
      })
      .from(paymentClaims)
      .innerJoin(users, eq(users.id, paymentClaims.userId))
      .where(where)
      .orderBy(q.status === 'pending' ? asc(paymentClaims.createdAt) : desc(paymentClaims.createdAt))
      .limit(q.limit);
    const plan = await getPlan();
    res.json({ price_inr: plan.price_inr, claims: rows });
  })
);

// The screenshot shows the user's payment app: admins only, never support.
router.get(
  '/payments/:id/screenshot',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [row] = await db.select({ shot: paymentClaims.screenshot, mime: paymentClaims.screenshotMimeType }).from(paymentClaims).where(eq(paymentClaims.id, idParam(req)));
    if (!row?.shot || !row.mime) throw notFound('No screenshot for this payment.');
    res.setHeader('Cache-Control', 'private, no-store');
    // The app asks for ?format=json (a data: URL it can show on every platform); a browser tab gets the raw image.
    if (req.query.format === 'json') {
      res.json({ data_url: toDataUrl(row.shot, row.mime) });
      return;
    }
    res.setHeader('Content-Type', row.mime);
    res.send(row.shot);
  })
);

router.post(
  '/payments/:id/confirm',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = z.object({ amount_inr: z.number().positive().max(1_000_000).optional() }).parse(req.body ?? {});
    const plan = await getPlan();
    const now = new Date();

    const done = await db.transaction(async (tx) => {
      const [claim] = await tx.select().from(paymentClaims).where(eq(paymentClaims.id, id)).for('update');
      if (!claim) throw notFound('Payment not found.');
      if (claim.status !== 'pending') throw conflict(`This payment was already ${claim.status}.`);
      const amount = body.amount_inr ?? plan.price_inr;
      const period = await addPaidPeriod(tx, { userId: claim.userId, amountInr: amount, txnId: claim.txnId, plan, adminId: req.userId!, now });
      await tx
        .update(paymentClaims)
        .set({ status: 'confirmed', amountInr: amount, decidedAt: now, decidedBy: req.userId!, grantId: period.grantId })
        .where(eq(paymentClaims.id, id));
      return { claim, amount, ...period };
    });

    const user = await findUser(done.claim.userId);
    await audit(req.userId!, user, 'payment_confirmed', `₹${done.amount}, txn ${done.claim.txnId}, access until ${done.endsAt.toISOString().slice(0, 10)}`);
    await sendAccountMail(receiptMail(user.email, done.endsAt, done.amount, done.claim.txnId)).catch((err) => console.error('Receipt email failed:', err));
    res.json({ id, status: 'confirmed', access_until: done.endsAt.toISOString() });
  })
);

router.post(
  '/payments/:id/reject',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = z.object({ reason: z.string().trim().max(300).default(''), resend: z.boolean().default(false) }).parse(req.body ?? {});
    const [claim] = await db
      .update(paymentClaims)
      .set({ status: 'rejected', decidedAt: new Date(), decidedBy: req.userId!, decisionReason: body.reason || null, askedToResend: body.resend })
      .where(and(eq(paymentClaims.id, id), eq(paymentClaims.status, 'pending')))
      .returning();
    if (!claim) throw conflict('This payment is not waiting to be checked.');
    const user = await findUser(claim.userId);
    await audit(req.userId!, user, 'payment_rejected', `txn ${claim.txnId}${body.resend ? ', asked to resend' : ''}${body.reason ? `: ${body.reason}` : ''}`);
    await sendAccountMail(claimRejectedMail(user.email, body.reason, body.resend)).catch((err) => console.error('Rejection email failed:', err));
    res.json({ id, status: 'rejected' });
  })
);

// A payment that never came through the app (cash, a bank transfer, a claim lost): recorded by hand.
router.post(
  '/users/:id/payments',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await findUser(idParam(req));
    const body = z.object({ amount_inr: z.number().positive().max(1_000_000), txn_id: z.string().trim().min(1), note: z.string().trim().max(300).optional() }).parse(req.body);
    if (user.kind === 'company') throw badRequest("Company accounts don't need to pay.");
    const txnId = normalizeTxnId(body.txn_id);
    if (!txnId) throw badRequest('That does not look like a transaction ID or reference.');
    const plan = await getPlan();
    const now = new Date();
    try {
      const out = await db.transaction(async (tx) => {
        const [claim] = await tx
          .insert(paymentClaims)
          .values({ userId: user.id, status: 'confirmed', source: 'admin', txnId, amountInr: body.amount_inr, userNote: body.note || null, decidedAt: now, decidedBy: req.userId! })
          .returning({ id: paymentClaims.id });
        const period = await addPaidPeriod(tx, { userId: user.id, amountInr: body.amount_inr, txnId, plan, adminId: req.userId!, now });
        await tx.update(paymentClaims).set({ grantId: period.grantId }).where(eq(paymentClaims.id, claim.id));
        return period;
      });
      await audit(req.userId!, user, 'payment_marked', `₹${body.amount_inr}, ref ${txnId}, access until ${out.endsAt.toISOString().slice(0, 10)}`);
      await sendAccountMail(receiptMail(user.email, out.endsAt, body.amount_inr, txnId)).catch((err) => console.error('Receipt email failed:', err));
      res.status(201).json({ access_until: out.endsAt.toISOString() });
    } catch (err) {
      if (isDuplicateTxn(err)) throw duplicateTxnError();
      throw err;
    }
  })
);

// ---------------------------------------------------------------- one user's access

const setterAlias = alias(users, 'setter');

const loadGrants = (userId: number) =>
  db
    .select({
      id: accessGrants.id,
      kind: accessGrants.kind,
      startsAt: accessGrants.startsAt,
      endsAt: accessGrants.endsAt,
      reason: accessGrants.reason,
      amountInr: accessGrants.amountInr,
      txnId: accessGrants.txnId,
      revokedAt: accessGrants.revokedAt,
      createdAt: accessGrants.createdAt,
      by: setterAlias.email,
    })
    .from(accessGrants)
    .leftJoin(setterAlias, eq(setterAlias.id, accessGrants.grantedBy))
    .where(eq(accessGrants.userId, userId))
    .orderBy(desc(accessGrants.createdAt));

router.get(
  '/users/:id/access',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (req, res) => {
    const user = await findUser(idParam(req));
    const [access, grants, exception, [{ pending }]] = await Promise.all([
      getAccess(user.id),
      loadGrants(user.id),
      activeException(user.id),
      db.select({ pending: count() }).from(paymentClaims).where(and(eq(paymentClaims.userId, user.id), eq(paymentClaims.status, 'pending'))),
    ]);
    res.json({
      account_kind: user.kind,
      access: { state: access.state, until: access.until, days_left: access.daysLeft, plan_end: access.planEnd, ended_on: access.endedOn },
      exception: exception ? { reason: exception.reason, ends_at: exception.endsAt, since: exception.createdAt } : null,
      grants,
      pending_claims: pending,
    });
  })
);

router.put(
  '/users/:id/account-kind',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await findUser(idParam(req));
    const { kind } = z.object({ kind: z.enum(['customer', 'company']) }).parse(req.body);
    // Same rule as the rest of user management: nobody changes their own account here.
    if (user.id === req.userId) throw forbidden('You cannot change your own account type.');
    if (user.kind === kind) {
      res.json({ account_kind: kind });
      return;
    }
    await db.update(users).set({ accountKind: kind, updatedAt: new Date() }).where(eq(users.id, user.id));
    await audit(req.userId!, user, 'account_kind_changed', `${user.kind} -> ${kind}`);
    res.json({ account_kind: kind });
  })
);

const exceptionSchema = z.discriminatedUnion('on', [
  z.object({
    on: z.literal(true),
    reason: z.string().trim().min(3, 'Give a reason, so the exception can be reviewed later.').max(300),
    // YYYY-MM-DD: the last day it applies. Left out means no end date, which the exceptions list flags.
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  }),
  z.object({ on: z.literal(false) }),
]);

/** The end of a calendar day in India: an exception "until 30 June" lasts through that day. */
const endOfDayIst = (ymd: string): Date => new Date(`${ymd}T23:59:59+05:30`);

router.put(
  '/users/:id/exception',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const user = await findUser(idParam(req));
    const body = exceptionSchema.parse(req.body);
    if (user.kind === 'company') throw badRequest('Company accounts always have access, so they need no exception.');
    const now = new Date();

    if (!body.on) {
      const revoked = await db
        .update(accessGrants)
        .set({ revokedAt: now, revokedBy: req.userId! })
        .where(and(eq(accessGrants.userId, user.id), eq(accessGrants.kind, 'exception'), isNull(accessGrants.revokedAt)))
        .returning({ id: accessGrants.id });
      if (revoked.length) await audit(req.userId!, user, 'exception_cleared', 'exception turned off');
      res.json({ on: false });
      return;
    }

    let endsAt: Date | null = null;
    if (body.until) {
      endsAt = endOfDayIst(body.until);
      if (Number.isNaN(endsAt.getTime())) throw badRequest('Enter a real date.');
      if (endsAt <= now) throw badRequest('The end date must be in the future.');
      if (endsAt.getTime() - now.getTime() > 5 * 365 * DAY_MS) throw badRequest('An exception can last at most 5 years. Leave the date empty for no end.');
    }
    // One exception at a time: a new one replaces the old, which stays in the history.
    await db.transaction(async (tx) => {
      await tx.update(accessGrants).set({ revokedAt: now, revokedBy: req.userId! }).where(and(eq(accessGrants.userId, user.id), eq(accessGrants.kind, 'exception'), isNull(accessGrants.revokedAt)));
      await tx.insert(accessGrants).values({ userId: user.id, kind: 'exception', startsAt: now, endsAt, reason: body.reason, grantedBy: req.userId! });
    });
    await audit(req.userId!, user, 'exception_set', `${body.reason}; ${endsAt ? `until ${body.until}` : 'no end date'}`);
    res.json({ on: true, ends_at: endsAt });
  })
);

// ---------------------------------------------------------------- lists

router.get(
  '/exceptions',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (req, res) => {
    const filter = z.object({ filter: z.enum(['all', 'ending_soon', 'no_end']).default('all') }).parse(req.query).filter;
    const now = new Date();
    const live = and(eq(accessGrants.kind, 'exception'), isNull(accessGrants.revokedAt), or(isNull(accessGrants.endsAt), gt(accessGrants.endsAt, now)));
    const rows = await db
      .select({ id: accessGrants.id, userId: users.id, email: users.email, name: users.name, reason: accessGrants.reason, endsAt: accessGrants.endsAt, since: accessGrants.createdAt, by: setterAlias.email })
      .from(accessGrants)
      .innerJoin(users, eq(users.id, accessGrants.userId))
      .leftJoin(setterAlias, eq(setterAlias.id, accessGrants.grantedBy))
      .where(live)
      .orderBy(sql`${accessGrants.endsAt} asc nulls first`)
      .limit(200);
    const soon = new Date(now.getTime() + 14 * DAY_MS);
    const out = rows
      .map((r) => ({ ...r, noEnd: r.endsAt == null }))
      .filter((r) => (filter === 'no_end' ? r.noEnd : filter === 'ending_soon' ? r.endsAt != null && r.endsAt <= soon : true));
    res.json(out);
  })
);

// The admin's daily list: who is about to lose access, who just did, and what is waiting.
router.get(
  '/plan/expiring',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (_req, res) => {
    const q = await db.execute<{ id: number; email: string; name: string; plan_end: string }>(sql`
      select u.id, u.email, u.name, max(g.ends_at) as plan_end
      from users u join access_grants g on g.user_id = u.id
      where u.account_kind = 'customer' and u.is_active and g.kind in ('trial','paid') and g.revoked_at is null
        and not exists (select 1 from access_grants x where x.user_id = u.id and x.kind = 'exception' and x.revoked_at is null and (x.ends_at is null or x.ends_at > now()))
      group by u.id
      having max(g.ends_at) between now() - interval '30 days' and now() + interval '30 days'
      order by max(g.ends_at)
      limit 200`);
    const now = Date.now();
    // Raw SQL returns bigint ids as text; the rest of the API sends numbers.
    const rows = q.rows.map((r) => ({ ...r, id: Number(r.id), ended: new Date(r.plan_end).getTime() <= now }));
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from payment_claims where status = 'pending'`)).rows;
    res.json({ ending: rows.filter((r) => !r.ended), ended: rows.filter((r) => r.ended), pending_claims: n });
  })
);

export default router;
