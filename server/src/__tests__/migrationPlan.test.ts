import crypto from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'path';
import { PLAN, planStatus, problems, readJournal, rollbackTo } from '../db/migrationPlan';

// The migration plan, proved on a throwaway database: every migration applies, is recognised as in place, can
// be undone newest-first, and applies again. The real test database is never touched.

const FOLDER = path.join(__dirname, '..', '..', 'drizzle');
const name = `plan_test_${crypto.randomBytes(5).toString('hex')}`;
const urlFor = (db: string) => {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${db}`;
  return u.toString();
};
let admin: Pool;
let pool: Pool;

const applyAll = () => migrate(drizzle(pool), { migrationsFolder: FOLDER });

beforeAll(async () => {
  admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  pool = new Pool({ connectionString: urlFor(name), max: 2 });
});

afterAll(async () => {
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe('the plan covers every migration that came after the paid plan', () => {
  const journal = readJournal();
  const planned = journal.filter((e) => Number(e.tag.slice(0, 4)) >= 25);

  it('has an entry for each, and none for a migration that does not exist', () => {
    expect(PLAN.map((s) => s.tag)).toEqual(planned.map((e) => e.tag));
  });
  it('removes the migration record in its last rollback statement, with the real timestamp', () => {
    for (const e of planned) {
      const last = PLAN.find((s) => s.tag === e.tag)!.rollback.at(-1)!;
      expect(last).toContain(`created_at = ${e.when}`);
    }
  });
});

describe('on a scratch database', () => {
  it('before anything runs, every step is pending', async () => {
    const status = await planStatus(pool);
    expect(status.every((s) => !s.applied)).toBe(true);
  });

  it('after migrating, every step is applied and its result is there', async () => {
    await applyAll();
    const status = await planStatus(pool);
    expect(status.every((s) => s.applied)).toBe(true);
    expect(status.filter((s) => PLAN.some((p) => p.tag === s.tag)).every((s) => s.verified === true)).toBe(true);
    expect(problems(status)).toEqual([]);
  });

  it('migrating again changes nothing', async () => {
    await applyAll();
    expect(problems(await planStatus(pool))).toEqual([]);
  });

  it('undoes one migration and the ones after it, and says which', async () => {
    const undone = await rollbackTo(pool, '0028_tour_outcomes');
    expect(undone).toEqual(['0029_user_activity', '0028_tour_outcomes']);
    const status = await planStatus(pool);
    for (const tag of undone) {
      const s = status.find((x) => x.tag === tag)!;
      expect(s).toMatchObject({ applied: false, verified: false });
    }
    expect(status.find((s) => s.tag === '0027_investment_sip')).toMatchObject({ applied: true, verified: true });
    expect(problems(status)).toEqual([]);
  });

  it('undoing something already undone does nothing', async () => {
    expect(await rollbackTo(pool, '0028_tour_outcomes')).toEqual([]);
  });

  it('applies again after an undo', async () => {
    await applyAll();
    const status = await planStatus(pool);
    expect(status.every((s) => s.applied)).toBe(true);
    expect(problems(status)).toEqual([]);
  });

  it('can undo everything back to the paid plan, then apply it all again', async () => {
    const undone = await rollbackTo(pool, '0025_paid_access');
    expect(undone).toEqual(['0029_user_activity', '0028_tour_outcomes', '0027_investment_sip', '0026_loan_payment_links', '0025_paid_access']);
    expect(problems(await planStatus(pool))).toEqual([]);
    await applyAll();
    expect(problems(await planStatus(pool))).toEqual([]);
    expect((await planStatus(pool)).every((s) => s.applied && s.verified !== false)).toBe(true);
  });

  it('refuses an unknown migration', async () => {
    await expect(rollbackTo(pool, '9999_nothing')).rejects.toThrow('Unknown migration');
  });

  it('is a failed undo that leaves the database as it was', async () => {
    const step = PLAN.find((s) => s.tag === '0029_user_activity')!;
    const original = [...step.rollback];
    step.rollback.splice(1, 0, 'SELECT * FROM table_that_does_not_exist');
    try {
      await expect(rollbackTo(pool, '0029_user_activity')).rejects.toThrow();
    } finally {
      step.rollback.splice(0, step.rollback.length, ...original);
    }
    const status = await planStatus(pool);
    expect(status.find((s) => s.tag === '0029_user_activity')).toMatchObject({ applied: true, verified: true });
  });

  it('notices a result that is missing although the migration is recorded', async () => {
    await pool.query('DROP TABLE tour_outcomes');
    expect(problems(await planStatus(pool))).toEqual(['0028_tour_outcomes is recorded as applied but its result is missing']);
  });

  it('notices a result that is already there although the migration is not recorded', async () => {
    await pool.query('CREATE TABLE tour_outcomes (x int)');
    await pool.query('DELETE FROM drizzle.__drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)');
    expect(problems(await planStatus(pool))).toEqual(['0029_user_activity is not recorded but its result is already there']);
  });

  it('will not undo a migration that has no written rollback', async () => {
    const journal = [...readJournal(), { tag: '0030_future', when: Date.now() + 1e9 }];
    await pool.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', ['x', journal.at(-1)!.when]);
    await expect(rollbackTo(pool, '0029_user_activity', journal)).rejects.toThrow('No rollback is written for 0030_future');
  });
});
