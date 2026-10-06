import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/client';
import { appSettings, issueReports, userFeatures, users } from '../db/schema';
import { asyncHandler } from '../lib/asyncHandler';
import { idParam } from '../lib/validation';
import { notFound } from '../lib/errors';
import { recordAdminAction } from '../lib/auditLog';
import { getSignupDefaults, signupDefaultsSchema, SIGNUP_FEATURES_KEY } from '../lib/features';
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
const switchSchema = z.object({ on: z.boolean() });
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
        .where(eq(userFeatures.status, 'on'))
        .groupBy(userFeatures.featureKey),
      db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          feature: userFeatures.featureKey,
          requestedAt: userFeatures.requestedAt,
        })
        .from(userFeatures)
        .innerJoin(users, eq(users.id, userFeatures.userId))
        .where(and(isNotNull(userFeatures.requestedAt), eq(userFeatures.status, 'off')))
        .orderBy(asc(userFeatures.requestedAt))
        .limit(200),
    ]);
    const byKey = new Map(onCounts.map((r) => [r.key, r.n]));
    res.json({
      defaults,
      totalUsers,
      features: FEATURES.map((f) => ({ key: f.key, label: f.label, usersOn: byKey.get(f.key) ?? 0 })),
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
    const where = and(eq(userFeatures.featureKey, key), eq(userFeatures.status, 'on'));
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
  const rows = await db
    .select({ row: userFeatures, changedByEmail: changer.email })
    .from(userFeatures)
    .leftJoin(changer, eq(changer.id, userFeatures.changedBy))
    .where(eq(userFeatures.userId, userId));
  const byKey = new Map(rows.map((r) => [r.row.featureKey, r]));
  return FEATURES.map((f) => {
    const r = byKey.get(f.key);
    return {
      key: f.key,
      label: f.label,
      on: r?.row.status === 'on',
      source: r?.row.source ?? null,
      changedByEmail: r?.changedByEmail ?? null,
      updatedAt: r?.row.updatedAt ?? null,
      requestedAt: r?.row.status === 'off' ? r.row.requestedAt : null,
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
    const { on } = switchSchema.parse(req.body);
    const status = on ? 'on' : 'off';

    const [before] = await db
      .select()
      .from(userFeatures)
      .where(and(eq(userFeatures.userId, target.id), eq(userFeatures.featureKey, key)));
    const wasOn = before?.status === 'on';
    const pendingRequest = !wasOn && before?.requestedAt != null;
    if (wasOn === on && !pendingRequest) {
      res.json((await loadUserFeatures(target.id)).find((f) => f.key === key));
      return;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .insert(userFeatures)
        .values({ userId: target.id, featureKey: key, status, source: 'admin', changedBy: req.userId! })
        .onConflictDoUpdate({
          target: [userFeatures.userId, userFeatures.featureKey],
          set: { status, source: 'admin', changedBy: req.userId!, requestedAt: null, requestIssueId: null, updatedAt: now },
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
