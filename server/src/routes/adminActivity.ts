import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, gte } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { userActivity, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAdminAction } from '../lib/auditLog';
import { notFound } from '../lib/errors';
import { ACTIVITY_RETENTION_DAYS } from '../lib/activity';
import { idParam, num } from '../lib/validation';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/requireAdmin';
import { requireSystemManager } from '../middleware/requireSystemManager';
import { pageLabel } from '../../../utils/pagePatterns';

// Reading user activity. The overview is counts only, over customer accounts (staff and testers are left
// out), for admins and system managers. One person's timeline is admin only, and every look at one is
// written to the audit log. Pages are shown as patterns: there is no amount, name or id anywhere in this.
const router = Router();
router.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysQuery = z.object({ days: num((n) => n.int().min(1).max(ACTIVITY_RETENTION_DAYS)).default(7) });

router.get(
  '/overview',
  requireSystemManager,
  asyncHandler(async (req, res) => {
    const { days } = daysQuery.parse(req.query);
    const since = new Date(Date.now() - days * DAY_MS);
    const customers = sql`from ${userActivity} a join ${users} u on u.id = a.user_id where u.account_kind = 'customer' and a.created_at >= ${since}`;

    const [totals] = (await db.execute<{ logins: number; page_views: number; people: number }>(
      sql`select count(*) filter (where a.kind = 'login')::int as logins, count(*) filter (where a.kind = 'page')::int as page_views, count(distinct a.user_id)::int as people ${customers}`
    )).rows;
    const topPages = (await db.execute<{ page: string; n: number }>(
      sql`select a.page, count(*)::int as n ${customers} and a.kind = 'page' group by a.page order by n desc, a.page limit 10`
    )).rows;
    const platforms = (await db.execute<{ platform: string; n: number }>(
      sql`select coalesce(a.platform, 'unknown') as platform, count(*)::int as n ${customers} and a.kind = 'login' group by 1 order by n desc`
    )).rows;
    const byDay = (await db.execute<{ day: string; logins: number; page_views: number }>(
      sql`select to_char((a.created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, count(*) filter (where a.kind = 'login')::int as logins, count(*) filter (where a.kind = 'page')::int as page_views ${customers} group by 1 order by 1`
    )).rows;

    res.json({
      days,
      logins: totals.logins,
      people: totals.people,
      pageViews: totals.page_views,
      topPages: topPages.map((r) => ({ page: r.page, label: pageLabel(r.page), count: r.n })),
      platforms: Object.fromEntries(platforms.map((r) => [r.platform, r.n])),
      byDay: byDay.map((r) => ({ day: r.day, logins: r.logins, pageViews: r.page_views })),
    });
  })
);

interface TimelineEvent {
  kind: 'login' | 'logout' | 'page';
  page: string | null;
  label: string | null;
  at: Date;
  detail: string | null;
}
interface Session {
  start: Date;
  end: Date;
  platform: string | null;
  location: string | null;
  events: TimelineEvent[];
}

const SESSION_GAP_MS = 30 * 60 * 1000;

// Events of one sign-in belong together. They share the session id the app sends; where there is none, a
// gap of half an hour starts a new session.
export const groupSessions = (rows: { kind: 'login' | 'logout' | 'page'; page: string | null; platform: string | null; location: string | null; sessionId: string | null; detail: string | null; at: Date }[]): Session[] => {
  const sessions: Session[] = [];
  let currentKey: string | null = null;
  let last: Session | null = null;
  for (const r of rows) {
    const key = r.sessionId;
    const startNew = !last || (key !== null && currentKey !== null && key !== currentKey) || r.at.getTime() - last.end.getTime() > SESSION_GAP_MS;
    if (startNew) {
      last = { start: r.at, end: r.at, platform: r.platform, location: r.location, events: [] };
      sessions.push(last);
      currentKey = key;
    } else if (currentKey === null) {
      currentKey = key;
    }
    const session = last!;
    session.end = r.at;
    session.platform ??= r.platform;
    session.location ??= r.location;
    session.events.push({ kind: r.kind, page: r.page, label: r.page ? pageLabel(r.page) : null, at: r.at, detail: r.detail });
  }
  return sessions.reverse();
};

router.get(
  '/users/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const { days } = daysQuery.extend({ days: num((n) => n.int().min(1).max(ACTIVITY_RETENTION_DAYS)).default(30) }).parse(req.query);
    const [person] = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, id));
    if (!person) throw notFound('User not found.');

    const [actor] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.userId!));
    await recordAdminAction({ actorId: req.userId!, actorEmail: actor?.email ?? '', targetId: person.id, targetEmail: person.email, action: 'viewed_activity', details: `last ${days} days` });

    const since = new Date(Date.now() - days * DAY_MS);
    const rows = await db
      .select({ kind: userActivity.kind, page: userActivity.page, platform: userActivity.platform, location: userActivity.location, sessionId: userActivity.sessionId, detail: userActivity.detail, at: userActivity.createdAt })
      .from(userActivity)
      .where(and(eq(userActivity.userId, id), gte(userActivity.createdAt, since)))
      .orderBy(asc(userActivity.createdAt), asc(userActivity.id))
      .limit(5000);

    const sessions = groupSessions(rows);
    res.json({
      person,
      days,
      lastSeen: rows.length ? rows[rows.length - 1].at : null,
      logins: rows.filter((r) => r.kind === 'login').length,
      sessions: sessions.slice(0, 200),
    });
  })
);

export default router;
