import request from 'supertest';
import { app, uniqueEmail, registerUser, uniquePhone } from './helpers';

// The limiters skip under NODE_ENV=test (see middleware/rateLimit.ts) so the
// rest of the suite can register/log in freely; switched on per test here.
// Own file: the limiter's in-memory counters are per worker process, so the
// buckets filled here can't leak into another file's tests.
describe('auth rate limiting', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('a correct password is not counted, and the 11th failed login in the window is refused with 429', async () => {
    process.env.NODE_ENV = originalEnv;
    const target = await registerUser({ email: uniqueEmail('ratelimit'), password: 'password123' });
    process.env.NODE_ENV = 'development';

    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post('/api/v1/auth/login').send({ email: target.user.email, password: 'password123' });
      expect(ok.status).toBe(200);
    }
    for (let i = 0; i < 10; i++) {
      const bad = await request(app).post('/api/v1/auth/login').send({ email: target.user.email, password: 'wrong-password' });
      expect(bad.status).toBe(401);
    }
    const blocked = await request(app).post('/api/v1/auth/login').send({ email: target.user.email, password: 'password123' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Too many failed sign-in attempts/);
  });

  it('the 6th registration from one IP in the window is refused with 429', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/v1/auth/register').send({ name: 'R', email: uniqueEmail('reg-limit'), phone: uniquePhone(), password: 'password123' });
      expect(res.status).toBe(201);
    }
    const blocked = await request(app).post('/api/v1/auth/register').send({ name: 'R', email: uniqueEmail('reg-limit'), phone: uniquePhone(), password: 'password123' });
    expect(blocked.status).toBe(429);
  });
});
