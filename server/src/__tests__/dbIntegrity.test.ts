import crypto from 'crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { app, registerUser } from './helpers';
import { db } from '../db/client';
import { budgets, categories, goalContributions, recurringTransactions, savingsGoals, transactions } from '../db/schema';

// Migration 0016: ownership rules the database enforces on its own, so a bug
// in a route (or a hand-written query) can't link one user's rows to another's.
// These tests write straight to the database, bypassing the routes' own checks.

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const pgCode = (err: unknown) => (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;

/** Awaits a query that must fail with a Postgres foreign_key_violation (23503). */
const expectOwnerViolation = async (query: PromiseLike<unknown>) => {
  let error: unknown = null;
  try {
    await query;
  } catch (err) {
    error = err;
  }
  expect(pgCode(error)).toBe('23503');
};

const customCategoryOf = async (token: string) => {
  const res = await request(app).post('/api/v1/categories').set(auth(token)).send({ name: `Private ${crypto.randomUUID().slice(0, 12)}`, type: 'expense' });
  expect(res.status).toBe(201);
  return res.body.key as string;
};

describe("a user's custom category can't be used by anyone else", () => {
  it('rejects a transaction, repeating entry or budget pointing at another user\'s category', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const key = await customCategoryOf(owner.accessToken);

    const attempts = [
      db.insert(transactions).values({ userId: other.user.id, amount: 10, type: 'expense', category: key, date: '2026-09-10', month: 9, year: 2026 }),
      db.insert(recurringTransactions).values({ userId: other.user.id, amount: 10, type: 'expense', category: key, next_due: '2026-10-01' } as typeof recurringTransactions.$inferInsert),
      db.insert(budgets).values({ userId: other.user.id, categoryKey: key, monthlyLimit: 100 }),
    ];
    for (const attempt of attempts) {
      await expectOwnerViolation(attempt);
    }
  });

  it("still allows the owner's own category and any system category", async () => {
    const owner = await registerUser();
    const key = await customCategoryOf(owner.accessToken);
    const [system] = await db.select({ key: categories.key }).from(categories).where(eq(categories.key, 'internet'));
    expect(system).toBeDefined();

    await db.insert(transactions).values({ userId: owner.user.id, amount: 10, type: 'expense', category: key, date: '2026-09-10', month: 9, year: 2026 });
    await db.insert(transactions).values({ userId: owner.user.id, amount: 10, type: 'expense', category: 'internet', date: '2026-09-10', month: 9, year: 2026 });
  });

  it('rejects moving an existing row onto another user\'s category', async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const key = await customCategoryOf(owner.accessToken);
    const [row] = await db
      .insert(transactions)
      .values({ userId: other.user.id, amount: 10, type: 'expense', category: 'internet', date: '2026-09-10', month: 9, year: 2026 })
      .returning({ id: transactions.id });
    await expectOwnerViolation(db.update(transactions).set({ category: key }).where(eq(transactions.id, row.id)));
  });
});

describe('goal contributions belong to the goal owner', () => {
  it("rejects a contribution recorded under a different user than the goal's", async () => {
    const owner = await registerUser();
    const other = await registerUser();
    const goal = await request(app).post('/api/v1/goals').set(auth(owner.accessToken)).send({ name: 'Bike', target_amount: 5000 });

    await expectOwnerViolation(db.insert(goalContributions).values({ userId: other.user.id, goal_id: goal.body.id, amount: 50, type: 'add' }));
    // The owner's own contribution is fine.
    await db.insert(goalContributions).values({ userId: owner.user.id, goal_id: goal.body.id, amount: 50, type: 'add' });
  });

  it('still cascades: deleting a goal removes its contributions', async () => {
    const owner = await registerUser();
    const goal = await request(app).post('/api/v1/goals').set(auth(owner.accessToken)).send({ name: 'Laptop', target_amount: 5000 });
    await request(app).post(`/api/v1/goals/${goal.body.id}/contributions`).set(auth(owner.accessToken)).send({ amount: 100, type: 'add' });
    await db.delete(savingsGoals).where(eq(savingsGoals.id, goal.body.id));
    expect(await db.select().from(goalContributions).where(eq(goalContributions.goal_id, goal.body.id))).toHaveLength(0);
  });
});
