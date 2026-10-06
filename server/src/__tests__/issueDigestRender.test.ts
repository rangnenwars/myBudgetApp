import request from 'supertest';
import { app, registerUser, promoteToAdmin } from './helpers';
import { pool } from '../db/client';
import { renderDigest, runIssueDigest, runIssueDigestExclusive } from '../jobs/issueDigest';
import { analyzeIssues } from '../lib/issueAnalysis';
import { FixSuggestion, IssueForSuggestion } from '../lib/issueSuggestions';
import { MailMessage } from '../lib/mailer';

const NOW = new Date('2026-10-03T02:00:00Z');
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const issue = (id: number, over: Partial<IssueForSuggestion> = {}) => ({
  id,
  category: 'data',
  severity: 'high',
  screen: 'loans',
  title: 'Loan EMI total wrong',
  description: 'The EMI total for my home loan shows the wrong amount\nsecond line',
  stepsToReproduce: '1. Open Loans\n2. Tap home loan',
  expectedBehavior: 'Matches the bank',
  platform: 'android',
  appVersion: '1.1.0',
  deviceInfo: 'android · 34',
  status: 'new',
  hasScreenshot: true,
  screenshot: Buffer.alloc(1024),
  screenshotMimeType: 'image/png',
  createdAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
  notifiedAt: null,
  reporterId: 42,
  reporterEmail: 'reporter@example.com',
  ...over,
});

const ruleFix: FixSuggestion = { suggestedFix: '1. Round once\n2. Add a test' };

describe('renderDigest', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  const build = () => {
    const a = issue(1);
    const b = issue(2, { title: 'EMI amount wrong on loans', description: 'Home loan EMI amount is wrong after part payment' });
    const report = analyzeIssues([a, b], NOW);
    const items = [a, b].map((i) => ({ issue: i, analysis: { insight: report.perIssue[i.id], fix: ruleFix, analyzedAt: NOW.toISOString() } }));
    return { items, report };
  };

  it('summarises the stack analysis, then each issue with its full suggestion', () => {
    const { items, report } = build();
    const m = renderDigest(items, report, ['dev@example.com', 'ops@example.com']);
    expect(m.to).toBe('dev@example.com, ops@example.com');
    expect(m.subject).toMatch(/2 new issue reports/);
    const text = String(m.text);
    expect(text).toMatch(/Duplicate clusters: \[.*\] #1, #2/);
    expect(text).toContain('New-version spikes: 1.1.0 2');
    expect(text).toContain('Similar to: #2');
    expect(text).toContain('Suggested fix:\n    1. Round once\n    2. Add a test');
    expect(text).toContain('wrong amount\n    second line'); // multi-line text stays indented under its label
    expect(String(m.html)).toContain('1. Round once');
  });

  it('by default names the reporter by id and attaches no screenshots', () => {
    const { items, report } = build();
    const m = renderDigest(items, report, ['dev@example.com']);
    expect(m.attachments).toHaveLength(0);
    expect(String(m.text)).toContain('Reporter: user #42');
    expect(`${m.text}${m.html}`).not.toContain('reporter@example.com');
  });

  it('when opted in, attaches screenshots until 15 MB, then links the rest', () => {
    process.env.ISSUE_DIGEST_ATTACH_SCREENSHOTS = 'true';
    const big = issue(3, { screenshot: Buffer.alloc(10 * 1024 * 1024) });
    const big2 = issue(4, { screenshot: Buffer.alloc(10 * 1024 * 1024), title: 'Another one' });
    const report = analyzeIssues([big, big2], NOW);
    const items = [big, big2].map((i) => ({ issue: i, analysis: { insight: report.perIssue[i.id], fix: ruleFix, analyzedAt: '' } }));
    const m = renderDigest(items, report, ['dev@example.com']);
    expect(m.attachments).toHaveLength(1);
    expect(String(m.html)).toContain('Screenshot too large to attach with the rest');
  });

  it('handles a report with no optional fields and a rule-based suggestion', () => {
    const bare = issue(5, { stepsToReproduce: null, expectedBehavior: null, deviceInfo: null, platform: null, appVersion: null, hasScreenshot: false, screenshot: null, screenshotMimeType: null });
    const report = analyzeIssues([bare], NOW);
    const fix: FixSuggestion = { suggestedFix: 'Check the loan screen' };
    const m = renderDigest([{ issue: bare, analysis: { insight: report.perIssue[5], fix, analyzedAt: '' } }], report, ['dev@example.com']);
    expect(m.subject).toMatch(/^\[My Budget\] 1 new issue report( —|$)/);
    expect(String(m.text)).toContain('Suggested fix:\n    Check the loan screen');
    expect(String(m.text)).not.toContain('Steps:');
    expect(String(m.text)).toContain('Duplicate clusters: none');
  });
});

describe('digest recipients and locking', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('falls back to every active admin when ISSUE_DIGEST_TO is unset', async () => {
    delete process.env.ISSUE_DIGEST_TO;
    const admin = await registerUser();
    await promoteToAdmin(admin.user.id);
    const { accessToken } = await registerUser();
    const created = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ category: 'ui', severity: 'low', screen: 'goals', title: 'Goal bar overflows', description: 'The bar goes past the card edge.' });
    const sent: MailMessage[] = [];
    const result = await runIssueDigest({ onlyIssueIds: [created.body.id], send: async (m) => void sent.push(m), log: () => {} });
    expect(result.recipients).toContain(admin.user.email);
  });

  it('skips a run while another process holds the digest lock', async () => {
    const holder = await pool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(726001)');
      const lines: string[] = [];
      expect(await runIssueDigestExclusive({ dryRun: true, log: (l) => lines.push(l) })).toBeNull();
      expect(lines.join('\n')).toMatch(/holds the lock/);
    } finally {
      await holder.query('SELECT pg_advisory_unlock(726001)');
      holder.release();
    }
  });

  it('runs when the lock is free, and releases it afterwards', async () => {
    const first = await runIssueDigestExclusive({ dryRun: true, onlyIssueIds: [-1], log: () => {} });
    expect(first?.skippedReason).toBe('no new issues');
    const second = await runIssueDigestExclusive({ dryRun: true, onlyIssueIds: [-1], log: () => {} });
    expect(second).not.toBeNull();
  });
});
