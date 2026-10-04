import request from 'supertest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import { db } from '../db/client';
import { users } from '../db/schema';

export const app = createApp();

// No API promotes a user to admin (self-registration always creates
// role: 'user' — deliberately, see docs/MASTER_BUILD_PROMPT_v3_BACKEND.md).
// Tests reach into the database directly, the same way a real operator
// would seed the very first admin (see db/seed-accounts.ts).
export const promoteToAdmin = (userId: number) => db.update(users).set({ role: 'admin' }).where(eq(users.id, userId));
export const promoteToSupport = (userId: number) => db.update(users).set({ role: 'support' }).where(eq(users.id, userId));
export const promoteToSystemManager = (userId: number) => db.update(users).set({ role: 'system_manager' }).where(eq(users.id, userId));
export const setUserActive = (userId: number, isActive: boolean) => db.update(users).set({ isActive }).where(eq(users.id, userId));

// crypto.randomUUID(), not a per-module counter — Jest runs test files in
// separate worker processes by default, each with its own counter starting
// at 0, so a counter + Date.now() scheme can still collide across workers.
// @test.local domain — globalTeardown.ts deletes every account under it after the suite runs.
export const uniqueEmail = (prefix: string): string => `${prefix}-${crypto.randomUUID()}@test.local`;

// A random valid Indian mobile number (10 digits, starting 9), so sign-ups
// never collide on the unique phone index across test runs.
export const uniquePhone = (): string => `9${crypto.randomInt(0, 1e9).toString().padStart(9, '0')}`;

export interface RegisteredUser {
  accessToken: string;
  refreshToken: string;
  user: { id: number; name: string; email: string; tier: string; budgetClass: string | null; role: string; isActive: boolean };
}

export const registerUser = async (overrides: { name?: string; email?: string; phone?: string; password?: string } = {}): Promise<RegisteredUser> => {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({
      name: overrides.name ?? 'Test User',
      email: overrides.email ?? uniqueEmail('user'),
      phone: overrides.phone ?? uniquePhone(),
      password: overrides.password ?? 'password123',
    });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
};
