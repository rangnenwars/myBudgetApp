import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { paymentClaims, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { requireAuth } from '../middleware/auth';
import { getAccess, planSummary } from '../lib/access';
import { getPlan } from '../lib/plan';
import { badRequest, conflict, notFound, AppError } from '../lib/errors';
import { decodeImageUpload } from '../lib/imageUpload';
import { loadPaymentDetails, upiPayLink } from '../lib/paymentDetails';
import { CLAIMS_PER_DAY, GRACE_DAYS, duplicateTxnError, graceAllowed, isDuplicateTxn, maskTxnId, normalizeTxnId } from '../lib/payments';
import { idParam } from '../lib/validation';

// The signed-in user's own view of the plan: where they stand, how to pay, and
// the payment they have told us about. They can't change anything about access
// here; only an admin confirms money received (routes/adminPlan.ts).
const router = Router();
router.use(requireAuth);

const DAY_MS = 86_400_000;
// 2 MB, like issue-report screenshots: it has to fit the web proxy's 4 MB request limit once base64-encoded.
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;

const claimSchema = z.object({
  txn_id: z.string().trim().min(1, 'Enter the transaction ID.').max(60),
  screenshot: z.object({ data: z.string().min(1) }),
  note: z.string().trim().max(300).optional(),
});

const claimView = (c: typeof paymentClaims.$inferSelect) => ({
  id: c.id,
  status: c.status,
  txn_id: maskTxnId(c.txnId),
  amount_inr: c.amountInr,
  created_at: c.createdAt,
  decided_at: c.decidedAt,
  // The admin's note, shown to the user so a rejection is never a mystery.
  reason: c.status === 'rejected' ? c.decisionReason : null,
  asked_to_resend: c.askedToResend,
  grace_until: c.status === 'pending' ? c.graceUntil : null,
});

const recentClaims = (userId: number) =>
  db.select().from(paymentClaims).where(eq(paymentClaims.userId, userId)).orderBy(desc(paymentClaims.createdAt)).limit(5);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const [plan, access, claims, payment] = await Promise.all([getPlan(), getAccess(req.userId!), recentClaims(req.userId!), loadPaymentDetails()]);
    res.json({ plan: planSummary(access, plan), claims: claims.map(claimView), payments_set_up: payment != null });
  })
);

// The QR and UPI ID every user sees on the Renew screen. Separate from GET / because it carries the image.
router.get(
  '/payment-details',
  asyncHandler(async (req, res) => {
    const [plan, payment, [me]] = await Promise.all([getPlan(), loadPaymentDetails(), db.select({ email: users.email }).from(users).where(eq(users.id, req.userId!))]);
    if (!payment) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      upi_id: payment.upiId,
      payee_name: payment.payeeName,
      qr: payment.qr,
      amount_inr: plan.price_inr,
      period: plan.period,
      // Opens the user's UPI app with the amount and their account email in the note, so the payment can be matched.
      upi_link: upiPayLink(payment.upiId, payment.payeeName, plan.price_inr, `Prapanji ${me?.email ?? ''}`.trim()),
    });
  })
);

router.get(
  '/claims',
  asyncHandler(async (req, res) => {
    res.json((await recentClaims(req.userId!)).map(claimView));
  })
);

// "I have paid": the transaction ID and a screenshot. It waits for an admin
// to confirm the money arrived. Access carries on for a few days meanwhile.
router.post(
  '/claims',
  asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = claimSchema.parse(req.body);
    const [me] = await db.select({ kind: users.accountKind }).from(users).where(eq(users.id, userId));
    if (me?.kind === 'company') throw badRequest("Company accounts don't need to pay.");

    const payment = await loadPaymentDetails();
    if (!payment) throw conflict('Payments are not set up yet. Please contact support.');

    const txnId = normalizeTxnId(body.txn_id);
    if (!txnId) throw badRequest('That does not look like a transaction ID. It is usually 12 digits.');
    const shot = decodeImageUpload(body.screenshot.data, { maxBytes: MAX_SCREENSHOT_BYTES, allowed: ['image/png', 'image/jpeg', 'image/webp'], what: 'Screenshot' });

    const now = new Date();
    const [access, previous] = await Promise.all([
      getAccess(userId, now),
      db.select({ graceUntil: paymentClaims.graceUntil, forAccessEnd: paymentClaims.forAccessEnd }).from(paymentClaims).where(eq(paymentClaims.userId, userId)),
    ]);
    const grace = graceAllowed(previous, access.planEnd);

    try {
      // One transaction under a lock on the user's row: two requests sent at the same moment
      // can't both pass the "nothing pending" check and leave two claims waiting for an admin.
      const claim = await db.transaction(async (tx) => {
        await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');

        const [{ recent }] = await tx
          .select({ recent: sql<number>`count(*)::int` })
          .from(paymentClaims)
          .where(and(eq(paymentClaims.userId, userId), gt(paymentClaims.createdAt, new Date(now.getTime() - DAY_MS))));
        if (recent >= CLAIMS_PER_DAY) throw new AppError(429, `You can send up to ${CLAIMS_PER_DAY} payment details a day. Please try again tomorrow, or contact support.`);

        const [pending] = await tx.select({ id: paymentClaims.id }).from(paymentClaims).where(and(eq(paymentClaims.userId, userId), eq(paymentClaims.status, 'pending')));
        if (pending) throw conflict('You already have a payment being checked. Cancel it first if the details were wrong.');

        // The same screenshot can't back a second payment.
        const [sameImage] = await tx
          .select({ id: paymentClaims.id })
          .from(paymentClaims)
          .where(and(eq(paymentClaims.screenshotHash, shot.sha256), sql`${paymentClaims.status} in ('pending','confirmed')`));
        if (sameImage) throw duplicateTxnError();

        const [created] = await tx
          .insert(paymentClaims)
          .values({
            userId,
            txnId,
            userNote: body.note || null,
            screenshot: shot.buf,
            screenshotMimeType: shot.mimeType,
            screenshotSize: shot.buf.length,
            screenshotHash: shot.sha256,
            graceUntil: grace ? new Date(now.getTime() + GRACE_DAYS * DAY_MS) : null,
            forAccessEnd: access.planEnd,
          })
          .returning();
        return created;
      });
      res.status(201).json(claimView(claim));
    } catch (err) {
      if (isDuplicateTxn(err)) throw duplicateTxnError();
      throw err;
    }
  })
);

// Wrong ID or screenshot: cancel it and send it again. Frees the transaction ID.
router.post(
  '/claims/:id/cancel',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const [claim] = await db
      .update(paymentClaims)
      .set({ status: 'cancelled', decidedAt: new Date() })
      .where(and(eq(paymentClaims.id, id), eq(paymentClaims.userId, req.userId!), eq(paymentClaims.status, 'pending')))
      .returning();
    if (!claim) throw notFound('No payment waiting to be checked with that number.');
    res.json(claimView(claim));
  })
);

export default router;
