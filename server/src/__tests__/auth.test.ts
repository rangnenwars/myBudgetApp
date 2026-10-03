import request from 'supertest';
import { app, uniqueEmail, registerUser } from './helpers';

describe('POST /api/v1/auth/register', () => {
  it('creates an account and returns tokens', async () => {
    const email = uniqueEmail('register');
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'Alice', email, password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Alice', email, tier: 'standard', budgetClass: null, role: 'user', isActive: true });
    expect(res.body.user.id).toEqual(expect.any(Number));
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    // Never leak the hash.
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail('dup');
    await request(app).post('/api/v1/auth/register').send({ name: 'A', email, password: 'password123' });
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'B', email, password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('treats email case-insensitively for the duplicate check', async () => {
    const email = uniqueEmail('case');
    await request(app).post('/api/v1/auth/register').send({ name: 'A', email, password: 'password123' });
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'B', email: email.toUpperCase(), password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('rejects a short password with 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'A', email: uniqueEmail('short'), password: '123' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid email with 400', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ name: 'A', email: 'not-an-email', password: 'password123' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const email = uniqueEmail('login');
    await registerUser({ email, password: 'password123' });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('rejects a wrong password with a generic 401 (no user-enumeration hint)', async () => {
    const email = uniqueEmail('wrongpw');
    await registerUser({ email, password: 'password123' });
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with the same generic 401', async () => {
    const known = await request(app).post('/api/v1/auth/login').send({ email: uniqueEmail('never-registered'), password: 'password123' });
    const unknown = await request(app).post('/api/v1/auth/login').send({ email: uniqueEmail('also-never'), password: 'password123' });
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(known.body.error).toBe(unknown.body.error);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('requires a bearer token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'not-bearer-format');
    expect(res.status).toBe(401);
  });

  it('rejects a garbage token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('returns the authenticated user profile', async () => {
    const { accessToken, user } = await registerUser();
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.email).toBe(user.email);
  });
});

describe('PATCH /api/v1/auth/me/tier', () => {
  it('flips tier to pro and back (the local "Try Pro" toggle)', async () => {
    const { accessToken } = await registerUser();
    const up = await request(app).patch('/api/v1/auth/me/tier').set('Authorization', `Bearer ${accessToken}`).send({ tier: 'pro' });
    expect(up.status).toBe(200);
    expect(up.body.tier).toBe('pro');

    const down = await request(app).patch('/api/v1/auth/me/tier').set('Authorization', `Bearer ${accessToken}`).send({ tier: 'standard' });
    expect(down.body.tier).toBe('standard');
  });

  it('rejects an invalid tier value', async () => {
    const { accessToken } = await registerUser();
    const res = await request(app).patch('/api/v1/auth/me/tier').set('Authorization', `Bearer ${accessToken}`).send({ tier: 'ultra' });
    expect(res.status).toBe(400);
  });

  describe('when self-service plan changes are off', () => {
    const saved = { nodeEnv: process.env.NODE_ENV, allow: process.env.ALLOW_SELF_TIER_CHANGE };
    afterEach(() => {
      process.env.NODE_ENV = saved.nodeEnv;
      if (saved.allow === undefined) delete process.env.ALLOW_SELF_TIER_CHANGE;
      else process.env.ALLOW_SELF_TIER_CHANGE = saved.allow;
    });

    it('is refused with 403 by default in production, and the tier is unchanged', async () => {
      const { accessToken } = await registerUser();
      delete process.env.ALLOW_SELF_TIER_CHANGE;
      process.env.NODE_ENV = 'production';
      const res = await request(app).patch('/api/v1/auth/me/tier').set('Authorization', `Bearer ${accessToken}`).send({ tier: 'pro' });
      expect(res.status).toBe(403);

      process.env.NODE_ENV = saved.nodeEnv;
      const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
      expect(me.body.tier).toBe('standard');
    });

    it('is allowed in production only when ALLOW_SELF_TIER_CHANGE=true, and refused anywhere when it is false', async () => {
      const { accessToken } = await registerUser();
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_SELF_TIER_CHANGE = 'true';
      const allowed = await request(app).patch('/api/v1/auth/me/tier').set('Authorization', `Bearer ${accessToken}`).send({ tier: 'pro' });
      expect(allowed.status).toBe(200);

      process.env.NODE_ENV = saved.nodeEnv;
      process.env.ALLOW_SELF_TIER_CHANGE = 'false';
      const refused = await request(app).patch('/api/v1/auth/me/tier').set('Authorization', `Bearer ${accessToken}`).send({ tier: 'standard' });
      expect(refused.status).toBe(403);
    });
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('issues a new token pair and rotates the old refresh token out', async () => {
    const { refreshToken } = await registerUser();

    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);

    // The original token was single-use — reusing it must fail.
    const reused = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reused.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the refresh token so it can no longer be used', async () => {
    const { refreshToken } = await registerUser();

    const logout = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(204);

    const afterLogout = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(afterLogout.status).toBe(401);
  });
});
