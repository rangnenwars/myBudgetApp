import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, uniqueEmail, registerUser, promoteToAdmin } from './helpers';
import { outbox } from '../lib/accountMail';
import { db } from '../db/client';
import { userTokens } from '../db/schema';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The raw token from the last email sent to `to` (the link's ?token=…). */
const lastTokenSentTo = (to: string): string => {
  const mail = [...outbox].reverse().find((m) => m.to === to);
  if (!mail) throw new Error(`no email sent to ${to}`);
  return /token=([a-f0-9]+)/.exec(mail.text)![1];
};

describe('email verification', () => {
  it('sends a link on sign-up; opening it marks the email verified, and the link works once', async () => {
    const { user, accessToken } = await registerUser();
    expect(user).toMatchObject({ emailVerified: false });
    const mail = [...outbox].reverse().find((m) => m.to === user.email)!;
    expect(mail.subject).toMatch(/Confirm your email/);
    expect(mail.text).toMatch(/\/verify-email\?token=/);

    const token = lastTokenSentTo(user.email);
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
    expect(res.body.emailVerified).toBe(true);
    expect((await request(app).get('/api/v1/auth/me').set(auth(accessToken))).body.emailVerified).toBe(true);

    expect((await request(app).post('/api/v1/auth/verify-email').send({ token })).status).toBe(400);
  });

  it('resend replaces the earlier link, and is refused once verified', async () => {
    const { user, accessToken } = await registerUser();
    const first = lastTokenSentTo(user.email);
    expect((await request(app).post('/api/v1/auth/me/resend-verification').set(auth(accessToken))).status).toBe(204);
    const second = lastTokenSentTo(user.email);
    expect(second).not.toBe(first);

    expect((await request(app).post('/api/v1/auth/verify-email').send({ token: first })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/verify-email').send({ token: second })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/me/resend-verification').set(auth(accessToken))).status).toBe(400);
  });

  it('rejects an unknown token', async () => {
    expect((await request(app).post('/api/v1/auth/verify-email').send({ token: 'deadbeef' })).status).toBe(400);
  });
});

describe('forgotten password', () => {
  it('emails a reset link; the new password works, the old one does not, and every session is ended', async () => {
    const email = uniqueEmail('reset');
    const { refreshToken } = await registerUser({ email, password: 'old-password' });

    expect((await request(app).post('/api/v1/auth/forgot-password').send({ email: email.toUpperCase() })).status).toBe(204);
    const token = lastTokenSentTo(email);
    const mail = [...outbox].reverse().find((m) => m.to === email)!;
    expect(mail.subject).toMatch(/Reset your My Budget password/);

    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'new-password-1' })).status).toBe(204);

    expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'old-password' })).status).toBe(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'new-password-1' });
    expect(login.status).toBe(200);
    expect(login.body.user.emailVerified).toBe(true); // the emailed link proved the address
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken })).status).toBe(401);

    // Single use.
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'another-pass' })).status).toBe(400);
  });

  it('answers 204 for an unknown email and sends nothing', async () => {
    const email = uniqueEmail('nobody');
    const before = outbox.length;
    expect((await request(app).post('/api/v1/auth/forgot-password').send({ email })).status).toBe(204);
    expect(outbox.slice(before).some((m) => m.to === email)).toBe(false);
  });

  it('rejects an expired link', async () => {
    const email = uniqueEmail('expired');
    const { user } = await registerUser({ email });
    await request(app).post('/api/v1/auth/forgot-password').send({ email });
    const token = lastTokenSentTo(email);
    await db.update(userTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(userTokens.userId, user.id));
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'new-password-1' })).status).toBe(400);
  });
});

describe('POST /auth/me/password', () => {
  it('needs the current password, ends other sessions, and keeps this device signed in', async () => {
    const email = uniqueEmail('change');
    const first = await registerUser({ email, password: 'password123' });
    const second = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });

    const wrong = await request(app).post('/api/v1/auth/me/password').set(auth(first.accessToken)).send({ currentPassword: 'nope', newPassword: 'password456' });
    expect(wrong.status).toBe(400);
    const same = await request(app).post('/api/v1/auth/me/password').set(auth(first.accessToken)).send({ currentPassword: 'password123', newPassword: 'password123' });
    expect(same.status).toBe(400);

    const res = await request(app).post('/api/v1/auth/me/password').set(auth(first.accessToken)).send({ currentPassword: 'password123', newPassword: 'password456' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: res.body.refreshToken })).status).toBe(200);

    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second.body.refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'password456' })).status).toBe(200);
  });
});

describe('POST /auth/me/logout-all', () => {
  it('revokes every refresh token for the account', async () => {
    const email = uniqueEmail('logoutall');
    const a = await registerUser({ email, password: 'password123' });
    const b = await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' });

    expect((await request(app).post('/api/v1/auth/me/logout-all').set(auth(a.accessToken))).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: b.body.refreshToken })).status).toBe(401);
  });
});

describe('GET /auth/me/export', () => {
  it("returns all of the user's data as a JSON download, without secrets or other users' rows", async () => {
    const { accessToken } = await registerUser();
    const other = await registerUser();
    await request(app).post('/api/v1/transactions').set(auth(accessToken)).send({ amount: 120, type: 'expense', category_key: 'internet', date: '2026-09-10', note: 'mine' });
    await request(app).post('/api/v1/transactions').set(auth(other.accessToken)).send({ amount: 7, type: 'expense', category_key: 'internet', date: '2026-09-10', note: 'theirs' });
    const goal = await request(app).post('/api/v1/goals').set(auth(accessToken)).send({ name: 'Trip', target_amount: 5000 });
    await request(app).post(`/api/v1/goals/${goal.body.id}/contributions`).set(auth(accessToken)).send({ amount: 100, type: 'add' });
    await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Savings', type: 'bank', balance: 1000 });

    const res = await request(app).get('/api/v1/auth/me/export').set(auth(accessToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="mybudget-export-/);
    expect(res.body.transactions.map((t: { note: string }) => t.note)).toEqual(['mine']);
    expect(res.body.goals[0].contributions).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({ name: 'Savings', balance: 1000 });
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/password|token_hash|tokenHash/i);
    expect(text).not.toMatch(/theirs/);
  });
});

describe('DELETE /auth/me', () => {
  it('requires the password, then deletes the account and its data', async () => {
    const email = uniqueEmail('selfdelete');
    const { accessToken } = await registerUser({ email, password: 'password123' });
    await request(app).post('/api/v1/accounts').set(auth(accessToken)).send({ name: 'Cash', type: 'cash', balance: 50 });

    expect((await request(app).delete('/api/v1/auth/me').set(auth(accessToken)).send({})).status).toBe(400);
    expect((await request(app).delete('/api/v1/auth/me').set(auth(accessToken)).send({ password: 'wrong' })).status).toBe(400);
    expect((await request(app).delete('/api/v1/auth/me').set(auth(accessToken)).send({ password: 'password123' })).status).toBe(204);

    expect((await request(app).post('/api/v1/auth/login').send({ email, password: 'password123' })).status).toBe(401);
  });

  // The "only active admin" refusal isn't exercised here: the shared test
  // database always holds other active admins (seed + parallel test files),
  // so only the allowed case is deterministic.
  it('lets an admin delete their account while another active admin remains', async () => {
    const other = await registerUser({ email: uniqueEmail('admin-keep') });
    await promoteToAdmin(other.user.id);
    const leaving = await registerUser({ email: uniqueEmail('admin-leave'), password: 'password123' });
    await promoteToAdmin(leaving.user.id);
    expect((await request(app).delete('/api/v1/auth/me').set(auth(leaving.accessToken)).send({ password: 'password123' })).status).toBe(204);
  });
});
