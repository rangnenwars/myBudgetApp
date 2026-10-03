import request from 'supertest';
import { app, uniqueEmail, registerUser } from './helpers';

// The web client's refresh-token transport (routes/auth.ts): opting in with
// X-Refresh-Transport: cookie moves the refresh token out of the JSON body
// and into an httpOnly cookie scoped to /api/v1/auth.
const COOKIE_HEADER = { 'X-Refresh-Transport': 'cookie' };

const refreshCookieFrom = (res: request.Response): string | undefined => {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  return setCookie?.find((c) => c.startsWith('mb_refresh='));
};

describe('web refresh-token cookie', () => {
  it('login sets an httpOnly, SameSite=Strict cookie and leaves the refresh token out of the body', async () => {
    const email = uniqueEmail('cookie-login');
    await registerUser({ email, password: 'password123' });

    const res = await request(app).post('/api/v1/auth/login').set(COOKIE_HEADER).send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();

    const cookie = refreshCookieFrom(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('refresh with the cookie rotates it, and the old cookie value then fails', async () => {
    const email = uniqueEmail('cookie-refresh');
    await registerUser({ email, password: 'password123' });
    const agent = request.agent(app);

    await agent.post('/api/v1/auth/login').set(COOKIE_HEADER).send({ email, password: 'password123' });
    const first = await agent.post('/api/v1/auth/refresh').set(COOKIE_HEADER).send({});
    expect(first.status).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    expect(first.body.refreshToken).toBeUndefined();
    const oldCookie = refreshCookieFrom(first);
    expect(oldCookie).toBeTruthy();

    // The agent now holds the rotated cookie; a second refresh works too.
    expect((await agent.post('/api/v1/auth/refresh').set(COOKIE_HEADER).send({})).status).toBe(200);
    // Replaying the cookie issued by the first refresh is refused.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set(COOKIE_HEADER)
      .set('Cookie', oldCookie!.split(';')[0])
      .send({});
    expect(replay.status).toBe(401);
  });

  it('the cookie is ignored without the opt-in header (no cross-site refresh)', async () => {
    const email = uniqueEmail('cookie-noheader');
    await registerUser({ email, password: 'password123' });
    const login = await request(app).post('/api/v1/auth/login').set(COOKIE_HEADER).send({ email, password: 'password123' });
    const cookie = refreshCookieFrom(login)!.split(';')[0];

    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(401);
  });

  it('logout revokes the cookie token and clears the cookie', async () => {
    const email = uniqueEmail('cookie-logout');
    await registerUser({ email, password: 'password123' });
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').set(COOKIE_HEADER).send({ email, password: 'password123' });
    const cookie = refreshCookieFrom(login)!.split(';')[0];

    const out = await agent.post('/api/v1/auth/logout').set(COOKIE_HEADER).send({});
    expect(out.status).toBe(204);
    expect(refreshCookieFrom(out)).toMatch(/Expires=Thu, 01 Jan 1970/);

    const after = await request(app).post('/api/v1/auth/refresh').set(COOKIE_HEADER).set('Cookie', cookie).send({});
    expect(after.status).toBe(401);
  });

  it('logout without a token in the body or the opt-in header is a 400', async () => {
    expect((await request(app).post('/api/v1/auth/logout').send({})).status).toBe(400);
  });
});

describe('refresh token rotation under concurrency', () => {
  it('two simultaneous refreshes with the same token: exactly one succeeds', async () => {
    const { refreshToken } = await registerUser();
    const results = await Promise.all([
      request(app).post('/api/v1/auth/refresh').send({ refreshToken }),
      request(app).post('/api/v1/auth/refresh').send({ refreshToken }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });
});

describe('login email lookup', () => {
  it('matches case-insensitively', async () => {
    const email = uniqueEmail('casecheck');
    await registerUser({ email, password: 'password123' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: email.toUpperCase(), password: 'password123' });
    expect(res.status).toBe(200);
  });
});
