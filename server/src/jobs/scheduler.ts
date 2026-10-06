import { runIssueDigestExclusive } from './issueDigest';
import { purgeExpiredScreenshots } from '../lib/issuePrivacy';

// In-process nightly jobs — no cron daemon or extra container needed. Fires
// daily at ISSUE_DIGEST_TIME (HH:MM, server-local time — set TZ, e.g.
// Asia/Kolkata). Always deletes expired issue-report screenshots (retention,
// lib/issuePrivacy.ts); also runs the issue digest when
// ISSUE_DIGEST_ENABLED=true. The advisory lock in runIssueDigestExclusive
// keeps the digest to one send even if several server replicas run this.

/** Milliseconds from `now` until the next HH:MM local time (tomorrow if it has already passed today). */
export const msUntilNext = (now: Date, hour: number, minute: number): number => {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
};

export const parseDigestTime = (value: string | undefined): { hour: number; minute: number } => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!m) return { hour: 2, minute: 0 };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : { hour: 2, minute: 0 };
};

/** One night's work: screenshot retention always, then the digest if it's switched on. */
export const runNightlyJobs = async (now: Date = new Date()): Promise<void> => {
  const purged = await purgeExpiredScreenshots(now);
  if (purged > 0) console.log(`[retention] removed ${purged} expired issue-report screenshot(s)`);
  if (process.env.ISSUE_DIGEST_ENABLED === 'true') await runIssueDigestExclusive({ now });
};

export const startNightlyJobs = (): (() => void) => {
  const { hour, minute } = parseDigestTime(process.env.ISSUE_DIGEST_TIME);
  let timer: NodeJS.Timeout;

  const scheduleNext = () => {
    const delay = msUntilNext(new Date(), hour, minute);
    console.log(`[nightly] next run at ${new Date(Date.now() + delay).toString()}`);
    timer = setTimeout(async () => {
      try {
        await runNightlyJobs();
      } catch (err) {
        console.error('[nightly] run failed — will retry next night:', err);
      } finally {
        scheduleNext();
      }
    }, delay);
    timer.unref();
  };

  scheduleNext();
  return () => clearTimeout(timer);
};
