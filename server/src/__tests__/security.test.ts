import request from 'supertest';
import { app, uniqueEmail, registerUser, promoteToAdmin } from './helpers';
import { transactionsToCsv } from '../calculations';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// jsonwebtoken's iat is whole seconds; the session cutoff deliberately keeps
// tokens issued in the same second as the change, so wait past that second.
const nextSecond = () => new Promise((r) => setTimeout(r, 1100));

describe('ending sessions takes effect immediately', () => {
  it('a password change rejects access tokens issued before it, but the new pair works', async () => {
    const email = uniqueEmail('cutoff-pw');
    const first = await registerUser({ email, password: 'password123' });
    const other = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });
    await nextSecond();

    const changed = await request(app).post('/api/v1/auth/me/password').set(auth(first.accessToken)).send({ currentPassword: 'password123', newPassword: 'password456' });
    expect(changed.status).toBe(200);

    expect((await request(app).get('/api/v1/auth/me').set(auth(other.body.accessToken))).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(auth(first.accessToken))).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(auth(changed.body.accessToken))).status).toBe(200);
  });

  it('sign out everywhere rejects every existing access token', async () => {
    const { accessToken } = await registerUser();
    await nextSecond();
    expect((await request(app).post('/api/v1/auth/me/logout-all').set(auth(accessToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/transactions').set(auth(accessToken))).status).toBe(401);
  });

  it('deactivation by an admin cuts off the access token and the refresh token at once', async () => {
    const admin = await registerUser({ email: uniqueEmail('cutoff-admin') });
    await promoteToAdmin(admin.user.id);
    const target = await registerUser();

    await request(app).patch(`/api/v1/admin/users/${target.user.id}`).set(auth(admin.accessToken)).send({ isActive: false });
    expect((await request(app).get('/api/v1/transactions').set(auth(target.accessToken))).status).toBe(401);
    await request(app).patch(`/api/v1/admin/users/${target.user.id}`).set(auth(admin.accessToken)).send({ isActive: true });
    // Reactivating doesn't revive the old session: its refresh token was revoked.
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: target.refreshToken })).status).toBe(401);
  });
});

describe('input validation returns 400, never 500', () => {
  it('rejects a non-numeric or negative id', async () => {
    const { accessToken } = await registerUser();
    for (const path of ['/api/v1/transactions/abc', '/api/v1/loans/-1', '/api/v1/goals/1.5', '/api/v1/accounts/99999999999999999999']) {
      expect((await request(app).delete(path).set(auth(accessToken))).status).toBe(400);
    }
  });

  it('rejects amounts beyond the column size and over-long text', async () => {
    const { accessToken } = await registerUser();
    const base = { type: 'expense', category_key: 'internet', date: '2026-09-01' };
    expect((await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ ...base, amount: 1e13 })).status).toBe(400);
    expect((await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ ...base, amount: 5, note: 'x'.repeat(501) })).status).toBe(400);
    expect((await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'G', target_amount: 1e13 })).status).toBe(400);
    expect((await request(app).post('/api/v1/investments').set(auth(accessToken)).send({ name: 'I', type: 'MF', amount: 100, current_value: -5 })).status).toBe(400);
  });
});

describe('security headers', () => {
  it('sends helmet headers and no X-Powered-By', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas and quotes line breaks', () => {
    const csv = transactionsToCsv([
      { id: 1, amount: 5, type: 'expense', category: 'internet', note: '=HYPERLINK("http://x")', date: '2026-09-01', month: 9, year: 2026, created_at: '' },
      { id: 2, amount: 5, type: 'expense', category: 'internet', note: 'a\rb', date: '2026-09-01', month: 9, year: 2026, created_at: '' },
    ]);
    const [, first, second] = csv.split('\n');
    expect(first).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(second).toContain('"a\rb"');
  });
});

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('login does not reveal which emails have accounts', () => {
  it('runs the bcrypt comparison for an unknown email too, so timing matches a wrong password', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bcrypt = require('bcrypt');
    const spy = jest.spyOn(bcrypt, 'compare');
    try {
      const res = await request(app).post('/api/v1/auth/login').send({ email: uniqueEmail('nobody'), password: 'whatever123' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password.');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
