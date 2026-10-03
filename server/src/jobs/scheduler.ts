import { runIssueDigestExclusive } from './issueDigest';

// In-process nightly scheduler for the issue digest — no cron daemon or extra
// container needed. Off unless ISSUE_DIGEST_ENABLED=true; fires daily at
// ISSUE_DIGEST_TIME (HH:MM, server-local time — set TZ, e.g. Asia/Kolkata).
// The advisory lock in runIssueDigestExclusive keeps it to one send even if
// several server replicas run this scheduler.

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

export const startIssueDigestSchedule = (): (() => void) | null => {
  if (process.env.ISSUE_DIGEST_ENABLED !== 'true') return null;
  const { hour, minute } = parseDigestTime(process.env.ISSUE_DIGEST_TIME);
  let timer: NodeJS.Timeout;

  const scheduleNext = () => {
    const delay = msUntilNext(new Date(), hour, minute);
    console.log(`[issue-digest] next run at ${new Date(Date.now() + delay).toString()}`);
    timer = setTimeout(async () => {
      try {
        await runIssueDigestExclusive();
      } catch (err) {
        console.error('[issue-digest] run failed — will retry next night:', err);
      } finally {
        scheduleNext();
      }
    }, delay);
    timer.unref();
  };

  scheduleNext();
  return () => clearTimeout(timer);
};
