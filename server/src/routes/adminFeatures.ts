import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, isNotNull, not, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import { appSettings, issueReports, userFeatures, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam } from '../lib/validation';
import { notFound } from '../lib/errors';
import { recordAdminAction } from '../lib/auditLog';
import { activeFeature, getSignupDefaults, getUserFeatures, signupDefaultsSchema, SIGNUP_FEATURES_KEY } from '../lib/features';
import { getPlan } from '../lib/plan';
import { requireAuth } from '../middleware/auth';
import { requireFeatureManager, requireFeatureViewer } from '../middleware/requireFeatureStaff';
import { FEATURES, FEATURE_KEYS, FeatureKey } from '../../../constants/features';

// Feature access, admin-driven: admin and system_manager switch Goals, Loans
// and Investments on or off per user and set what new accounts get; support
// can only look. Mounted at /api/v1/admin ahead of the users router, so
// requireAuth is per route (a router-level use would run for every
// /admin/* request). Like routes/admin.ts this never reads anyone's goals,
// loans or investments — only who has which feature switched on.
const router = Router();

const keyParam = z.object({ key: z.enum(FEATURE_KEYS) });
// `period` sets how long a switch-on lasts: a month or a year from now, or no end (the default).
const switchSchema = z.object({ on: z.boolean(), period: z.enum(['month', 'year', 'none']).default('none') });
const expiryFor = (period: 'month' | 'year' | 'none', now: Date): Date | null => {
  if (period === 'none') return null;
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + (period === 'year' ? 12 : 1));
  return end;
};
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const getActorEmail = async (actorId: number) => {
  const [actor] = await db.select({ email: users.email }).from(users).where(eq(users.id, actorId));
  return actor?.email ?? 'unknown';
};

// Overview for the admin Features page: sign-up defaults, how many users
// have each feature, and the requests waiting for an answer (oldest first).
router.get(
  '/features',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (_req, res) => {
    const [defaults, [{ totalUsers }], onCounts, requests] = await Promise.all([
      getSignupDefaults(),
      db.select({ totalUsers: count() }).from(users),
      db
        .select({ key: userFeatures.featureKey, n: count() })
        .from(userFeatures)
        .where(activeFeature())
        .groupBy(userFeatures.featureKey),
      db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          feature: userFeatures.featureKey,
          requestedAt: userFeatures.requestedAt,
          paid: userFeatures.requestPaid,
        })
        .from(userFeatures)
        .innerJoin(users, eq(users.id, userFeatures.userId))
        .where(and(isNotNull(userFeatures.requestedAt), not(activeFeature())))
        .orderBy(asc(userFeatures.requestedAt))
        .limit(200),
    ]);
    const byKey = new Map(onCounts.map((r) => [r.key, r.n]));
    res.json({
      defaults,
      totalUsers,
      features: FEATURES.map((f) => ({ key: f.key, label: f.label, price: f.price, period: f.period, usersOn: byKey.get(f.key) ?? 0 })),
      requests,
    });
  })
);

router.put(
  '/features/defaults',
  requireAuth,
  requireFeatureManager,
  asyncHandler(async (req, res) => {
    const next = signupDefaultsSchema.parse(req.body);
    const before = await getSignupDefaults();
    const now = new Date();
    await db
      .insert(appSettings)
      .values({ key: SIGNUP_FEATURES_KEY, value: next, updatedBy: req.userId!, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedBy: req.userId!, updatedAt: now } });

    const changes = FEATURE_KEYS.filter((k) => before[k] !== next[k]).map((k) => `${k}: ${before[k] ? 'on' : 'off'} -> ${next[k] ? 'on' : 'off'}`);
    if (changes.length) {
      await recordAdminAction({
        actorId: req.userId!,
        actorEmail: await getActorEmail(req.userId!),
        targetId: null,
        targetEmail: 'new sign-ups',
        action: 'signup_features_changed',
        details: changes.join(', '),
      });
    }
    res.json(next);
  })
);

// Who has one feature switched on, newest change first. X-Total-Count carries the full count.
router.get(
  '/features/:key/users',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (req, res) => {
    const { key } = keyParam.parse(req.params);
    const q = listQuery.parse(req.query);
    const where = and(eq(userFeatures.featureKey, key), activeFeature());
    const [rows, [{ total }]] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, email: users.email, source: userFeatures.source, updatedAt: userFeatures.updatedAt })
        .from(userFeatures)
        .innerJoin(users, eq(users.id, userFeatures.userId))
        .where(where)
        .orderBy(desc(userFeatures.updatedAt), desc(users.id))
        .limit(q.limit)
        .offset(q.offset),
      db.select({ total: count() }).from(userFeatures).where(where),
    ]);
    res.setHeader('X-Total-Count', String(total));
    res.json(rows);
  })
);

const changer = alias(users, 'changer');

const loadUserFeatures = async (userId: number) => {
  const [rows, effective, plan] = await Promise.all([
    db
      .select({ row: userFeatures, changedByEmail: changer.email, active: sql<boolean>`(${activeFeature()})` })
      .from(userFeatures)
      .leftJoin(changer, eq(changer.id, userFeatures.changedBy))
      .where(eq(userFeatures.userId, userId)),
    getUserFeatures(userId),
    getPlan(),
  ]);
  const byKey = new Map(rows.map((r) => [r.row.featureKey, r]));
  const on = new Set(effective);
  return FEATURES.map((f) => {
    const r = byKey.get(f.key);
    return {
      key: f.key,
      label: f.label,
      // What the user actually has: a switched-on row, or the plan including it.
      on: on.has(f.key),
      // Staff turned this one off for this user on purpose, even though the plan includes it.
      denied: r?.row.denied === true,
      // Included only because the plan is running, not because staff switched it on.
      viaPlan: on.has(f.key) && plan.enforced && !(r?.active && r.row.source === 'admin'),
      expiresAt: r?.active ? r.row.expiresAt : null,
      source: r?.row.source ?? null,
      changedByEmail: r?.changedByEmail ?? null,
      updatedAt: r?.row.updatedAt ?? null,
      requestedAt: r && !r.active ? r.row.requestedAt : null,
    };
  });
};

const findUser = async (id: number) => {
  const [target] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id));
  if (!target) throw notFound('User not found.');
  return target;
};

// The Features section of the admin user sheet.
router.get(
  '/users/:id/features',
  requireAuth,
  requireFeatureViewer,
  asyncHandler(async (req, res) => {
    const target = await findUser(idParam(req));
    res.json(await loadUserFeatures(target.id));
  })
);

// Switch one feature on or off for one user. Any waiting request is answered
// by it: switched on closes the request's problem report as resolved,
// switched off (or left off) closes it as won't fix. Never touches the
// user's goals, loans or investments.
router.put(
  '/users/:id/features/:key',
  requireAuth,
  requireFeatureManager,
  asyncHandler(async (req, res) => {
    const target = await findUser(idParam(req));
    const { key } = keyParam.parse(req.params) as { key: FeatureKey };
    const { on, period } = switchSchema.parse(req.body);
    const status = on ? 'on' : 'off';

    const [before] = await db
      .select()
      .from(userFeatures)
      .where(and(eq(userFeatures.userId, target.id), eq(userFeatures.featureKey, key)));
    // What the user has right now, plan included, so switching off a feature the plan gives is a real change.
    const wasOn = (await getUserFeatures(target.id)).includes(key);
    const pendingRequest = !wasOn && before?.requestedAt != null;
    // Switching an already-on feature on again with a period extends or changes it.
    const changesPeriod = on && wasOn && period !== 'none';
    if (wasOn === on && !pendingRequest && !changesPeriod) {
      res.json((await loadUserFeatures(target.id)).find((f) => f.key === key));
      return;
    }

    const now = new Date();
    const expiresAt = on ? expiryFor(period, now) : null;
    await db.transaction(async (tx) => {
      await tx
        .insert(userFeatures)
        .values({ userId: target.id, featureKey: key, status, source: 'admin', changedBy: req.userId!, expiresAt, denied: !on })
        .onConflictDoUpdate({
          target: [userFeatures.userId, userFeatures.featureKey],
          set: { status, source: 'admin', changedBy: req.userId!, requestedAt: null, requestIssueId: null, requestPaid: false, expiresAt, denied: !on, updatedAt: now },
        });
      if (pendingRequest && before.requestIssueId) {
        await tx
          .update(issueReports)
          .set({ status: on ? 'resolved' : 'wont_fix', updatedAt: now })
          .where(and(eq(issueReports.id, before.requestIssueId), sql`${issueReports.status} IN ('new', 'triaged')`));
      }
    });

    const details = [wasOn === on ? `${key}: left ${status}` : `${key}: ${wasOn ? 'on' : 'off'} -> ${status}`];
    if (pendingRequest) details.push(on ? 'request granted' : 'request refused');
    if (on && period !== 'none') details.push(`for 1 ${period}`);
    await recordAdminAction({
      actorId: req.userId!,
      actorEmail: await getActorEmail(req.userId!),
      targetId: target.id,
      targetEmail: target.email,
      action: 'feature_changed',
      details: details.join(', '),
    });

    res.json((await loadUserFeatures(target.id)).find((f) => f.key === key));
  })
);

export default router;
