import { Router } from 'express';
import { z } from 'zod';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { issueReports, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam } from '../lib/validation';
import { badRequest, notFound } from '../lib/errors';
import { requireAuth } from '../middleware/auth';
import { requireStaff } from '../middleware/requireStaff';
import { issueReportLimiter } from '../middleware/rateLimit';
import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  ISSUE_SCREENS,
  ISSUE_STATUSES,
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_MIME_TYPES,
  ScreenshotMimeType,
} from '../../../constants/issues';

const router = Router();
router.use(requireAuth);

const keys = <T extends { key: string }>(list: readonly T[]) => list.map((i) => i.key) as [T['key'], ...T['key'][]];
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const createSchema = z.object({
  category: z.enum(keys(ISSUE_CATEGORIES)),
  severity: z.enum(keys(ISSUE_SEVERITIES)),
  screen: z.enum(keys(ISSUE_SCREENS)),
  title: z.string().trim().min(3, 'Give the issue a short title.').max(120),
  description: z.string().trim().min(10, 'Describe what happened (at least 10 characters).').max(5000),
  steps_to_reproduce: optionalText(5000),
  expected_behavior: optionalText(2000),
  platform: optionalText(20),
  app_version: optionalText(40),
  device_info: optionalText(200),
  screenshot: z
    .object({
      // Raw base64 or a data: URL — the web image picker returns the latter.
      data: z.string().min(1),
      mime_type: z.enum(SCREENSHOT_MIME_TYPES),
    })
    .nullish(),
});

const updateSchema = z.object({ status: z.enum(ISSUE_STATUSES) });

/** Identifies the image from its first bytes — the declared mime type is the client's claim, this is what the bytes actually are. */
export const sniffImageType = (buf: Buffer): ScreenshotMimeType | null => {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
};

const decodeScreenshot = (data: string) => {
  const base64 = data.replace(/^data:[^;,]+;base64,/, '');
  if (!/^[A-Za-z0-9+/\s]+={0,2}$/.test(base64)) throw badRequest('Screenshot is not valid base64.');
  // Cheap pre-check before allocating: 4 base64 chars encode 3 bytes.
  if (Math.floor((base64.replace(/\s/g, '').length * 3) / 4) > MAX_SCREENSHOT_BYTES + 2) {
    throw badRequest('Screenshot must be 2 MB or smaller.');
  }
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) throw badRequest('Screenshot is empty.');
  if (buf.length > MAX_SCREENSHOT_BYTES) throw badRequest('Screenshot must be 2 MB or smaller.');
  const actual = sniffImageType(buf);
  if (!actual) throw badRequest('Screenshot must be a PNG, JPEG, or WebP image.');
  // Pickers sometimes mislabel the format, so store what the bytes really are, not the declared mime_type.
  return { buf, mimeType: actual };
};

// Every column except the screenshot bytes — list/detail responses never carry them.
const summaryColumns = {
  id: issueReports.id,
  category: issueReports.category,
  severity: issueReports.severity,
  screen: issueReports.screen,
  title: issueReports.title,
  description: issueReports.description,
  steps_to_reproduce: issueReports.stepsToReproduce,
  expected_behavior: issueReports.expectedBehavior,
  platform: issueReports.platform,
  app_version: issueReports.appVersion,
  device_info: issueReports.deviceInfo,
  has_screenshot: sql<boolean>`${issueReports.screenshot} IS NOT NULL`,
  screenshot_size: issueReports.screenshotSize,
  status: issueReports.status,
  created_at: issueReports.createdAt,
  updated_at: issueReports.updatedAt,
};

router.post(
  '/',
  issueReportLimiter,
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const shot = body.screenshot ? decodeScreenshot(body.screenshot.data) : null;

    const [row] = await db
      .insert(issueReports)
      .values({
        userId: req.userId!,
        category: body.category,
        severity: body.severity,
        screen: body.screen,
        title: body.title,
        description: body.description,
        stepsToReproduce: body.steps_to_reproduce,
        expectedBehavior: body.expected_behavior,
        platform: body.platform,
        appVersion: body.app_version,
        deviceInfo: body.device_info,
        screenshot: shot?.buf ?? null,
        screenshotMimeType: shot?.mimeType ?? null,
        screenshotSize: shot?.buf.length ?? null,
      })
      .returning(summaryColumns);
    res.status(201).json(row);
  })
);

router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select(summaryColumns)
      .from(issueReports)
      .where(eq(issueReports.userId, req.userId!))
      .orderBy(desc(issueReports.createdAt))
      .limit(50);
    res.json(rows);
  })
);

/**
 * The reporter can fetch their own screenshot; of staff, only admins can fetch
 * others'. A screenshot of this app shows the user's own balances, and support
 * accounts are deliberately kept away from users' financial data (same rule as
 * /admin/users), so support triages from the report text alone.
 */
router.get(
  '/:id/screenshot',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const [row] = await db
      .select({ userId: issueReports.userId, screenshot: issueReports.screenshot, mimeType: issueReports.screenshotMimeType })
      .from(issueReports)
      .where(eq(issueReports.id, id));
    // 404 rather than 403 for someone else's report — don't confirm it exists.
    // requireAuth loaded req.role fresh from the database on this request.
    if (!row || (row.userId !== req.userId && req.role !== 'admin')) throw notFound('Issue report not found.');
    if (!row.screenshot || !row.mimeType) throw notFound('This report has no screenshot.');

    res.set({
      'Content-Type': row.mimeType,
      'Content-Length': String(row.screenshot.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename="issue-${id}-screenshot"`,
      'Cache-Control': 'private, max-age=300',
    });
    res.send(row.screenshot);
  })
);

// ---------- Staff triage ----------

router.get(
  '/',
  requireStaff,
  asyncHandler(async (req, res) => {
    const status = req.query.status ? z.enum(ISSUE_STATUSES).parse(req.query.status) : undefined;
    const rows = await db
      .select({ ...summaryColumns, reporter_email: users.email, suggestion: issueReports.suggestion, notified_at: issueReports.notifiedAt })
      .from(issueReports)
      .innerJoin(users, eq(users.id, issueReports.userId))
      .where(status ? eq(issueReports.status, status) : undefined)
      .orderBy(desc(issueReports.createdAt))
      .limit(200);
    res.json(rows);
  })
);

router.patch(
  '/:id',
  requireStaff,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const body = updateSchema.parse(req.body);
    const [row] = await db
      .update(issueReports)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(issueReports.id, id))
      .returning(summaryColumns);
    if (!row) throw notFound('Issue report not found.');
    res.json(row);
  })
);

export default router;
