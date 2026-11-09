import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { app, promoteToAdmin, registerUser } from './helpers';
import { DAY, PASSWORD, auth, clearGrants, giveGrant, makeAdmin, makeCustomer, makeSupport, me, setKind, setTrialEnd, useMemoryPlan, userGrants } from './planTestKit';
import { db } from '../db/client';
import { accessGrants, accessNotices, adminAuditLog, users } from '../db/schema';
import { outbox } from '../lib/accountMail';
import { DEFAULT_PLAN } from '../lib/plan';
import * as noticesLib from '../lib/accessNotices';
import { notifyExistingUsers, runAccessNotices } from '../lib/accessNotices';

// The admin side of the plan: settings, the dry run, the notice, the
// enforcement switch, company accounts, exceptions and the daily lists.

const plan = useMemoryPlan();
beforeEach(() => {
  plan.plan = { ...DEFAULT_PLAN };
  outbox.length = 0;
});

let admin: Awaited<ReturnType<typeof makeAdmin>>;
beforeAll(async () => {
  admin = await makeAdmin();
});

const auditFor = (action: string) => db.select().from(adminAuditLog).where(and(eq(adminAuditLog.actorId, admin.id), eq(adminAuditLog.action, action)));
const validPlan = { price_inr: 250, period: 'year', trial_months: 6, notice_days: 30, features: ['goals', 'loans', 'investments', 'forecast'] };

describe('plan settings', () => {
  it('staff can read them; a customer cannot', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    const res = await request(app).get('/api/v1/admin/plan').set(auth(support.token));
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ price_inr: 200, period: 'year', trial_months: 6, enforced: false });
    expect(res.body.stats).toEqual(expect.objectContaining({ customers: expect.any(Number), company: expect.any(Number), pending: expect.any(Number) }));
    expect((await request(app).get('/api/v1/admin/plan').set(auth(u.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/plan')).status).toBe(401);
  });

  it('only an admin can change the price, and the change is logged', async () => {
    const support = await makeSupport();
    expect((await request(app).put('/api/v1/admin/plan').set(auth(support.token)).send(validPlan)).status).toBe(403);
    const res = await request(app).put('/api/v1/admin/plan').set(auth(admin.token)).send(validPlan);
    expect(res.status).toBe(200);
    expect(plan.plan.price_inr).toBe(250);
    const log = (await auditFor('plan_changed')).find((a) => a.details?.includes('₹200 -> ₹250'));
    expect(log).toBeDefined();
  });

  it('refuses nonsense, and will not let this form turn enforcement on', async () => {
    const put = (b: Record<string, unknown>) => request(app).put('/api/v1/admin/plan').set(auth(admin.token)).send(b);
    expect((await put({ ...validPlan, price_inr: 0 })).status).toBe(400);
    expect((await put({ ...validPlan, price_inr: -5 })).status).toBe(400);
    expect((await put({ ...validPlan, period: 'decade' })).status).toBe(400);
    expect((await put({ ...validPlan, trial_months: 0 })).status).toBe(400);
    expect((await put({ ...validPlan, notice_days: 2 })).status).toBe(400);
    expect((await put({ ...validPlan, features: ['bogus'] })).status).toBe(400);
    expect((await put({ ...validPlan, enforced: true })).status).toBe(400);
    expect(plan.plan.enforced).toBe(false);
  });

  it('the price can change without touching what people already paid', async () => {
    await request(app).put('/api/v1/admin/plan').set(auth(admin.token)).send({ ...validPlan, price_inr: 500 }).expect(200);
    expect(plan.plan.price_inr).toBe(500);
    const u = await makeCustomer();
    expect((await me(u.accessToken)).plan.price_inr).toBe(500);
  });
});

describe('the dry run', () => {
  it('lists who would lose the plan if enforcement were on now, and nobody who would keep it', async () => {
    const support = await makeSupport();
    const ended = await makeCustomer();
    const running = await makeCustomer();
    const company = await makeCustomer();
    const excepted = await makeCustomer();
    await setTrialEnd(ended.user.id, -5);
    await setTrialEnd(running.user.id, 40);
    await setKind(company.user.id, 'company');
    await setTrialEnd(excepted.user.id, -5);
    await giveGrant(excepted.user.id, { kind: 'exception', startsAt: new Date(Date.now() - DAY), endsAt: null });

    const res = await request(app).get('/api/v1/admin/plan/dry-run').query({ limit: 200 }).set(auth(support.token));
    expect(res.status).toBe(200);
    const ids = res.body.users.map((r: { id: number }) => r.id);
    expect(ids).toContain(ended.user.id);
    expect(ids).not.toContain(running.user.id);
    expect(ids).not.toContain(company.user.id);
    expect(ids).not.toContain(excepted.user.id);
    expect(res.body).toMatchObject({ enforced: false, existing_notice_at: null });
    expect(res.body.would_lose).toBeGreaterThanOrEqual(1);
  });

  it('ignores accounts an admin has switched off', async () => {
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -5);
    await db.update(users).set({ isActive: false }).where(eq(users.id, u.user.id));
    const res = await request(app).get('/api/v1/admin/plan/dry-run').query({ limit: 200 }).set(auth(admin.token));
    expect(res.body.users.map((r: { id: number }) => r.id)).not.toContain(u.user.id);
  });
});

describe('the notice to existing users', () => {
  it('moves end dates to at least the notice period, emails each person once with their own date, and is safe to repeat', async () => {
    const early = await makeCustomer(); // joined long ago: already ended
    const soon = await makeCustomer(); // ends in 10 days
    const later = await makeCustomer(); // ends in 100 days
    await setTrialEnd(early.user.id, -100);
    await setTrialEnd(soon.user.id, 10);
    await setTrialEnd(later.user.id, 100);
    const ids = [early.user.id, soon.user.id, later.user.id];
    const now = new Date();

    outbox.length = 0;
    const first = await notifyExistingUsers(admin.id, now, ids);
    expect(first).toMatchObject({ emailed: 3, extended: 2, customers: 3 });

    const endOf = async (id: number) => (await userGrants(id))[0].endsAt!.getTime();
    const floor = now.getTime() + 30 * DAY;
    expect(await endOf(early.user.id)).toBe(floor);
    expect(await endOf(soon.user.id)).toBe(floor);
    expect(Math.abs((await endOf(later.user.id)) - (now.getTime() + 100 * DAY))).toBeLessThan(5000); // untouched

    for (const u of [early, soon, later]) {
      const mails = outbox.filter((m) => m.to === u.user.email);
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toMatch(/Your free full access ends on/);
      expect(mails[0].text).toContain('₹200 / year');
      expect(mails[0].text).toContain('Nothing you');
    }
    expect(plan.plan.existing_notice_at).not.toBeNull();

    outbox.length = 0;
    const second = await notifyExistingUsers(admin.id, now, ids);
    expect(second.emailed).toBe(0);
    expect(outbox.filter((m) => ids.includes(0) || [early, soon, later].some((u) => u.user.email === m.to))).toHaveLength(0);
  });

  it('does not email company accounts, accounts with an exception, or switched-off accounts', async () => {
    const company = await makeCustomer();
    const excepted = await makeCustomer();
    const off = await makeCustomer();
    await setKind(company.user.id, 'company');
    await giveGrant(excepted.user.id, { kind: 'exception', startsAt: new Date(Date.now() - DAY), endsAt: null });
    await db.update(users).set({ isActive: false }).where(eq(users.id, off.user.id));
    outbox.length = 0;
    await notifyExistingUsers(admin.id, new Date(), [company.user.id, excepted.user.id, off.user.id]);
    expect(outbox).toHaveLength(0);
  });

  it('through the app: admin only, with the password, and logged', async () => {
    const support = await makeSupport();
    const spy = jest.spyOn(noticesLib, 'notifyExistingUsers').mockResolvedValue({ emailed: 7, extended: 2, customers: 9 });
    try {
      expect((await request(app).post('/api/v1/admin/plan/notify-existing').set(auth(support.token)).send({ password: PASSWORD })).status).toBe(403);
      expect((await request(app).post('/api/v1/admin/plan/notify-existing').set(auth(admin.token)).send({})).status).toBe(400);
      expect((await request(app).post('/api/v1/admin/plan/notify-existing').set(auth(admin.token)).send({ password: 'nope-nope' })).status).toBe(403);
      expect(spy).not.toHaveBeenCalled();
      const ok = await request(app).post('/api/v1/admin/plan/notify-existing').set(auth(admin.token)).send({ password: PASSWORD });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({ emailed: 7, extended: 2, customers: 9 });
      expect((await auditFor('plan_notice_sent')).some((a) => a.details?.includes('7 emailed'))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the enforcement switch', () => {
  const flip = (token: string, body: Record<string, unknown>) => request(app).put('/api/v1/admin/plan/enforcement').set(auth(token)).send(body);

  it('asks for the password, admins only', async () => {
    const support = await makeSupport();
    expect((await flip(support.token, { on: true, password: PASSWORD })).status).toBe(403);
    expect((await flip(admin.token, { on: true })).status).toBe(400);
    expect((await flip(admin.token, { on: true, password: 'wrong-wrong' })).status).toBe(403);
    expect(plan.plan.enforced).toBe(false);
  });

  it('will not turn on before existing users have had the notice', async () => {
    await makeCustomer();
    const res = await flip(admin.token, { on: true, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/notice/i);
    expect(plan.plan.enforced).toBe(false);
  });

  it('turns on after the notice, logs it, and can be turned off again as the rollback', async () => {
    plan.plan = { ...plan.plan, existing_notice_at: new Date().toISOString() };
    const on = await flip(admin.token, { on: true, password: PASSWORD });
    expect(on.status).toBe(200);
    expect(on.body.enforced).toBe(true);
    expect(on.body.enforced_at).not.toBeNull();
    expect((await auditFor('plan_enforcement')).some((a) => a.details === 'enforcement turned ON')).toBe(true);

    const again = await flip(admin.token, { on: true, password: PASSWORD });
    expect(again.status).toBe(200);

    const off = await flip(admin.token, { on: false, password: PASSWORD });
    expect(off.body.enforced).toBe(false);
    expect((await auditFor('plan_enforcement')).some((a) => a.details === 'enforcement turned OFF')).toBe(true);
  });

  it('switching it off straight away gives everyone their access back', async () => {
    plan.plan = { ...plan.plan, enforced: true, existing_notice_at: new Date().toISOString() };
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -3);
    expect((await me(u.accessToken)).features).toEqual([]);
    await flip(admin.token, { on: false, password: PASSWORD }).expect(200);
    await db.insert((await import('../db/schema')).userFeatures).values({ userId: u.user.id, featureKey: 'goals', status: 'on', source: 'default' });
    expect((await me(u.accessToken)).features).toEqual(['goals']);
  });
});

describe('company accounts', () => {
  const setKindApi = (token: string, id: number, kind: string) => request(app).put(`/api/v1/admin/users/${id}/account-kind`).set(auth(token)).send({ kind });

  it('an admin can mark an account Company and back, and it is logged', async () => {
    const u = await makeCustomer();
    expect((await setKindApi(admin.token, u.user.id, 'company')).body).toEqual({ account_kind: 'company' });
    expect((await me(u.accessToken)).accountKind).toBe('company');
    expect((await setKindApi(admin.token, u.user.id, 'customer')).body).toEqual({ account_kind: 'customer' });
    const log = await db.select().from(adminAuditLog).where(and(eq(adminAuditLog.targetId, u.user.id), eq(adminAuditLog.action, 'account_kind_changed')));
    expect(log.map((l) => l.details).sort()).toEqual(['company -> customer', 'customer -> company']);
  });

  it('is admin only, refuses nonsense, and nobody changes their own', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    expect((await setKindApi(support.token, u.user.id, 'company')).status).toBe(403);
    expect((await setKindApi(u.accessToken, u.user.id, 'company')).status).toBe(403);
    expect((await setKindApi(admin.token, u.user.id, 'staff')).status).toBe(400);
    expect((await setKindApi(admin.token, admin.id, 'customer')).status).toBe(403);
    expect((await setKindApi(admin.token, 999999999, 'company')).status).toBe(404);
  });

  it('leaves a changed-to-customer account without a free period, so an admin decides what it gets', async () => {
    plan.plan = { ...plan.plan, enforced: true, existing_notice_at: new Date().toISOString() };
    const u = await makeCustomer();
    await clearGrants(u.user.id);
    await setKind(u.user.id, 'company');
    expect((await me(u.accessToken)).plan.state).toBe('company');
    await setKindApi(admin.token, u.user.id, 'customer').expect(200);
    expect((await me(u.accessToken)).plan.state).toBe('none');
  });
});

describe('exceptions', () => {
  const setEx = (token: string, id: number, body: Record<string, unknown>) => request(app).put(`/api/v1/admin/users/${id}/exception`).set(auth(token)).send(body);
  const ymd = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

  it('needs a reason, and an end date is optional', async () => {
    const u = await makeCustomer();
    expect((await setEx(admin.token, u.user.id, { on: true })).status).toBe(400);
    expect((await setEx(admin.token, u.user.id, { on: true, reason: '  ' })).status).toBe(400);
    expect((await setEx(admin.token, u.user.id, { on: true, reason: 'ok' })).status).toBe(400); // too short to review later
    const open = await setEx(admin.token, u.user.id, { on: true, reason: 'Pilot partner' });
    expect(open.status).toBe(200);
    expect(open.body).toEqual({ on: true, ends_at: null });
  });

  it('with a date, lasts through the end of that day in India, and then stops', async () => {
    plan.plan = { ...plan.plan, enforced: true, existing_notice_at: new Date().toISOString() };
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -5);
    const res = await setEx(admin.token, u.user.id, { on: true, reason: 'Scholarship student', until: ymd(10) });
    expect(res.status).toBe(200);
    expect(new Date(res.body.ends_at).toISOString()).toBe(new Date(`${ymd(10)}T23:59:59+05:30`).toISOString());
    expect((await me(u.accessToken)).plan.state).toBe('exception');

    await db.update(accessGrants).set({ endsAt: new Date(Date.now() - 1000), startsAt: new Date(Date.now() - 20 * DAY) }).where(and(eq(accessGrants.userId, u.user.id), eq(accessGrants.kind, 'exception')));
    expect((await me(u.accessToken)).plan.state).toBe('none');
  });

  it('refuses a date in the past, a made-up date, a date more than five years away, and a bad format', async () => {
    const u = await makeCustomer();
    const bad = (until: string) => setEx(admin.token, u.user.id, { on: true, reason: 'Scholarship', until });
    expect((await bad(ymd(-1))).status).toBe(400);
    expect((await bad(ymd(0).slice(0, 8) + '99')).status).toBe(400);
    expect((await bad(ymd(365 * 6))).status).toBe(400);
    expect((await bad('next week')).status).toBe(400);
    expect((await userGrants(u.user.id)).filter((g) => g.kind === 'exception')).toHaveLength(0);
  });

  it('a new exception replaces the old one, which stays in the history; turning it off ends it', async () => {
    const u = await makeCustomer();
    await setEx(admin.token, u.user.id, { on: true, reason: 'First reason', until: ymd(30) }).expect(200);
    await setEx(admin.token, u.user.id, { on: true, reason: 'Second reason' }).expect(200);
    let grants = (await userGrants(u.user.id)).filter((g) => g.kind === 'exception');
    expect(grants).toHaveLength(2);
    expect(grants.filter((g) => !g.revokedAt)).toHaveLength(1);
    expect(grants.find((g) => !g.revokedAt)!.reason).toBe('Second reason');

    await setEx(admin.token, u.user.id, { on: false }).expect(200);
    grants = (await userGrants(u.user.id)).filter((g) => g.kind === 'exception');
    expect(grants.every((g) => g.revokedAt)).toBe(true);
    expect((await setEx(admin.token, u.user.id, { on: false })).status).toBe(200); // already off: no error
  });

  it('is admin only, and meaningless for a company account', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    expect((await setEx(support.token, u.user.id, { on: true, reason: 'Because' })).status).toBe(403);
    expect((await setEx(u.accessToken, u.user.id, { on: true, reason: 'Because' })).status).toBe(403);
    await setKind(u.user.id, 'company');
    expect((await setEx(admin.token, u.user.id, { on: true, reason: 'Because' })).status).toBe(400);
    expect((await setEx(admin.token, 999999999, { on: true, reason: 'Because' })).status).toBe(404);
  });

  it('is logged with the reason and the date', async () => {
    const u = await makeCustomer();
    await setEx(admin.token, u.user.id, { on: true, reason: 'Pilot partner', until: ymd(20) }).expect(200);
    await setEx(admin.token, u.user.id, { on: false }).expect(200);
    const rows = await db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, u.user.id));
    expect(rows.find((r) => r.action === 'exception_set')!.details).toContain(`Pilot partner; until ${ymd(20)}`);
    expect(rows.some((r) => r.action === 'exception_cleared')).toBe(true);
  });

  it('the exceptions list shows reasons and end dates, and flags ones with no end', async () => {
    const support = await makeSupport();
    const dated = await makeCustomer();
    const open = await makeCustomer();
    const soon = await makeCustomer();
    await setEx(admin.token, dated.user.id, { on: true, reason: 'Dated one', until: ymd(60) }).expect(200);
    await setEx(admin.token, open.user.id, { on: true, reason: 'Open ended one' }).expect(200);
    await setEx(admin.token, soon.user.id, { on: true, reason: 'Ending soon one', until: ymd(5) }).expect(200);

    const list = async (filter?: string) =>
      (await request(app).get('/api/v1/admin/exceptions').query(filter ? { filter } : {}).set(auth(support.token)).expect(200)).body as { userId: number; reason: string; noEnd: boolean; by: string }[];
    const all = await list();
    expect(all.find((r) => r.userId === open.user.id)).toMatchObject({ reason: 'Open ended one', noEnd: true, by: admin.email });
    expect(all.find((r) => r.userId === dated.user.id)!.noEnd).toBe(false);
    expect((await list('no_end')).map((r) => r.userId)).toContain(open.user.id);
    expect((await list('no_end')).map((r) => r.userId)).not.toContain(dated.user.id);
    expect((await list('ending_soon')).map((r) => r.userId)).toContain(soon.user.id);
    expect((await list('ending_soon')).map((r) => r.userId)).not.toContain(dated.user.id);
    expect((await request(app).get('/api/v1/admin/exceptions').set(auth((await makeCustomer()).accessToken))).status).toBe(403);
  });

  it('an ended or removed exception is not listed', async () => {
    const u = await makeCustomer();
    await setEx(admin.token, u.user.id, { on: true, reason: 'Short one', until: ymd(3) }).expect(200);
    await setEx(admin.token, u.user.id, { on: false }).expect(200);
    const list = (await request(app).get('/api/v1/admin/exceptions').set(auth(admin.token))).body as { userId: number }[];
    expect(list.map((r) => r.userId)).not.toContain(u.user.id);
  });
});

describe("one user's access sheet", () => {
  it('shows the type, where they stand, the history and any exception', async () => {
    const support = await makeSupport();
    const u = await makeCustomer();
    await request(app).put(`/api/v1/admin/users/${u.user.id}/exception`).set(auth(admin.token)).send({ on: true, reason: 'Pilot partner' }).expect(200);
    const res = await request(app).get(`/api/v1/admin/users/${u.user.id}/access`).set(auth(support.token));
    expect(res.status).toBe(200);
    expect(res.body.account_kind).toBe('customer');
    expect(res.body.access.state).toBe('exception');
    expect(res.body.exception).toMatchObject({ reason: 'Pilot partner', ends_at: null });
    expect(res.body.grants.map((g: { kind: string }) => g.kind).sort()).toEqual(['exception', 'trial']);
    expect(res.body.pending_claims).toBe(0);
    expect((await request(app).get(`/api/v1/admin/users/${u.user.id}/access`).set(auth(u.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/users/999999999/access').set(auth(admin.token))).status).toBe(404);
  });
});

describe('the expiring-soon list', () => {
  it('shows who ends in the next 30 days and who ended in the last 30, and leaves out everyone else', async () => {
    const soon = await makeCustomer();
    const justEnded = await makeCustomer();
    const far = await makeCustomer();
    const longGone = await makeCustomer();
    const company = await makeCustomer();
    const excepted = await makeCustomer();
    await setTrialEnd(soon.user.id, 10);
    await setTrialEnd(justEnded.user.id, -5);
    await setTrialEnd(far.user.id, 90);
    await setTrialEnd(longGone.user.id, -90);
    await setTrialEnd(company.user.id, 5);
    await setKind(company.user.id, 'company');
    await setTrialEnd(excepted.user.id, 5);
    await giveGrant(excepted.user.id, { kind: 'exception', startsAt: new Date(Date.now() - DAY), endsAt: null });

    const res = await request(app).get('/api/v1/admin/plan/expiring').set(auth(admin.token));
    expect(res.status).toBe(200);
    const ending = res.body.ending.map((r: { id: number }) => r.id);
    const ended = res.body.ended.map((r: { id: number }) => r.id);
    expect(ending).toContain(soon.user.id);
    expect(ended).toContain(justEnded.user.id);
    for (const id of [far.user.id, longGone.user.id, company.user.id, excepted.user.id]) {
      expect(ending).not.toContain(id);
      expect(ended).not.toContain(id);
    }
    expect(res.body.pending_claims).toEqual(expect.any(Number));
  });
});

describe('reminder emails', () => {
  const enforce = () => {
    plan.plan = { ...plan.plan, enforced: true, existing_notice_at: new Date().toISOString() };
  };
  const mailsTo = (u: { user: { email: string } }) => outbox.filter((m) => m.to === u.user.email && !/Welcome/.test(m.subject));
  const noticeRows = (id: number) => db.select().from(accessNotices).where(eq(accessNotices.userId, id));

  it('says nothing until the plan is enforced', async () => {
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, 10);
    outbox.length = 0;
    expect(await runAccessNotices(new Date(), [u.user.id])).toBe(0);
    expect(mailsTo(u)).toHaveLength(0);
  });

  it('sends each stage once as the end date comes closer, and never repeats', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, 25);
    const ids = [u.user.id];
    const day = (n: number) => new Date(Date.now() + n * DAY);

    outbox.length = 0;
    expect(await runAccessNotices(day(0), ids)).toBe(1);
    expect(mailsTo(u).map((m) => m.subject)).toEqual(['Your full access ends in 30 days']);
    expect(await runAccessNotices(day(0), ids)).toBe(0);
    expect(await runAccessNotices(day(5), ids)).toBe(0); // 20 days left: still the 30-day stage, already sent

    expect(await runAccessNotices(day(19), ids)).toBe(1); // 6 days left
    expect(mailsTo(u).pop()!.subject).toBe('Your full access ends in 7 days');
    expect(await runAccessNotices(day(24.5), ids)).toBe(1); // under a day
    expect(mailsTo(u).pop()!.subject).toBe('Your full access ends tomorrow');
    expect(await runAccessNotices(day(26), ids)).toBe(1);
    const last = mailsTo(u).pop()!;
    expect(last.subject).toMatch(/access has ended/i);
    expect(last.text).toContain('Your data is safe');
    expect(await runAccessNotices(day(26), ids)).toBe(0);
    expect(await runAccessNotices(day(27), ids)).toBe(0);
    expect(mailsTo(u)).toHaveLength(4);
  });

  it('someone who joins close to the end gets one email, not a pile', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, 5);
    outbox.length = 0;
    expect(await runAccessNotices(new Date(), [u.user.id])).toBe(1);
    expect(mailsTo(u)).toHaveLength(1);
    expect(mailsTo(u)[0].subject).toBe('Your full access ends in 7 days');
    const rows = await noticeRows(u.user.id);
    expect(rows.filter((r) => r.suppressed).map((r) => r.kind)).toEqual(['d30']);
    expect(await runAccessNotices(new Date(), [u.user.id])).toBe(0);
  });

  it('someone whose access already ended is told once that it ended', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, -3);
    outbox.length = 0;
    expect(await runAccessNotices(new Date(), [u.user.id])).toBe(1);
    expect(mailsTo(u)[0].subject).toMatch(/access has ended/i);
    expect(await runAccessNotices(new Date(), [u.user.id])).toBe(0);
  });

  it('does not write to company accounts, exception holders, switched-off accounts, or people with plenty of time', async () => {
    enforce();
    const company = await makeCustomer();
    const excepted = await makeCustomer();
    const off = await makeCustomer();
    const plenty = await makeCustomer();
    for (const u of [company, excepted, off]) await setTrialEnd(u.user.id, 5);
    await setTrialEnd(plenty.user.id, 120);
    await setKind(company.user.id, 'company');
    await giveGrant(excepted.user.id, { kind: 'exception', startsAt: new Date(Date.now() - DAY), endsAt: null });
    await db.update(users).set({ isActive: false }).where(eq(users.id, off.user.id));
    outbox.length = 0;
    expect(await runAccessNotices(new Date(), [company, excepted, off, plenty].map((u) => u.user.id))).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it('a renewal starts a fresh set of reminders for the new end date', async () => {
    enforce();
    const u = await makeCustomer();
    await setTrialEnd(u.user.id, 5);
    await runAccessNotices(new Date(), [u.user.id]);
    await giveGrant(u.user.id, { kind: 'paid', startsAt: new Date(Date.now() + 5 * DAY), endsAt: new Date(Date.now() + 5 * DAY + 20 * DAY) });
    outbox.length = 0;
    expect(await runAccessNotices(new Date(), [u.user.id])).toBe(1);
    expect(mailsTo(u)[0].subject).toBe('Your full access ends in 30 days');
  });

  it("a paid user's reminder says renewing adds a year after the current end, so no time is lost", async () => {
    enforce();
    const u = await makeCustomer();
    await clearGrants(u.user.id);
    await giveGrant(u.user.id, { kind: 'paid', startsAt: new Date(Date.now() - 340 * DAY), endsAt: new Date(Date.now() + 20 * DAY) });
    outbox.length = 0;
    await runAccessNotices(new Date(), [u.user.id]);
    expect(mailsTo(u)[0].text).toContain('no time is lost');
  });
});

describe('only admins do money things', () => {
  it('a system manager can read the plan page but not change anything', async () => {
    const sm = await registerUser({ features: [] });
    await (await import('./helpers')).promoteToSystemManager(sm.user.id);
    expect((await request(app).get('/api/v1/admin/plan').set(auth(sm.accessToken))).status).toBe(200);
    expect((await request(app).put('/api/v1/admin/plan').set(auth(sm.accessToken)).send(validPlan)).status).toBe(403);
    expect((await request(app).put('/api/v1/admin/plan/enforcement').set(auth(sm.accessToken)).send({ on: true, password: PASSWORD })).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/payments').set(auth(sm.accessToken))).status).toBe(200);
    expect((await request(app).post('/api/v1/admin/payments/1/confirm').set(auth(sm.accessToken)).send({})).status).toBe(403);
  });

  it('a user promoted to admin gets the powers at once, and loses them when demoted', async () => {
    const u = await makeCustomer();
    expect((await request(app).put('/api/v1/admin/plan').set(auth(u.accessToken)).send(validPlan)).status).toBe(403);
    await promoteToAdmin(u.user.id);
    expect((await request(app).put('/api/v1/admin/plan').set(auth(u.accessToken)).send(validPlan)).status).toBe(200);
    await db.update(users).set({ role: 'user' }).where(eq(users.id, u.user.id));
    expect((await request(app).put('/api/v1/admin/plan').set(auth(u.accessToken)).send(validPlan)).status).toBe(403);
  });
});
