import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { app, registerUser, promoteToSupport } from './helpers';
import { db } from '../db/client';
import { issueReports } from '../db/schema';
import { runIssueDigest } from '../jobs/issueDigest';
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
    delete process.env.ANTHROPIC_API_KEY; // never call the real API from tests
    process.env.ISSUE_DIGEST_TO = 'dev@test.local';
  });
  afterAll(() => {
    process.env = savedEnv;
  });

  it('analyses, suggests, emails pending reports once, and marks them notified', async () => {
    const { accessToken } = await registerUser();
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
    expect(sent[0].text).toContain('Suggested fix (heuristic');
    expect(sent[0].html).toContain('Crash on &lt;script&gt;'); // user text is escaped
    expect(sent[0].html).not.toContain('<script>');
    expect(sent[0].attachments?.some((a) => a.cid === `issue-${one.body.id}@mybudget`)).toBe(true);

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
});
