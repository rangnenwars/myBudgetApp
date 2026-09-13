import request from 'supertest';
import { app } from './helpers';

describe('GET /health', () => {
  it('responds ok, unauthenticated', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('unmatched routes', () => {
  it('returns a generic 404 JSON error', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
