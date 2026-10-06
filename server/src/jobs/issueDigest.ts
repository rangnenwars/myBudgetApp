// Nightly issue digest: (1) analyse the whole issue_reports stack, (2) pick
// the reports not yet emailed, (3) write a fix suggestion for each from the
// server's own rules (lib/issueSuggestions.ts — nothing goes to an outside
// service), and (4) email them to the developer, ranked by priority. Rows are
// marked notified only after the email is accepted by SMTP, so a failed send
// is retried the next night.
//
// Scheduled by jobs/scheduler.ts; run by hand with `npm run issues:digest`.

import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { issueReports, users } from '../db/schema';
import { analyzeIssues, IssueAnalysisReport, IssueRecord } from '../lib/issueAnalysis';
import { FixSuggestion, IssueForSuggestion, suggestFix } from '../lib/issueSuggestions';
import { mailerConfigured, sendMail, SendMail, MailMessage } from '../lib/mailer';
import { digestAttachesScreenshots, digestShowsReporter } from '../lib/issuePrivacy';
import { ISSUE_CATEGORIES, ISSUE_SCREENS, ISSUE_SEVERITIES } from '../../../constants/issues';

const STACK_WINDOW_DAYS = 180;
// Gmail rejects messages over 25 MB; leave headroom for base64 inflation.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
// Arbitrary key shared by every server process, so two replicas (or the
// scheduler plus a manual run) never send the same digest twice.
const DIGEST_LOCK_KEY = 726_001;

export interface DigestOptions {
  /** Analyse and print the email, but don't send or write anything. */
  dryRun?: boolean;
  now?: Date;
  send?: SendMail;
  /** Restrict which pending reports are emailed (the analysis still covers the whole stack) — lets tests on a shared database touch only their own rows. */
  onlyIssueIds?: number[];
  log?: (line: string) => void;
}

export interface DigestResult {
  analyzed: number;
  newIssues: number;
  emailed: boolean;
  recipients: string[];
  skippedReason?: string;
  report: IssueAnalysisReport;
  message?: MailMessage;
}

interface StoredAnalysis {
  insight: IssueAnalysisReport['perIssue'][number];
  fix: FixSuggestion;
  analyzedAt: string;
}

/** Every report from the last 180 days plus any older one still waiting to be emailed — without screenshot bytes. */
export const loadIssueStack = async (now: Date): Promise<IssueRecord[]> => {
  const since = new Date(now.getTime() - STACK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: issueReports.id,
      category: issueReports.category,
      severity: issueReports.severity,
      screen: issueReports.screen,
      title: issueReports.title,
      description: issueReports.description,
      stepsToReproduce: issueReports.stepsToReproduce,
      platform: issueReports.platform,
      appVersion: issueReports.appVersion,
      status: issueReports.status,
      screenshotMimeType: issueReports.screenshotMimeType,
      createdAt: issueReports.createdAt,
      notifiedAt: issueReports.notifiedAt,
    })
    .from(issueReports)
    .where(or(gte(issueReports.createdAt, since), isNull(issueReports.notifiedAt)))
    .orderBy(desc(issueReports.createdAt));
  return rows.map(({ screenshotMimeType, ...r }) => ({ ...r, hasScreenshot: screenshotMimeType !== null }));
};

const digestRecipients = async (): Promise<string[]> => {
  const configured = (process.env.ISSUE_DIGEST_TO ?? '')
    .split(',')
    .map((e: string) => e.trim())
    .filter((e: string) => e.length > 0);
  if (configured.length) return configured;
  // No explicit recipient — fall back to the active admins.
  const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  return admins.map((a) => a.email);
};

// ---------- email rendering ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Keeps multi-line user text aligned under its label in the plain-text email. */
const indent = (s: string) => s.replace(/\n/g, '\n    ');
const labelOf = (list: readonly { key: string; label: string }[], key: string) => list.find((i) => i.key === key)?.label ?? key;
const PRIORITY_COLOR: Record<string, string> = { P1: '#B91C1C', P2: '#C2410C', P3: '#A16207', P4: '#4B5563' };

interface DigestItem {
  issue: IssueForSuggestion & { reporterId: number; reporterEmail: string };
  analysis: StoredAnalysis;
}

/** Who filed it — the email only when ISSUE_DIGEST_SHOW_REPORTER=true; otherwise just the account id. */
const reporterLabel = (issue: DigestItem['issue']) => (digestShowsReporter() ? issue.reporterEmail : `user #${issue.reporterId}`);

const countsLine = (entries: { key: string; count: number }[], list?: readonly { key: string; label: string }[]) =>
  entries.map((e) => `${list ? labelOf(list, e.key) : e.key} ${e.count}`).join(' · ') || '—';

export const renderDigest = (items: DigestItem[], report: IssueAnalysisReport, recipients: string[]): MailMessage => {
  const p1 = items.filter((i) => i.analysis.insight.priority === 'P1').length;
  const subject = `[My Budget] ${items.length} new issue report${items.length === 1 ? '' : 's'}${p1 ? ` — ${p1} P1` : ''}`;
  const t = report.totals;
  const trend = t.weekOverWeekPct === null ? 'n/a' : `${t.weekOverWeekPct >= 0 ? '+' : ''}${t.weekOverWeekPct}%`;

  const statsText = [
    `Stack analysis (${report.generatedAt.slice(0, 10)}): ${t.all} reports in window, ${t.open} open, ${t.resolved} resolved.`,
    `Last 7 days: ${t.last7Days} (previous 7: ${t.previous7Days}, ${trend}).`,
    `By category: ${countsLine(report.byCategory, ISSUE_CATEGORIES)}`,
    `By severity: ${countsLine(report.bySeverity, ISSUE_SEVERITIES)}`,
    `By platform: ${countsLine(report.byPlatform)}`,
    `Hotspots: ${report.hotspots.map((h) => `${labelOf(ISSUE_SCREENS, h.screen)} (${h.open} open, ${h.highSeverity} high+)`).join(' · ') || '—'}`,
    `Duplicate clusters: ${report.clusters.map((c) => `[${c.label}] #${c.ids.join(', #')}`).join(' · ') || 'none'}`,
    `Recurring errors: ${report.errorSignatures.slice(0, 5).map((e) => `${e.signature} ×${e.count}`).join(' · ') || 'none'}`,
    ...(report.newVersionSpikes.length ? [`New-version spikes: ${countsLine(report.newVersionSpikes)}`] : []),
  ];

  const attachments: NonNullable<MailMessage['attachments']> = [];
  let attachedBytes = 0;

  const itemText = items.map(({ issue, analysis }) => {
    const fix = analysis.fix;
    return [
      `#${issue.id} [${analysis.insight.priority}] ${issue.title}`,
      `  ${labelOf(ISSUE_CATEGORIES, issue.category)} · ${labelOf(ISSUE_SEVERITIES, issue.severity)} · ${labelOf(ISSUE_SCREENS, issue.screen)} · ${issue.platform ?? '?'} ${issue.appVersion ?? ''} · ${issue.createdAt.toISOString()}`,
      `  Reporter: ${reporterLabel(issue)}`,
      `  What happened: ${indent(issue.description)}`,
      ...(issue.stepsToReproduce ? [`  Steps: ${indent(issue.stepsToReproduce)}`] : []),
      ...(issue.expectedBehavior ? [`  Expected: ${indent(issue.expectedBehavior)}`] : []),
      ...(analysis.insight.similarIssueIds.length ? [`  Similar to: #${analysis.insight.similarIssueIds.join(', #')}`] : []),
      `  Suggested fix:`,
      ...fix.suggestedFix.split('\n').map((l) => `    ${l}`),
    ].join('\n');
  });

  const itemHtml = items.map(({ issue, analysis }) => {
    const fix = analysis.fix;
    let shot = '';
    if (issue.hasScreenshot && !digestAttachesScreenshots()) {
      shot = `<p style="color:#666">Has a screenshot — not attached (it may show the user's balances). An admin can view it: GET /api/v1/issues/${issue.id}/screenshot</p>`;
    } else if (issue.screenshot && issue.screenshotMimeType) {
      if (attachedBytes + issue.screenshot.length <= MAX_ATTACHMENT_BYTES) {
        attachedBytes += issue.screenshot.length;
        const cid = `issue-${issue.id}@mybudget`;
        const ext = issue.screenshotMimeType.split('/')[1];
        attachments.push({ filename: `issue-${issue.id}.${ext}`, content: issue.screenshot, contentType: issue.screenshotMimeType, cid });
        shot = `<p><img src="cid:${cid}" alt="Screenshot for #${issue.id}" style="max-width:360px;border:1px solid #ddd;border-radius:6px"></p>`;
      } else {
        shot = `<p style="color:#666">Screenshot too large to attach with the rest — an admin can view it: GET /api/v1/issues/${issue.id}/screenshot</p>`;
      }
    }
    const row = (k: string, v: string | null) => (v ? `<tr><td style="color:#666;padding-right:8px;vertical-align:top">${k}</td><td>${esc(v)}</td></tr>` : '');
    return `
<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;margin:16px 0">
  <h3 style="margin:0 0 4px"><span style="background:${PRIORITY_COLOR[analysis.insight.priority]};color:#fff;border-radius:4px;padding:1px 6px;font-size:12px">${analysis.insight.priority}</span> #${issue.id} ${esc(issue.title)}</h3>
  <p style="margin:0 0 8px;color:#555;font-size:13px">${esc(labelOf(ISSUE_CATEGORIES, issue.category))} · ${esc(labelOf(ISSUE_SEVERITIES, issue.severity))} · ${esc(labelOf(ISSUE_SCREENS, issue.screen))} · ${esc(issue.platform ?? '?')} ${esc(issue.appVersion ?? '')} · ${issue.createdAt.toISOString()} · ${esc(reporterLabel(issue))}</p>
  <table style="font-size:14px">
    ${row('What happened', issue.description)}
    ${row('Steps', issue.stepsToReproduce)}
    ${row('Expected', issue.expectedBehavior)}
    ${row('Device', issue.deviceInfo)}
    ${row('Similar to', analysis.insight.similarIssueIds.length ? `#${analysis.insight.similarIssueIds.join(', #')}` : null)}
    ${row('Error signatures', analysis.insight.errorSignatures.join(', ') || null)}
  </table>
  ${shot}
  <div style="background:#f0fdf4;border-left:3px solid #10b981;padding:8px 12px;margin-top:8px">
    <strong>Suggested fix</strong>
    <pre style="white-space:pre-wrap;font-family:inherit;margin:6px 0">${esc(fix.suggestedFix)}</pre>
  </div>
</div>`;
  });

  const text = [`${items.length} new issue report(s), highest priority first.`, '', ...statsText, '', ...itemText.flatMap((t) => [t, ''])].join('\n');
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;color:#111">
<h2 style="margin-bottom:4px">${items.length} new issue report${items.length === 1 ? '' : 's'}</h2>
<p style="color:#555;margin-top:0">Highest priority first. Suggestions are worked out from the analysis below.</p>
<div style="background:#f9fafb;border-radius:8px;padding:8px 16px;font-size:13px">${statsText.map((l) => `<p style="margin:4px 0">${esc(l)}</p>`).join('')}</div>
${itemHtml.join('')}
</div>`;

  return { to: recipients.join(', '), subject, text, html, attachments };
};

// ---------- the job ----------

export const runIssueDigest = async (opts: DigestOptions = {}): Promise<DigestResult> => {
  const now = opts.now ?? new Date();
  const log = opts.log ?? ((l: string) => console.log(`[issue-digest] ${l}`));
  const send = opts.send ?? sendMail;

  // 1. Analyse the whole stack first, so every new issue is judged in context.
  const stack = await loadIssueStack(now);
  const report = analyzeIssues(stack, now);
  log(`analysed ${stack.length} reports: ${report.totals.open} open, ${report.clusters.length} duplicate clusters, ${report.hotspots.length} hotspot screens`);

  // 2. New = not yet emailed. Highest priority first, capped so one night can't run away.
  const max = Number(process.env.ISSUE_DIGEST_MAX) || 25;
  const pending = stack
    .filter((i) => i.notifiedAt === null && (!opts.onlyIssueIds || opts.onlyIssueIds.includes(i.id)))
    .sort((a, b) => report.perIssue[b.id].priorityScore - report.perIssue[a.id].priorityScore || a.id - b.id)
    .slice(0, max);
  const result: DigestResult = { analyzed: stack.length, newIssues: pending.length, emailed: false, recipients: [], report };
  if (pending.length === 0) {
    log('no new issues — nothing to send');
    return { ...result, skippedReason: 'no new issues' };
  }

  const needScreenshotBytes = digestAttachesScreenshots();
  const full = await db
    .select({
      id: issueReports.id,
      expectedBehavior: issueReports.expectedBehavior,
      deviceInfo: issueReports.deviceInfo,
      // The bytes are only read when the email is allowed to attach them.
      screenshot: needScreenshotBytes ? issueReports.screenshot : sql<Buffer | null>`NULL`,
      screenshotMimeType: issueReports.screenshotMimeType,
      reporterId: issueReports.userId,
      reporterEmail: users.email,
    })
    .from(issueReports)
    .innerJoin(users, eq(users.id, issueReports.userId))
    .where(inArray(issueReports.id, pending.map((p) => p.id)));
  const byId = new Map(full.map((f) => [f.id, f]));

  // 3. One suggestion per issue, from the server's rules.
  const items: DigestItem[] = [];
  for (const base of pending) {
    const extra = byId.get(base.id);
    if (!extra) continue; // deleted between the two queries
    const issue = { ...base, ...extra };
    const insight = report.perIssue[base.id];
    const fix: FixSuggestion = suggestFix(issue, insight);
    const analysis: StoredAnalysis = { insight, fix, analyzedAt: now.toISOString() };
    items.push({ issue, analysis });

    if (!opts.dryRun) {
      await db
        .update(issueReports)
        .set({ analysis, suggestion: fix.suggestedFix, status: issue.status === 'new' ? 'triaged' : issue.status, updatedAt: now })
        .where(eq(issueReports.id, issue.id));
    }
  }

  // 4. Email.
  const recipients = await digestRecipients();
  const message = renderDigest(items, report, recipients);
  result.recipients = recipients;
  result.message = message;

  if (opts.dryRun) {
    log(`dry run — would email ${recipients.join(', ') || '(no recipient)'}:\n\n${message.subject}\n\n${message.text}`);
    return { ...result, skippedReason: 'dry run' };
  }
  if (recipients.length === 0) {
    log('no recipient — set ISSUE_DIGEST_TO (or create an admin account); will retry next run');
    return { ...result, skippedReason: 'no recipient' };
  }
  if (!opts.send && !mailerConfigured()) {
    // Only the subject: the body carries users' report text, and this line ends up in the container log.
    log(`SMTP not configured — not sent, issues stay pending: "${message.subject}". Run with --dry-run to see the full email.`);
    return { ...result, skippedReason: 'smtp not configured' };
  }

  await send(message);
  await db
    .update(issueReports)
    .set({ notifiedAt: now })
    .where(inArray(issueReports.id, items.map((i) => i.issue.id)));
  log(`emailed ${items.length} issue(s) to ${recipients.join(', ')}`);
  return { ...result, emailed: true };
};

/** runIssueDigest behind a Postgres advisory lock — returns null if another process is already running it. */
export const runIssueDigestExclusive = async (opts: DigestOptions = {}): Promise<DigestResult | null> => {
  const conn = await pool.connect();
  try {
    const { rows } = await conn.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [DIGEST_LOCK_KEY]);
    if (!rows[0].locked) {
      (opts.log ?? console.log)('[issue-digest] another run holds the lock — skipping');
      return null;
    }
    try {
      return await runIssueDigest(opts);
    } finally {
      await conn.query('SELECT pg_advisory_unlock($1)', [DIGEST_LOCK_KEY]);
    }
  } finally {
    conn.release();
  }
};
