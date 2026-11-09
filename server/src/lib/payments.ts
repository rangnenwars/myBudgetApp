import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { accessGrants, paymentClaims, users } from '../db/schema';
import { addMonths } from './access';
import { badRequest, conflict } from './errors';
import { Plan } from './plan';

// Paying for the plan: a user sends their transaction ID and a screenshot, an
// admin checks the money arrived and confirms. Confirming adds a paid period
// that starts when the current one ends, so renewing early never loses time.

/** How long access carries on while a payment is being checked: once per access period. */
export const GRACE_DAYS = 3;
/** Payment submissions one user can send in a day (counting cancelled and rejected ones). */
export const CLAIMS_PER_DAY = 3;

/**
 * A transaction ID as stored: letters and digits, upper case. UPI reference
 * numbers (UTR) are 12 digits; some apps also show longer ones with letters.
 * Returns null when it can't be one.
 */
export const normalizeTxnId = (raw: string): string | null => {
  const id = raw.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{8,35}$/.test(id) ? id : null;
};

/** Last 4 characters only: enough for a user to recognise their payment, not to reuse it. */
export const maskTxnId = (id: string): string => `…${id.slice(-4)}`;

/** Grace is given once per access period: not when an earlier claim already got it for the same end date. */
export const graceAllowed = (previous: { graceUntil: Date | null; forAccessEnd: Date | null }[], planEnd: Date | null): boolean =>
  !previous.some((c) => c.graceUntil != null && (c.forAccessEnd?.getTime() ?? null) === (planEnd?.getTime() ?? null));

/** Where a new paid period starts: when the current one ends, or now if it already has. */
export const renewalStart = (planEnd: Date | null, now: Date): Date => (planEnd && planEnd > now ? planEnd : now);

/** The end of a paid period of this plan's length. */
export const paidPeriodEnd = (start: Date, plan: Pick<Plan, 'period'>): Date => addMonths(start, plan.period === 'year' ? 12 : 1);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Records a received payment as a paid period for the user, inside the caller's
 * transaction. The user row is locked first, so two admins confirming at once
 * can't both start from the same end date.
 */
export const addPaidPeriod = async (
  tx: Tx,
  input: { userId: number; amountInr: number; txnId: string; plan: Plan; adminId: number; now: Date }
): Promise<{ grantId: number; startsAt: Date; endsAt: Date }> => {
  if (input.amountInr < input.plan.price_inr) {
    throw badRequest(`The amount is below the plan price of ₹${input.plan.price_inr}.`);
  }
  await tx.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).for('update');
  const [{ end }] = await tx
    .select({ end: sql<Date | null>`max(${accessGrants.endsAt})` })
    .from(accessGrants)
    .where(and(eq(accessGrants.userId, input.userId), inArray(accessGrants.kind, ['trial', 'paid']), isNull(accessGrants.revokedAt)));
  const startsAt = renewalStart(end ? new Date(end) : null, input.now);
  const endsAt = paidPeriodEnd(startsAt, input.plan);
  const [grant] = await tx
    .insert(accessGrants)
    .values({
      userId: input.userId,
      kind: 'paid',
      startsAt,
      endsAt,
      amountInr: input.amountInr,
      priceInr: input.plan.price_inr,
      txnId: input.txnId,
      grantedBy: input.adminId,
    })
    .returning({ id: accessGrants.id });
  return { grantId: grant.id, startsAt, endsAt };
};

/** True when this error is the unique index refusing a transaction ID that already backs a live claim. */
export const isDuplicateTxn = (err: unknown): boolean => {
  const e = err as { cause?: { code?: string; constraint?: string }; code?: string; constraint?: string };
  return (e.cause?.code ?? e.code) === '23505' && (e.cause?.constraint ?? e.constraint) === 'idx_payment_claims_txn_live';
};

export const duplicateTxnError = () => conflict('This transaction ID has already been used for a payment. Check the ID, or contact support.');

/** Payment screenshots show a person's payment app: remove them 30 days after the payment was decided. The ID, amount and who confirmed it stay. */
export const purgeClaimScreenshots = async (now: Date = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await db
    .update(paymentClaims)
    .set({ screenshot: null, screenshotMimeType: null, screenshotSize: null })
    .where(and(sql`${paymentClaims.screenshot} is not null`, sql`${paymentClaims.decidedAt} < ${cutoff.toISOString()}::timestamptz`))
    .returning({ id: paymentClaims.id });
  return rows.length;
};

export { paymentClaims };
