import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { accessGrants, accessNotices, users } from '../db/schema';
import { ReminderKind, existingNoticeMail, reminderMail } from './accessMail';
import { sendAccountMail } from './accountMail';
import { getPlan, savePlan } from './plan';

// Reminder emails about the plan ending, each sent once. A user is told about
// the MOST URGENT stage they have reached; the gentler stages they skipped
// are recorded as suppressed, so someone who joins with 5 days left gets one
// email, not three, and a re-run never repeats any.

const DAY_MS = 86_400_000;
const STAGES: ReminderKind[] = ['d30', 'd7', 'd1', 'ended'];
const ENDED_WINDOW_DAYS = 30;

/** The stage an access end date has reached, or null when it is more than 30 days away or ended long ago. */
export const reminderStage = (end: Date, now: Date): ReminderKind | null => {
  const msLeft = end.getTime() - now.getTime();
  if (msLeft <= 0) return now.getTime() - end.getTime() <= ENDED_WINDOW_DAYS * DAY_MS ? 'ended' : null;
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  if (daysLeft <= 1) return 'd1';
  if (daysLeft <= 7) return 'd7';
  if (daysLeft <= 30) return 'd30';
  return null;
};

/** The stages gentler than `stage`, which are skipped when `stage` is sent. */
export const gentlerStages = (stage: ReminderKind): ReminderKind[] => STAGES.slice(0, STAGES.indexOf(stage));

const liveException = sql`exists (select 1 from access_grants x where x.user_id = ${users.id} and x.kind = 'exception' and x.revoked_at is null and x.starts_at <= now() and (x.ends_at is null or x.ends_at > now()))`;

/** Customers with a plan end date, with that date (the latest trial or paid end). Company accounts and exception holders are never included. */
const customersWithPlanEnd = async (userIds?: number[]) =>
  db
    .select({ id: users.id, email: users.email, name: users.name, planEnd: sql<Date>`max(${accessGrants.endsAt})` })
    .from(users)
    .innerJoin(accessGrants, eq(accessGrants.userId, users.id))
    .where(and(eq(users.accountKind, 'customer'), eq(users.isActive, true), isNull(accessGrants.revokedAt), sql`${accessGrants.kind} in ('trial','paid')`, sql`not ${liveException}`, userIds ? inArray(users.id, userIds) : undefined))
    .groupBy(users.id);

/** Sends the reminder each customer is due, once. Returns how many emails went. */
/** `userIds` limits a run to those accounts: the app passes nothing; tests use it to stay out of other tests' data. */
export const runAccessNotices = async (now: Date = new Date(), userIds?: number[]): Promise<number> => {
  const plan = await getPlan();
  // Reminders announce a rule: say nothing until it is actually in force.
  if (!plan.enforced) return 0;
  let sent = 0;
  for (const u of await customersWithPlanEnd(userIds)) {
    const end = new Date(u.planEnd);
    const stage = reminderStage(end, now);
    if (!stage) continue;
    const have = await db.select({ kind: accessNotices.kind }).from(accessNotices).where(and(eq(accessNotices.userId, u.id), eq(accessNotices.accessEnd, end)));
    if (have.some((h) => h.kind === stage)) continue;
    // A stage more urgent than this one already went out: nothing more to say yet.
    if (have.some((h) => STAGES.indexOf(h.kind as ReminderKind) > STAGES.indexOf(stage))) continue;
    try {
      await sendAccountMail(reminderMail(stage, u.email, end, plan));
      await db.insert(accessNotices).values({ userId: u.id, kind: stage, accessEnd: end }).onConflictDoNothing();
      const skipped = gentlerStages(stage).filter((k) => !have.some((h) => h.kind === k));
      if (skipped.length) await db.insert(accessNotices).values(skipped.map((kind) => ({ userId: u.id, kind, accessEnd: end, suppressed: true }))).onConflictDoNothing();
      sent++;
    } catch (err) {
      console.error(`[access] reminder to user ${u.id} failed:`, err);
    }
  }
  return sent;
};

/**
 * The notice to everyone who already has an account: access ends on THEIR date,
 * and that date is never less than the notice period from today (so an early
 * user is not locked the day enforcement starts). Safe to run again: nobody is
 * emailed twice for the same date.
 */
export const notifyExistingUsers = async (adminId: number, now: Date = new Date(), userIds?: number[]): Promise<{ emailed: number; extended: number; customers: number }> => {
  const plan = await getPlan();
  const floor = new Date(now.getTime() + plan.notice_days * DAY_MS);
  const extended = await db
    .update(accessGrants)
    .set({ endsAt: floor })
    .where(and(sql`${accessGrants.kind} = 'trial'`, isNull(accessGrants.revokedAt), sql`${accessGrants.endsAt} < ${floor.toISOString()}::timestamptz`, userIds ? inArray(accessGrants.userId, userIds) : undefined))
    .returning({ id: accessGrants.id });

  let emailed = 0;
  const customers = await customersWithPlanEnd(userIds);
  for (const u of customers) {
    const end = new Date(u.planEnd);
    const [already] = await db
      .select({ kind: accessNotices.kind })
      .from(accessNotices)
      .where(and(eq(accessNotices.userId, u.id), eq(accessNotices.kind, 'existing'), eq(accessNotices.accessEnd, end)));
    if (already) continue;
    try {
      await sendAccountMail(existingNoticeMail(u.email, u.name, end, plan));
      await db.insert(accessNotices).values({ userId: u.id, kind: 'existing', accessEnd: end }).onConflictDoNothing();
      emailed++;
    } catch (err) {
      console.error(`[access] notice to user ${u.id} failed:`, err);
    }
  }
  await savePlan({ existing_notice_at: now.toISOString() }, adminId);
  return { emailed, extended: extended.length, customers: customers.length };
};
