import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { app, registerUser, promoteToSupport, promoteToAdmin } from './helpers';
import { db } from '../db/client';
import { issueReports } from '../db/schema';
import { runIssueDigest } from '../jobs/issueDigest';
import { runNightlyJobs } from '../jobs/scheduler';
import { purgeExpiredScreenshots, screenshotRetentionDays } from '../lib/issuePrivacy';
import { MailMessage } from '../lib/mailer';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Smallest valid PNG (1×1) — real magic bytes, so the server's sniffing accepts it.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const baseReport = {
  category: 'data',
  severity: 'high',
  screen: 'loans',
  title: 'EMI total is wrong',
  description: 'The EMI total on my home loan is ₹500 higher than my bank statement.',
  steps_to_reproduce: '1. Open Loans\n2. Look at Home loan',
  platform: 'android',
  app_version: '1.0.0',
};

/** A buffer of `size` bytes that starts with the PNG signature. */
const pngOfSize = (size: number) => {
  const buf = Buffer.alloc(size);
  Buffer.from(PNG_1PX, 'base64').copy(buf);
  return buf;
};

describe('POST /api/v1/issues', () => {
  it('requires sign-in', async () => {
    expect((await request(app).post('/api/v1/issues').send(baseReport)).status).toBe(401);
  });

  it('lets any user file a report without a screenshot', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/issues').set(auth(accessToken)).send(baseReport);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'EMI total is wrong', status: 'new', has_screenshot: false, screenshot_size: null });
    expect(res.body).not.toHaveProperty('screenshot');
  });

  it('stores a screenshot sent as a data URL and serves it back to the reporter only', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const res = await request(app)
      .post('/api/v1/issues')
      .set(auth(owner.accessToken))
      .send({ ...baseReport, screenshot: { data: `data:image/png;base64,${PNG_1PX}`, mime_type: 'image/png' } });
    expect(res.status).toBe(201);
    expect(res.body.has_screenshot).toBe(true);
    expect(res.body.screenshot_size).toBe(Buffer.from(PNG_1PX, 'base64').length);

    const img = await request(app).get(`/api/v1/issues/${res.body.id}/screenshot`).set(auth(owner.accessToken));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(img.body, Buffer.from(PNG_1PX, 'base64'))).toBe(0);

    expect((await request(app).get(`/api/v1/issues/${res.body.id}/screenshot`).set(auth(other.accessToken))).status).toBe(404);
  });

  it('stores the sniffed image type, not the declared one', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ ...baseReport, screenshot: { data: PNG_1PX, mime_type: 'image/jpeg' } });
    const [row] = await db.select({ mime: issueReports.screenshotMimeType }).from(issueReports).where(eq(issueReports.id, res.body.id));
    expect(row.mime).toBe('image/png');
  });

  it('accepts a screenshot of exactly 2 MB and rejects one byte more', async () => {
    const { accessToken } = await registerUser();
    const exact = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ ...baseReport, screenshot: { data: pngOfSize(2 * 1024 * 1024).toString('base64'), mime_type: 'image/png' } });
    expect(exact.status).toBe(201);
    expect(exact.body.screenshot_size).toBe(2 * 1024 * 1024);

    const over = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ ...baseReport, screenshot: { data: pngOfSize(2 * 1024 * 1024 + 1).toString('base64'), mime_type: 'image/png' } });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/2 MB/);
  });

  it('rejects a file that is not an image, and malformed base64', async () => {
    const { accessToken } = await registerUser();
    const notImage = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ ...baseReport, screenshot: { data: Buffer.from('<svg onload=alert(1)>').toString('base64'), mime_type: 'image/png' } });
    expect(notImage.status).toBe(400);
    expect(notImage.body.error).toMatch(/PNG, JPEG, or WebP/);

    const garbage = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ ...baseReport, screenshot: { data: '!!!not base64!!!', mime_type: 'image/png' } });
    expect(garbage.status).toBe(400);
  });

  it('answers 413 (not 500) for a body over the route limit', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ ...baseReport, screenshot: { data: 'A'.repeat(3.2 * 1024 * 1024), mime_type: 'image/png' } });
    expect(res.status).toBe(413);
  });

  it('validates the default fields', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).post('/api/v1/issues').set(auth(accessToken)).send({ ...baseReport, category: 'nope', title: 'x', description: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/issues/mine and staff triage', () => {
  it("lists only the caller's own reports", async () => {
    const a = await registerUser();
    const b = await registerUser();
    await request(app).post('/api/v1/issues').set(auth(a.accessToken)).send(baseReport);
    expect((await request(app).get('/api/v1/issues/mine').set(auth(a.accessToken))).body).toHaveLength(1);
    expect((await request(app).get('/api/v1/issues/mine').set(auth(b.accessToken))).body).toHaveLength(0);
  });

  it('only staff can list every report and change a status', async () => {
    const user = await registerUser();
    const staff = await registerUser();
    await promoteToSupport(staff.user.id);
    const created = await request(app).post('/api/v1/issues').set(auth(user.accessToken)).send(baseReport);

    expect((await request(app).get('/api/v1/issues').set(auth(user.accessToken))).status).toBe(403);
    expect((await request(app).patch(`/api/v1/issues/${created.body.id}`).set(auth(user.accessToken)).send({ status: 'resolved' })).status).toBe(403);

    const list = await request(app).get('/api/v1/issues').set(auth(staff.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.find((r: { id: number }) => r.id === created.body.id)).toMatchObject({ reporter_email: user.user.email });

    const patched = await request(app).patch(`/api/v1/issues/${created.body.id}`).set(auth(staff.accessToken)).send({ status: 'resolved' });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('resolved');
  });
});

// The test database is shared with the dev app (and possibly other test runs),
// so every digest call is scoped with onlyIssueIds to this file's own rows.
describe('nightly digest', () => {
  const savedEnv = { ...process.env };
  beforeAll(() => {
    process.env.ISSUE_DIGEST_TO = 'dev@test.local';
  });
  afterAll(() => {
    process.env = savedEnv;
  });

  it('analyses, suggests, emails pending reports once, and marks them notified', async () => {
    const { accessToken, user } = await registerUser();
    const one = await request(app)
      .post('/api/v1/issues')
      .set(auth(accessToken))
      .send({ ...baseReport, title: 'Crash on <script>', screenshot: { data: PNG_1PX, mime_type: 'image/png' } });
    const two = await request(app).post('/api/v1/issues').set(auth(accessToken)).send({ ...baseReport, title: 'EMI amount wrong again' });
    const ids: number[] = [one.body.id, two.body.id];

    const sent: MailMessage[] = [];
    const result = await runIssueDigest({ onlyIssueIds: ids, send: async (m) => void sent.push(m), log: () => {} });
    expect(result.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('dev@test.local');
    expect(sent[0].subject).toMatch(/new issue report/);
    expect(sent[0].text).toContain(`#${one.body.id} [`);
    expect(sent[0].text).toContain('Suggested fix:');
    expect(sent[0].html).toContain('Crash on &lt;script&gt;'); // user text is escaped
    expect(sent[0].html).not.toContain('<script>');
    // Private by default: no screenshot attached and the reporter is an id, not an email.
    expect(sent[0].attachments).toHaveLength(0);
    expect(sent[0].html).toContain('Has a screenshot — not attached');
    expect(sent[0].text).toContain(`Reporter: user #${user.id}`);
    expect(`${sent[0].text}${sent[0].html}`).not.toContain(user.email);

    const rows = await db.select().from(issueReports).where(inArray(issueReports.id, ids));
    for (const r of rows) {
      expect(r.notifiedAt).not.toBeNull();
      expect(r.status).toBe('triaged');
      expect(r.suggestion).toMatch(/loans\.tsx/);
    }

    // A second run doesn't email these two again.
    const again: MailMessage[] = [];
    await runIssueDigest({ onlyIssueIds: ids, send: async (m) => void again.push(m), log: () => {} });
    expect(again).toHaveLength(0);
    for (const m of again) for (const id of ids) expect(String(m.text)).not.toContain(`#${id} [`);
  });

  it('dry run writes nothing and sends nothing', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/issues').set(auth(accessToken)).send(baseReport);
    const sent: MailMessage[] = [];
    const result = await runIssueDigest({ dryRun: true, onlyIssueIds: [created.body.id], send: async (m) => void sent.push(m), log: () => {} });
    expect(result.skippedReason).toBe('dry run');
    expect(sent).toHaveLength(0);
    const [row] = await db.select().from(issueReports).where(eq(issueReports.id, created.body.id));
    expect(row).toMatchObject({ notifiedAt: null, status: 'new', suggestion: null });
  });

  it('leaves reports pending (with the suggestion kept for the retry) when the send fails', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/issues').set(auth(accessToken)).send(baseReport);
    await expect(
      runIssueDigest({
        onlyIssueIds: [created.body.id],
        send: async () => {
          throw new Error('SMTP down');
        },
        log: () => {},
      })
    ).rejects.toThrow('SMTP down');
    const [row] = await db.select().from(issueReports).where(eq(issueReports.id, created.body.id));
    expect(row.notifiedAt).toBeNull();
    expect(row.suggestion).not.toBeNull();
  });

  it('attaches screenshots and names the reporter only when opted in', async () => {
    process.env.ISSUE_DIGEST_ATTACH_SCREENSHOTS = 'true';
    process.env.ISSUE_DIGEST_SHOW_REPORTER = 'true';
    try {
      const { accessToken, user } = await registerUser();
      const created = await request(app)
        .post('/api/v1/issues')
        .set(auth(accessToken))
        .send({ ...baseReport, screenshot: { data: PNG_1PX, mime_type: 'image/png' } });
      const sent: MailMessage[] = [];
      await runIssueDigest({ onlyIssueIds: [created.body.id], send: async (m) => void sent.push(m), log: () => {} });
      expect(sent[0].attachments?.some((a) => a.cid === `issue-${created.body.id}@mybudget`)).toBe(true);
      expect(sent[0].text).toContain(`Reporter: ${user.email}`);
    } finally {
      delete process.env.ISSUE_DIGEST_ATTACH_SCREENSHOTS;
      delete process.env.ISSUE_DIGEST_SHOW_REPORTER;
    }
  });

  it('without SMTP, logs only the subject (never the report text) and leaves reports pending', async () => {
    const saved = { host: process.env.SMTP_HOST, from: process.env.SMTP_FROM };
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM;
    try {
      const { accessToken } = await registerUser();
      const created = await request(app)
        .post('/api/v1/issues')
        .set(auth(accessToken))
        .send({ ...baseReport, description: 'Secret balance details here ₹123456' });
      const lines: string[] = [];
      const result = await runIssueDigest({ onlyIssueIds: [created.body.id], log: (l) => lines.push(l) });
      expect(result.skippedReason).toBe('smtp not configured');
      expect(lines.join('\n')).not.toContain('Secret balance');
      const [row] = await db.select().from(issueReports).where(eq(issueReports.id, created.body.id));
      expect(row.notifiedAt).toBeNull();
    } finally {
      if (saved.host !== undefined) process.env.SMTP_HOST = saved.host;
      if (saved.from !== undefined) process.env.SMTP_FROM = saved.from;
    }
  });
});

describe('issue-report screenshot privacy', () => {
  it("support staff cannot open another user's screenshot; admins can", async () => {
    const reporter = await registerUser();
    const support = await registerUser();
    const admin = await registerUser();
    await promoteToSupport(support.user.id);
    await promoteToAdmin(admin.user.id);
    const created = await request(app)
      .post('/api/v1/issues')
      .set(auth(reporter.accessToken))
      .send({ ...baseReport, screenshot: { data: PNG_1PX, mime_type: 'image/png' } });

    expect((await request(app).get(`/api/v1/issues/${created.body.id}/screenshot`).set(auth(support.accessToken))).status).toBe(404);
    expect((await request(app).get(`/api/v1/issues/${created.body.id}/screenshot`).set(auth(admin.accessToken))).status).toBe(200);
  });

  it('answers 404 for a report with no screenshot, and 400 for a non-numeric id', async () => {
    const { accessToken } = await registerUser();
    const created = await request(app).post('/api/v1/issues').set(auth(accessToken)).send(baseReport);
    const none = await request(app).get(`/api/v1/issues/${created.body.id}/screenshot`).set(auth(accessToken));
    expect(none.status).toBe(404);
    expect(none.body.error).toMatch(/no screenshot/);
    expect((await request(app).get('/api/v1/issues/abc/screenshot').set(auth(accessToken))).status).toBe(400);
  });

  it('staff can filter the triage list by status; an unknown status is a 400 and an unknown report a 404', async () => {
    const staff = await registerUser();
    await promoteToSupport(staff.user.id);
    const res = await request(app).get('/api/v1/issues?status=resolved').set(auth(staff.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.every((r: { status: string }) => r.status === 'resolved')).toBe(true);
    expect((await request(app).get('/api/v1/issues?status=bogus').set(auth(staff.accessToken))).status).toBe(400);
    expect((await request(app).patch('/api/v1/issues/999999999').set(auth(staff.accessToken)).send({ status: 'resolved' })).status).toBe(404);
  });
});

describe('screenshot retention', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const withShot = (token: string) =>
    request(app)
      .post('/api/v1/issues')
      .set(auth(token))
      .send({ ...baseReport, screenshot: { data: PNG_1PX, mime_type: 'image/png' } })
      .then((r) => r.body.id as number);
  const setRow = (id: number, values: { status?: string; updatedAt: Date }) => db.update(issueReports).set(values).where(eq(issueReports.id, id));

  it('drops screenshots of reports closed longer ago than the retention period, keeping the text', async () => {
    const { accessToken } = await registerUser();
    const [old, recent, open] = [await withShot(accessToken), await withShot(accessToken), await withShot(accessToken)];
    const now = new Date();
    const longAgo = new Date(now.getTime() - (screenshotRetentionDays() + 1) * DAY);
    await setRow(old, { status: 'resolved', updatedAt: longAgo });
    await setRow(recent, { status: 'wont_fix', updatedAt: now });
    await setRow(open, { updatedAt: longAgo }); // still 'new' — kept

    await purgeExpiredScreenshots(now);
    const rows = await db.select().from(issueReports).where(inArray(issueReports.id, [old, recent, open]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(old)).toMatchObject({ screenshot: null, screenshotMimeType: null, screenshotSize: null, title: baseReport.title });
    expect(byId.get(recent)!.screenshot).not.toBeNull();
    expect(byId.get(open)!.screenshot).not.toBeNull();
  });

  it('reads the retention period from the environment, ignoring blank or invalid values', () => {
    const saved = process.env.ISSUE_SCREENSHOT_RETENTION_DAYS;
    try {
      process.env.ISSUE_SCREENSHOT_RETENTION_DAYS = '30';
      expect(screenshotRetentionDays()).toBe(30);
      process.env.ISSUE_SCREENSHOT_RETENTION_DAYS = '';
      expect(screenshotRetentionDays()).toBe(90);
      process.env.ISSUE_SCREENSHOT_RETENTION_DAYS = '-5';
      expect(screenshotRetentionDays()).toBe(90);
      process.env.ISSUE_SCREENSHOT_RETENTION_DAYS = '0';
      expect(screenshotRetentionDays()).toBe(0);
    } finally {
      if (saved === undefined) delete process.env.ISSUE_SCREENSHOT_RETENTION_DAYS;
      else process.env.ISSUE_SCREENSHOT_RETENTION_DAYS = saved;
    }
  });

  it('runs every night even when the digest email is switched off', async () => {
    const saved = process.env.ISSUE_DIGEST_ENABLED;
    process.env.ISSUE_DIGEST_ENABLED = 'false';
    try {
      const { accessToken } = await registerUser();
      const id = await withShot(accessToken);
      const now = new Date();
      await setRow(id, { status: 'resolved', updatedAt: new Date(now.getTime() - (screenshotRetentionDays() + 1) * DAY) });
      await runNightlyJobs(now);
      const [row] = await db.select().from(issueReports).where(eq(issueReports.id, id));
      expect(row.screenshot).toBeNull();
      expect(row.notifiedAt).toBeNull(); // the digest itself didn't run
    } finally {
      if (saved === undefined) delete process.env.ISSUE_DIGEST_ENABLED;
      else process.env.ISSUE_DIGEST_ENABLED = saved;
    }
  });
});
