import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { accessGrants, paymentClaims, users } from '../db/schema';
import { Plan } from './plan';

// Who has the plan right now. One rule, worked out on the server on every
// request, so the app can only display it, never decide it:
//
//   1. company account            -> always yes, never charged
//   2. an exception (not revoked) -> yes, until its end date (or no end)
//   3. a paid period running      -> yes
//   4. the free trial running     -> yes
//   5. a payment waiting to be confirmed, with grace still running -> yes (a short hold)
//   6. otherwise                  -> locked. The user's data is never touched.
//
// "Deactivated account" is checked at sign-in, as before. Staff can also
// switch one feature off for one user (user_features.denied); that is applied
// in lib/features.ts on top of this.

export type AccessState = 'company' | 'exception' | 'paid' | 'trial' | 'grace' | 'none';

export interface GrantRow {
  kind: 'trial' | 'paid' | 'exception';
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
}

export interface Access {
  state: AccessState;
  /** When the current access ends; null for company accounts and an exception with no end. */
  until: Date | null;
  /** Whole days left, rounded up (1 = ends today or tomorrow); null when there is no end. */
  daysLeft: number | null;
  /** The latest end of any trial or paid period, even a past one: where a renewal starts from. */
  planEnd: Date | null;
  /** Access that has run out: the last end date, so the app can say "ended on…". */
  endedOn: Date | null;
}

const DAY_MS = 86_400_000;

/** `n` calendar months after `from`, in UTC (so 31 Aug + 6 months is 28 Feb, not 3 Mar). */
export const addMonths = (from: Date, n: number): Date => {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
};

// A few minutes of slack: a grant stamped by the database clock (a trial starts at sign-up) is never read as "not started yet" because this server's clock is a moment behind.
const SKEW_MS = 5 * 60_000;
const live = (g: GrantRow, now: Date) => !g.revokedAt && g.startsAt.getTime() <= now.getTime() + SKEW_MS && (g.endsAt == null || g.endsAt > now);

/**
 * The pure rule. `kind` is the account type, `grants` all the user's grants,
 * `graceUntil` the latest grace end among their pending payment claims.
 */
export const computeAccess = (input: { kind: 'customer' | 'company'; grants: GrantRow[]; graceUntil?: Date | null; now?: Date }): Access => {
  const now = input.now ?? new Date();
  const daysLeft = (until: Date | null) => (until ? Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS)) : null);
  const plan = input.grants.filter((g) => !g.revokedAt && g.kind !== 'exception' && g.endsAt);
  const planEnd = plan.reduce<Date | null>((best, g) => (!best || g.endsAt! > best ? g.endsAt! : best), null);
  const result = (state: AccessState, until: Date | null): Access => ({
    state,
    until,
    daysLeft: daysLeft(until),
    planEnd,
    endedOn: state === 'none' ? planEnd : null,
  });

  if (input.kind === 'company') return result('company', null);

  const exceptions = input.grants.filter((g) => g.kind === 'exception' && live(g, now));
  if (exceptions.length > 0) {
    // No end date beats any end date; otherwise the latest end.
    const open = exceptions.some((g) => g.endsAt == null);
    return result('exception', open ? null : exceptions.reduce((m, g) => (g.endsAt! > m ? g.endsAt! : m), exceptions[0].endsAt!));
  }
  const paid = input.grants.filter((g) => g.kind === 'paid' && live(g, now));
  if (paid.length > 0) return result('paid', paid.reduce((m, g) => (g.endsAt! > m ? g.endsAt! : m), paid[0].endsAt!));
  const trial = input.grants.filter((g) => g.kind === 'trial' && live(g, now));
  if (trial.length > 0) return result('trial', trial.reduce((m, g) => (g.endsAt! > m ? g.endsAt! : m), trial[0].endsAt!));
  if (input.graceUntil && input.graceUntil > now) return result('grace', input.graceUntil);
  return result('none', null);
};

/** A user's access, read fresh from the database. */
export const getAccess = async (userId: number, now: Date = new Date()): Promise<Access> => {
  const [user] = await db.select({ kind: users.accountKind }).from(users).where(eq(users.id, userId));
  if (!user) return computeAccess({ kind: 'customer', grants: [], now });
  if (user.kind === 'company') return computeAccess({ kind: 'company', grants: [], now });
  const [grants, [grace]] = await Promise.all([
    db
      .select({ kind: accessGrants.kind, startsAt: accessGrants.startsAt, endsAt: accessGrants.endsAt, revokedAt: accessGrants.revokedAt })
      .from(accessGrants)
      .where(eq(accessGrants.userId, userId)),
    db
      .select({ until: sql<Date | null>`max(${paymentClaims.graceUntil})` })
      .from(paymentClaims)
      .where(and(eq(paymentClaims.userId, userId), eq(paymentClaims.status, 'pending'), gt(paymentClaims.graceUntil, sql`${now.toISOString()}::timestamptz`))),
  ]);
  return computeAccess({ kind: 'customer', grants, graceUntil: grace?.until ? new Date(grace.until) : null, now });
};

/** What the app is told about the plan: enough to show the state, never to decide it. */
export const planSummary = (access: Access, plan: Plan) => ({
  enforced: plan.enforced,
  state: access.state,
  until: access.until ? access.until.toISOString() : null,
  days_left: access.daysLeft,
  ended_on: access.endedOn ? access.endedOn.toISOString() : null,
  price_inr: plan.price_inr,
  period: plan.period,
  features: plan.features,
});

/**
 * The tier the app sees. Until enforcement is on it is the stored tier, as
 * before. Once on, Pro means the plan is running AND staff haven't set the
 * account to Standard on purpose.
 */
export const effectiveTier = (storedTier: string, access: Access, plan: Plan): 'standard' | 'pro' => {
  if (!plan.enforced) return storedTier === 'standard' ? 'standard' : 'pro';
  return storedTier !== 'standard' && access.state !== 'none' ? 'pro' : 'standard';
};

/** Gives a new account its free period, counted from `startsAt`. */
export const createTrialGrant = async (userId: number, startsAt: Date, trialMonths: number, exec: Pick<typeof db, 'insert'> = db) => {
  await exec.insert(accessGrants).values({ userId, kind: 'trial', startsAt, endsAt: addMonths(startsAt, trialMonths) });
};

/** Active exceptions, newest first, for one user. */
export const activeException = async (userId: number, now: Date = new Date()) => {
  const [row] = await db
    .select()
    .from(accessGrants)
    .where(and(eq(accessGrants.userId, userId), eq(accessGrants.kind, 'exception'), isNull(accessGrants.revokedAt), or(isNull(accessGrants.endsAt), gt(accessGrants.endsAt, now))))
    .orderBy(desc(accessGrants.createdAt))
    .limit(1);
  return row ?? null;
};

