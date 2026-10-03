import request from 'supertest';
import { createApp } from '../app';

// CORS_ORIGIN is read when the app is built, so each test builds its own app
// with the env it wants. Only /health is hit — no database needed.
describe('CORS allow-list', () => {
  const original = process.env.CORS_ORIGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = original;
  });

  it('with CORS_ORIGIN unset (local dev), any origin is allowed', async () => {
    delete process.env.CORS_ORIGIN;
    const res = await request(createApp()).get('/health').set('Origin', 'http://localhost:8081');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  });

  it('with CORS_ORIGIN set, listed origins are allowed and others get no CORS header', async () => {
    process.env.CORS_ORIGIN = 'https://prapanji.in, https://www.prapanji.in';
    const app = createApp();

    const allowed = await request(app).get('/health').set('Origin', 'https://www.prapanji.in');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://www.prapanji.in');

    const blocked = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('requests with no Origin header (native app, curl) still succeed', async () => {
    process.env.CORS_ORIGIN = 'https://prapanji.in';
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
  });
});
