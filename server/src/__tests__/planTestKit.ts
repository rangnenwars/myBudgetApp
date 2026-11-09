import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { app, promoteToAdmin, promoteToSupport, registerUser } from './helpers';
import { db } from '../db/client';
import { accessGrants, users } from '../db/schema';
import * as planLib from '../lib/plan';
import { DEFAULT_PLAN, Plan } from '../lib/plan';

// Shared by the plan, payment and admin tests. The plan setting is ONE row for
// the whole app, and Jest runs test files in parallel against the same
// database, so these tests keep the plan in memory instead: flipping
// "enforced" here can never lock a user in another test file.

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
export const DAY = 86_400_000;

/** Replaces the stored plan with an in-memory one for the rest of the test file. Returns the live copy. */
export const useMemoryPlan = (initial: Partial<Plan> = {}) => {
  const state = { plan: { ...DEFAULT_PLAN, ...initial } as Plan };
  jest.spyOn(planLib, 'getPlan').mockImplementation(async () => ({ ...state.plan }));
  jest.spyOn(planLib, 'savePlan').mockImplementation(async (patch: Partial<Plan>) => {
    state.plan = { ...state.plan, ...patch };
    return { ...state.plan };
  });
  return state;
};

export const PASSWORD = 'password123';

export const makeAdmin = async () => {
  const u = await registerUser({ features: [] });
  await promoteToAdmin(u.user.id);
  return { token: u.accessToken, id: u.user.id, email: u.user.email };
};

export const makeSupport = async () => {
  const u = await registerUser({ features: [] });
  await promoteToSupport(u.user.id);
  return { token: u.accessToken, id: u.user.id, email: u.user.email };
};

/** A customer with no optional feature rows, so only the plan can give them access. */
export const makeCustomer = () => registerUser({ features: [] });

export const clearGrants = (userId: number) => db.delete(accessGrants).where(eq(accessGrants.userId, userId));

export const giveGrant = async (userId: number, g: { kind: 'trial' | 'paid' | 'exception'; startsAt: Date; endsAt: Date | null; reason?: string }) => {
  const [row] = await db.insert(accessGrants).values({ userId, kind: g.kind, startsAt: g.startsAt, endsAt: g.endsAt, reason: g.reason ?? (g.kind === 'exception' ? 'test' : null) }).returning();
  return row;
};

/** Makes the user's trial end `days` from now (negative = already ended). */
export const setTrialEnd = async (userId: number, days: number) => {
  await clearGrants(userId);
  const now = Date.now();
  await giveGrant(userId, { kind: 'trial', startsAt: new Date(now - 200 * DAY), endsAt: new Date(now + days * DAY) });
};

export const setKind = (userId: number, kind: 'customer' | 'company') => db.update(users).set({ accountKind: kind }).where(eq(users.id, userId));

export const me = async (token: string) => (await request(app).get('/api/v1/auth/me').set(auth(token))).body;

/** A real UPI QR code image, as a PNG data URL. */
export const upiQrPng = async (upiId: string, name = 'Prapanji'): Promise<string> => {
  const buf = await QRCode.toBuffer(`upi://pay?pa=${upiId}&pn=${name}&cu=INR`, { type: 'png', margin: 4, scale: 8 });
  return `data:image/png;base64,${buf.toString('base64')}`;
};

/** A PNG with no QR code in it. */
export const blankPng = (): string => {
  const png = new PNG({ width: 40, height: 40 });
  png.data.fill(255);
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
};

let shotCounter = 0;
/** A small valid PNG that differs every call, so two screenshots never share a fingerprint. */
export const uniqueShot = (): string => {
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(200);
  shotCounter++;
  for (let i = 0; i < 4 * 8; i += 4) {
    png.data[i] = (shotCounter * 37) % 256;
    png.data[i + 1] = (shotCounter * 91 + Date.now()) % 256;
    png.data[i + 2] = Math.floor(Math.random() * 256);
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
};

let txnCounter = 0;
/** A 12-digit transaction ID nobody else in this run has used. */
export const uniqueTxn = (): string => {
  txnCounter++;
  return String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 1e4)).padStart(4, '0').slice(0, 3) + (txnCounter % 10);
};

export const UPI_ID = 'prapanji@okbank';

/** Saves payment details as an admin, with a real QR. */
export const setPaymentDetails = async (adminToken: string, upiId = UPI_ID) =>
  request(app)
    .put('/api/v1/admin/payment-details')
    .set(auth(adminToken))
    .send({ upi_id: upiId, payee_name: 'Prapanji', qr: { data: await upiQrPng(upiId) }, password: PASSWORD });

export const userGrants = (userId: number) => db.select().from(accessGrants).where(eq(accessGrants.userId, userId));
export const paidGrants = (userId: number) => db.select().from(accessGrants).where(and(eq(accessGrants.userId, userId), eq(accessGrants.kind, 'paid')));
