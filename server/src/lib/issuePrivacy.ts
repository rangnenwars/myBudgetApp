// What of a user's issue report may leave the database, and for how long its
// screenshot is kept. A screenshot of a budgeting app shows the user's own
// balances, and the reporter's email identifies them, so by default neither
// goes in the nightly digest email — each needs an explicit opt-in. Reports
// are never sent to any outside service. Read per call so tests (and an
// operator restart) can change them.

import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { issueReports } from '../db/schema';

const flag = (name: string) => process.env[name] === 'true';

/** Put the reporter's email in the digest email (default: "user #id" only). */
export const digestShowsReporter = () => flag('ISSUE_DIGEST_SHOW_REPORTER');
/** Attach screenshots to the digest email (default: a note that one exists). */
export const digestAttachesScreenshots = () => flag('ISSUE_DIGEST_ATTACH_SCREENSHOTS');

/** Days a screenshot is kept after its report is resolved or closed. */
export const screenshotRetentionDays = (): number => {
  const raw = process.env.ISSUE_SCREENSHOT_RETENTION_DAYS?.trim();
  // Unset or blank (compose passes "" for an unset variable) means the default, not 0.
  const days = raw ? Number(raw) : NaN;
  return Number.isFinite(days) && days >= 0 ? days : 90;
};

/** Drops screenshots of reports resolved/closed more than the retention period ago; the report text stays. Returns how many were removed. */
export const purgeExpiredScreenshots = async (now: Date = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - screenshotRetentionDays() * 24 * 60 * 60 * 1000);
  const rows = await db
    .update(issueReports)
    .set({ screenshot: null, screenshotMimeType: null, screenshotSize: null })
    .where(and(inArray(issueReports.status, ['resolved', 'wont_fix']), lt(issueReports.updatedAt, cutoff), isNotNull(issueReports.screenshot)))
    .returning({ id: issueReports.id });
  return rows.length;
};
