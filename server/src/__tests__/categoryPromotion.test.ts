import request from 'supertest';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { categories } from '../db/schema';
import { promoteCommonCategories, PROMOTED_GROUP, PROMOTION_THRESHOLD } from '../lib/categoryPromotion';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Short (name has a 40-char limit), still unique per test run.
const uniqueName = (prefix: string) => `${prefix} ${crypto.randomUUID().slice(0, 8)}`;

const createCustom = async (accessToken: string, name: string, type: 'income' | 'expense' = 'expense') => {
  const res = await request(app).post('/api/v1/categories').set(auth(accessToken)).send({ name, type });
  return res.body.key as string;
};

describe('promoteCommonCategories (weekly batch)', () => {
  it('promotes a category once enough distinct users have created it independently, leaving the others untouched', async () => {
    const name = uniqueName('Pet grooming'); // unique per test run, avoids cross-test collisions
    const userA = await registerUser();
    const userB = await registerUser();
    const keyA = await createCustom(userA.accessToken, name);
    const keyB = await createCustom(userB.accessToken, name);

    const promoted = await promoteCommonCategories(db, 2);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].label).toBe(name);
    expect(promoted[0].adopters).toBe(2);

    // Exactly one of the two rows was promoted (the earlier-created one, keyA).
    const [rowA] = await db.select().from(categories).where(eq(categories.key, keyA));
    expect(rowA.userId).toBeNull();
    expect(rowA.group).toBe(PROMOTED_GROUP);

    // The other user's own row is completely untouched — still theirs, still custom.
    const [rowB] = await db.select().from(categories).where(eq(categories.key, keyB));
    expect(rowB.userId).toBe(userB.user.id);
    expect(rowB.group).toBe('Custom');

    // userB can still delete their own now-redundant copy — nothing about it changed.
    const del = await request(app).delete(`/api/v1/categories/${keyB}`).set(auth(userB.accessToken));
    expect(del.status).toBe(204);
  });

  it('leaves a category alone when fewer than the threshold have adopted it', async () => {
    const name = uniqueName('Solo category');
    const user = await registerUser();
    const key = await createCustom(user.accessToken, name);

    const promoted = await promoteCommonCategories(db, 2);
    expect(promoted.find((p) => p.key === key)).toBeUndefined();

    const [row] = await db.select().from(categories).where(eq(categories.key, key));
    expect(row.userId).toBe(user.user.id);
  });

  it('does not touch a category that already has a matching system category', async () => {
    // "Groceries & milk" (key: groceries_milk) is a seeded system category.
    const userA = await registerUser();
    const userB = await registerUser();
    const keyA = await createCustom(userA.accessToken, 'groceries & milk'); // case-insensitive match
    const keyB = await createCustom(userB.accessToken, 'groceries & milk');

    const promoted = await promoteCommonCategories(db, 2);
    expect(promoted.find((p) => p.key === keyA || p.key === keyB)).toBeUndefined();

    const [rowA] = await db.select().from(categories).where(eq(categories.key, keyA));
    const [rowB] = await db.select().from(categories).where(eq(categories.key, keyB));
    expect(rowA.userId).toBe(userA.user.id);
    expect(rowB.userId).toBe(userB.user.id);

    const [systemRow] = await db.select().from(categories).where(eq(categories.key, 'groceries_milk'));
    expect(systemRow.userId).toBeNull();
    expect(systemRow.group).toBe('Food & dining');
  });

  it("doesn't cross income/expense — same name, different type, doesn't count toward the same group", async () => {
    const name = uniqueName('Refund');
    const userA = await registerUser();
    const userB = await registerUser();
    const keyExpense = await createCustom(userA.accessToken, name, 'expense');
    const keyIncome = await createCustom(userB.accessToken, name, 'income');

    const promoted = await promoteCommonCategories(db, 2);
    expect(promoted.find((p) => p.key === keyExpense || p.key === keyIncome)).toBeUndefined();
  });

  it('uses the real default threshold and database when called with no arguments (as the weekly cron/CLI does)', async () => {
    const name = uniqueName('Default threshold');
    const users = await Promise.all(Array.from({ length: PROMOTION_THRESHOLD }, () => registerUser()));
    const keys = await Promise.all(users.map((u) => createCustom(u.accessToken, name)));

    const promoted = await promoteCommonCategories();
    expect(promoted.some((p) => p.label === name)).toBe(true);

    const rows = await Promise.all(keys.map((k) => db.select().from(categories).where(eq(categories.key, k)).then((r) => r[0])));
    expect(rows.filter((r) => r.userId === null)).toHaveLength(1);
  });

  it('is idempotent — running it again does not re-promote or duplicate anything', async () => {
    const name = uniqueName('Idempotent test');
    const userA = await registerUser();
    const userB = await registerUser();
    await createCustom(userA.accessToken, name);
    await createCustom(userB.accessToken, name);

    const first = await promoteCommonCategories(db, 2);
    expect(first).toHaveLength(1);

    const second = await promoteCommonCategories(db, 2);
    expect(second.find((p) => p.label === name)).toBeUndefined();
  });
});
