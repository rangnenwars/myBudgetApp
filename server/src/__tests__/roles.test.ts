import request from 'supertest';
import { app, uniqueEmail, registerUser, promoteToAdmin, promoteToSupport, promoteToSystemManager } from './helpers';

const asAdmin = async () => {
  const admin = await registerUser({ email: uniqueEmail('admin') });
  await promoteToAdmin(admin.user.id);
  return admin;
};

const asSupport = async () => {
  const support = await registerUser({ email: uniqueEmail('support') });
  await promoteToSupport(support.user.id);
  return support;
};

const asSystemManager = async () => {
  const manager = await registerUser({ email: uniqueEmail('sysmgr') });
  await promoteToSystemManager(manager.user.id);
  return manager;
};

describe('support role — GET /api/v1/admin/users', () => {
  it('can list accounts, same as admin', async () => {
    const support = await asSupport();
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${support.accessToken}`);
    expect(res.status).toBe(200);
  });
});

describe('lastLoginAt', () => {
  it('is set on register and refreshed on login', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('lastlogin'), password: 'password123' });

    const afterRegister = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${admin.accessToken}`);
    const rowAfterRegister = afterRegister.body.find((u: { email: string }) => u.email === target.user.email);
    expect(rowAfterRegister.lastLoginAt).toBeTruthy();

    await request(app).post('/api/v1/auth/login').send({ email: target.user.email, password: 'password123' });

    const afterLogin = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${admin.accessToken}`);
    const rowAfterLogin = afterLogin.body.find((u: { email: string }) => u.email === target.user.email);
    expect(new Date(rowAfterLogin.lastLoginAt).getTime()).toBeGreaterThanOrEqual(new Date(rowAfterRegister.lastLoginAt).getTime());
  });
});

describe('support role — PATCH /api/v1/admin/users/:id', () => {
  it('can activate/deactivate a user, and it sets deactivatedAt', async () => {
    const support = await asSupport();
    const target = await registerUser({ email: uniqueEmail('support-deactivate') });

    const off = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${support.accessToken}`)
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    expect(off.body.deactivatedAt).toBeTruthy();

    const on = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${support.accessToken}`)
      .send({ isActive: true });
    expect(on.status).toBe(200);
    expect(on.body.deactivatedAt).toBeNull();
  });

  it('is rejected with 403 when it tries to change role', async () => {
    const support = await asSupport();
    const target = await registerUser({ email: uniqueEmail('support-role') });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${support.accessToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });

  it('is rejected with 403 when it tries to change tier', async () => {
    const support = await asSupport();
    const target = await registerUser({ email: uniqueEmail('support-tier') });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${support.accessToken}`)
      .send({ tier: 'pro' });
    expect(res.status).toBe(403);
  });

  it.each([
    ['an admin', asAdmin],
    ['another support account', asSupport],
    ['a system manager', asSystemManager],
  ])('is refused with 403 when deactivating %s, which stays active', async (_label, makeStaff) => {
    const support = await asSupport();
    const staff = await makeStaff();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${staff.user.id}`)
      .set('Authorization', `Bearer ${support.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(403);

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${staff.accessToken}`);
    expect(me.body.isActive).toBe(true);
  });
});

describe('support role — DELETE /api/v1/admin/users/:id', () => {
  it('is rejected with 403 — deletion stays admin-only', async () => {
    const support = await asSupport();
    const target = await registerUser({ email: uniqueEmail('support-delete') });

    const res = await request(app).delete(`/api/v1/admin/users/${target.user.id}`).set('Authorization', `Bearer ${support.accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe('system_manager role — account surface stays out of reach', () => {
  it('cannot list accounts via /api/v1/admin/users', async () => {
    const manager = await asSystemManager();
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${manager.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('cannot patch an account', async () => {
    const manager = await asSystemManager();
    const target = await registerUser({ email: uniqueEmail('sysmgr-patch') });
    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${manager.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });
});

describe('regular user — every staff surface stays out of reach', () => {
  it('gets 403 from /api/v1/admin/users, /api/v1/admin/audit-log, /api/v1/system/metrics', async () => {
    const { accessToken } = await registerUser();
    const results = await Promise.all([
      request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${accessToken}`),
      request(app).get('/api/v1/admin/audit-log').set('Authorization', `Bearer ${accessToken}`),
      request(app).get('/api/v1/system/metrics').set('Authorization', `Bearer ${accessToken}`),
    ]);
    for (const res of results) expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/system/metrics', () => {
  it('rejects a non-system-manager, non-admin caller with 403', async () => {
    const support = await asSupport();
    const res = await request(app).get('/api/v1/system/metrics').set('Authorization', `Bearer ${support.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('is reachable by admin and by system_manager, and never returns financial rows', async () => {
    const admin = await asAdmin();
    const manager = await asSystemManager();

    for (const token of [admin.accessToken, manager.accessToken]) {
      const res = await request(app).get('/api/v1/system/metrics').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.users.total).toBe('number');
      expect(typeof res.body.finance.estimatedAnnualCostInr).toBe('number');
      expect(res.body.finance.costPerUserPerYearInr).toBe(100);
      expect(JSON.stringify(res.body)).not.toMatch(/amount|principal|outstanding/i);
    }
  });
});

describe('GET /api/v1/admin/audit-log', () => {
  it('rejects support (admin-only) with 403', async () => {
    const support = await asSupport();
    const res = await request(app).get('/api/v1/admin/audit-log').set('Authorization', `Bearer ${support.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('records an entry when an admin changes an account, readable only by admin', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('audited') });

    await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ tier: 'standard' });

    const res = await request(app).get('/api/v1/admin/audit-log').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    const entry = res.body.find((row: { targetEmail: string }) => row.targetEmail === target.user.email);
    expect(entry).toBeTruthy();
    expect(entry.actorEmail).toBe(admin.user.email);
    expect(entry.action).toBe('account_updated');
    expect(entry.details).toContain('tier: pro -> standard');
  });

  it('keeps a readable entry after the target account is deleted', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('audit-then-delete') });

    await request(app).delete(`/api/v1/admin/users/${target.user.id}`).set('Authorization', `Bearer ${admin.accessToken}`);

    const res = await request(app).get('/api/v1/admin/audit-log').set('Authorization', `Bearer ${admin.accessToken}`);
    const entry = res.body.find((row: { targetEmail: string; action: string }) => row.targetEmail === target.user.email && row.action === 'account_deleted');
    expect(entry).toBeTruthy();
    expect(entry.targetId).toBeNull();
  });
});
