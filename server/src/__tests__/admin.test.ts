import request from 'supertest';
import { app, uniqueEmail, registerUser, promoteToAdmin, setUserActive } from './helpers';

const asAdmin = async () => {
  const admin = await registerUser({ email: uniqueEmail('admin') });
  await promoteToAdmin(admin.user.id);
  return admin;
};

describe('GET /api/v1/admin/users', () => {
  it('rejects a non-admin with 403', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(401);
  });

  it('lists accounts for an admin, without leaking password hashes', async () => {
    const admin = await asAdmin();
    const other = await registerUser({ email: uniqueEmail('listed') });

    const res = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(200);
    const emails = res.body.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining([admin.user.email, other.user.email]));
    for (const row of res.body) {
      expect(row.passwordHash).toBeUndefined();
      expect(row.password_hash).toBeUndefined();
    }
  });
});

describe('PATCH /api/v1/admin/users/:id', () => {
  it('lets an admin deactivate another user, blocking their next login', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('deactivate'), password: 'password123' });

    const patch = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(patch.status).toBe(200);
    expect(patch.body.isActive).toBe(false);

    const login = await request(app).post('/api/v1/auth/login').send({ email: target.user.email, password: 'password123' });
    expect(login.status).toBe(403);
  });

  it('lets an admin promote a user to admin', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('promote') });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('admin');
  });

  it('lets an admin change another user\'s tier', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('tier') });

    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ tier: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('pro');
  });

  it('refuses to let an admin modify their own account through this endpoint', async () => {
    const admin = await asAdmin();
    const res = await request(app)
      .patch(`/api/v1/admin/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it('lets an admin demote another admin back to a regular user', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('demote-admin') });
    await promoteToAdmin(target.user.id);

    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'user' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('user');
  });

  it('rejects a non-admin caller with 403', async () => {
    const { accessToken } = await registerUser();
    const target = await registerUser({ email: uniqueEmail('blocked') });
    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it('rejects an empty patch body', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('empty') });
    const res = await request(app)
      .patch(`/api/v1/admin/users/${target.user.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for a nonexistent account', async () => {
    const admin = await asAdmin();
    const res = await request(app)
      .patch('/api/v1/admin/users/999999999')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/v1/admin/users/:id', () => {
  it('lets an admin delete another user', async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('deleteme') });

    const del = await request(app).delete(`/api/v1/admin/users/${target.user.id}`).set('Authorization', `Bearer ${admin.accessToken}`);
    expect(del.status).toBe(204);

    const login = await request(app).post('/api/v1/auth/login').send({ email: target.user.email, password: 'password123' });
    expect(login.status).toBe(401);
  });

  it('refuses self-deletion', async () => {
    const admin = await asAdmin();
    const res = await request(app).delete(`/api/v1/admin/users/${admin.user.id}`).set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(400);
  });

  it('rejects a non-admin caller with 403', async () => {
    const { accessToken } = await registerUser();
    const target = await registerUser({ email: uniqueEmail('notdeleted') });
    const res = await request(app).delete(`/api/v1/admin/users/${target.user.id}`).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a nonexistent account', async () => {
    const admin = await asAdmin();
    const res = await request(app).delete('/api/v1/admin/users/999999999').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe('Deactivated account access', () => {
  it('blocks refresh once the account is deactivated mid-session', async () => {
    const user = await registerUser({ email: uniqueEmail('midsession') });
    await setUserActive(user.user.id, false);

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken });
    expect(res.status).toBe(401);
  });

  it("blocks a deactivated admin's still-live access token from the admin API", async () => {
    const admin = await asAdmin();
    await setUserActive(admin.user.id, false);

    const res = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(401);
  });
});

describe('Deleted account access', () => {
  it("a deleted account's still-live access token is rejected on /auth/me", async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('deleted-me') });

    await request(app).delete(`/api/v1/admin/users/${target.user.id}`).set('Authorization', `Bearer ${admin.accessToken}`);

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${target.accessToken}`);
    expect(res.status).toBe(401);
  });

  it("a deleted account's still-live access token is rejected on PATCH /auth/me/tier", async () => {
    const admin = await asAdmin();
    const target = await registerUser({ email: uniqueEmail('deleted-tier') });

    await request(app).delete(`/api/v1/admin/users/${target.user.id}`).set('Authorization', `Bearer ${admin.accessToken}`);

    const res = await request(app).patch('/api/v1/auth/me/tier').set('Authorization', `Bearer ${target.accessToken}`).send({ tier: 'pro' });
    // requireAuth now checks the account still exists on every request.
    expect(res.status).toBe(401);
  });
});
