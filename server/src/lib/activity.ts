import { Request } from 'express';
import { isIPv6 } from 'net';
import { db } from '../db/client';
import { userActivity } from '../db/schema';
import { normalizePage } from '../../../utils/pagePatterns';

// User activity: sign-ins, sign-outs and which pages are opened, for understanding how the app is used.
// Nothing else is recorded: no amounts, names, ids, search text or screen contents. Page hits carry one of
// a fixed list of page patterns (utils/pagePatterns.ts); a login keeps only a coarse location.
// None of this may ever stop a person using the app, so a failed write is logged and ignored.

export const ACTIVITY_RETENTION_DAYS = 90;
export const MAX_PAGES_PER_BATCH = 50;
const MAX_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_RE = /^[0-9A-Za-z.+_-]{1,20}$/;
const PLATFORMS = new Set(['web', 'android', 'ios']);

type Platform = 'web' | 'android' | 'ios';

/** The first part of an address only: 1.2.3.0/24 for IPv4, the first 48 bits for IPv6. Null when it is not an address. */
export const coarseLocation = (ip: string | undefined | null): string | null => {
  if (!ip) return null;
  let value = ip.trim().split('%')[0];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) value = mapped[1];
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    return parts.every((n) => n <= 255) ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : null;
  }
  if (!isIPv6(value)) return null;
  const [head, tail] = value.split('::');
  const h = head ? head.split(':') : [];
  let groups: string[];
  if (tail === undefined) groups = h;
  else {
    const t = tail ? tail.split(':') : [];
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    groups = [...h, ...Array<string>(fill).fill('0'), ...t];
  }
  if (groups.length !== 8) return null;
  const first = groups.slice(0, 3).map((g) => parseInt(g, 16));
  return first.some((n) => Number.isNaN(n)) ? null : `${first.map((n) => n.toString(16)).join(':')}::/48`;
};

/** What the app says about itself in headers. Anything that is not the expected shape is ignored. */
export const readClient = (req: Pick<Request, 'header'>): { platform: Platform | null; appVersion: string | null; sessionId: string | null } => {
  const platform = req.header('x-app-platform')?.toLowerCase();
  const version = req.header('x-app-version');
  const session = req.header('x-session-id');
  return {
    platform: platform && PLATFORMS.has(platform) ? (platform as Platform) : null,
    appVersion: version && VERSION_RE.test(version) ? version : null,
    sessionId: session && UUID_RE.test(session) ? session.toLowerCase() : null,
  };
};

const safely = async (what: string, write: () => Promise<unknown>): Promise<void> => {
  try {
    await write();
  } catch (err) {
    console.error(`[activity] could not record ${what}:`, (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message);
  }
};

export const recordLogin = (userId: number, req: Request, detail: 'password' | 'register'): Promise<void> =>
  safely('a sign-in', () => db.insert(userActivity).values({ userId, kind: 'login', ...readClient(req), location: coarseLocation(req.ip), detail }));

export const recordLogout = (userId: number, req: Request, detail: 'single' | 'everywhere'): Promise<void> =>
  safely('a sign-out', () => db.insert(userActivity).values({ userId, kind: 'logout', ...readClient(req), detail }));

/**
 * Stores the page hits that are valid and counts the rest. A hit is valid when its path is a known page
 * and its time is within the last day and not in the future. Returns what was kept and what was dropped.
 */
export const recordPages = async (
  userId: number,
  req: Request,
  pages: { path: unknown; at?: unknown }[],
  now: Date = new Date()
): Promise<{ recorded: number; dropped: number }> => {
  const client = readClient(req);
  const rows: (typeof userActivity.$inferInsert)[] = [];
  for (const { path, at } of pages) {
    const page = normalizePage(path);
    if (!page) continue;
    let when = now;
    if (at !== undefined) {
      const parsed = typeof at === 'string' ? new Date(at) : new Date(NaN);
      const t = parsed.getTime();
      if (Number.isNaN(t) || t < now.getTime() - MAX_PAST_MS || t > now.getTime() + MAX_FUTURE_MS) continue;
      when = parsed;
    }
    rows.push({ userId, kind: 'page', page, ...client, createdAt: when });
  }
  if (rows.length) await safely('page hits', () => db.insert(userActivity).values(rows));
  return { recorded: rows.length, dropped: pages.length - rows.length };
};
