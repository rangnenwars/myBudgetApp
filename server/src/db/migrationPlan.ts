import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';

// The migration plan as code (docs/MIGRATION_STEPS.md is the same thing in words). For each migration that
// changes live data or tables: how to tell it is in place (verify) and how to undo it (rollback). A test fails
// when a new migration is added without an entry here, so the plan cannot fall behind.

export interface PlanStep {
  tag: string;
  summary: string;
  /** One query returning a single boolean column `ok`: true when the migration's result is in place. */
  verify: string;
  /** Undo statements, run in one transaction. The last one removes the migration's row so it can run again. */
  rollback: string[];
  /** Plain words about what undoing it costs. */
  rollbackLoses: string;
}

const hasColumns = (table: string, cols: string[]) =>
  `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name IN (${cols.map((c) => `'${c}'`).join(', ')})) = ${cols.length} AS ok`;

const forget = (when: number) => `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${when}`;

export const PLAN: PlanStep[] = [
  {
    tag: '0025_paid_access',
    summary: 'paid plan tables, users.account_kind, user_features.denied',
    verify: `SELECT to_regclass('public.access_grants') IS NOT NULL AND to_regclass('public.payment_claims') IS NOT NULL AND to_regclass('public.payment_settings') IS NOT NULL AND to_regclass('public.access_notices') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'account_kind')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_features' AND column_name = 'denied') AS ok`,
    rollback: [
      'DROP TABLE IF EXISTS payment_claims, payment_settings, access_notices, access_grants',
      'ALTER TABLE user_features DROP COLUMN IF EXISTS denied',
      'ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_kind_check',
      'ALTER TABLE users DROP COLUMN IF EXISTS account_kind',
      "DELETE FROM app_settings WHERE key = 'plan'",
      forget(1794192226363),
    ],
    rollbackLoses: 'every access grant, payment claim and the saved QR',
  },
  {
    tag: '0026_loan_payment_links',
    summary: 'loan_payments.transaction_id and emi_before',
    verify: hasColumns('loan_payments', ['transaction_id', 'emi_before']),
    rollback: [
      'ALTER TABLE loan_payments DROP CONSTRAINT IF EXISTS loan_payments_transaction_id_transactions_id_fk',
      'ALTER TABLE loan_payments DROP COLUMN IF EXISTS transaction_id, DROP COLUMN IF EXISTS emi_before',
      forget(1794326603658),
    ],
    rollbackLoses: 'the link between a part payment and its transaction',
  },
  {
    tag: '0027_investment_sip',
    summary: 'SIP columns on investments',
    verify: hasColumns('investments', ['sip_amount', 'sip_day', 'sip_category', 'sip_ends_on', 'sip_no_end', 'sip_posted_through']),
    rollback: [
      `ALTER TABLE investments DROP CONSTRAINT IF EXISTS investments_sip_end_check, DROP CONSTRAINT IF EXISTS investments_sip_day_check,
        DROP CONSTRAINT IF EXISTS investments_sip_amount_check, DROP CONSTRAINT IF EXISTS investments_sip_together_check,
        DROP CONSTRAINT IF EXISTS investments_sip_category_categories_key_fk`,
      `ALTER TABLE investments DROP COLUMN IF EXISTS sip_amount, DROP COLUMN IF EXISTS sip_day, DROP COLUMN IF EXISTS sip_category,
        DROP COLUMN IF EXISTS sip_ends_on, DROP COLUMN IF EXISTS sip_no_end, DROP COLUMN IF EXISTS sip_posted_through`,
      forget(1795257939468),
    ],
    rollbackLoses: 'the SIP settings (transactions already added stay)',
  },
  {
    tag: '0028_tour_outcomes',
    summary: 'tour_outcomes table',
    verify: `SELECT to_regclass('public.tour_outcomes') IS NOT NULL AS ok`,
    rollback: ['DROP TABLE IF EXISTS tour_outcomes', forget(1795258987097)],
    rollbackLoses: 'the first-time tour counts',
  },
  {
    tag: '0029_user_activity',
    summary: 'user_activity, activity_daily, users.share_activity',
    verify: `SELECT to_regclass('public.user_activity') IS NOT NULL AND to_regclass('public.activity_daily') IS NOT NULL
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'share_activity') AS ok`,
    rollback: ['DROP TABLE IF EXISTS user_activity, activity_daily', 'ALTER TABLE users DROP COLUMN IF EXISTS share_activity', forget(1795261177681)],
    rollbackLoses: 'all activity records and each person\'s sharing choice',
  },
];

export interface JournalEntry {
  tag: string;
  when: number;
}

export const readJournal = (folder = path.join(__dirname, '..', '..', 'drizzle')): JournalEntry[] =>
  JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')).entries.map((e: JournalEntry) => ({ tag: e.tag, when: e.when }));

export interface StepStatus {
  tag: string;
  /** The migrator treats a migration as applied when its timestamp is not newer than the newest recorded one. */
  applied: boolean;
  /** Only for steps in the plan: whether the migration's result is really in the database. */
  verified: boolean | null;
}

const newestApplied = async (pool: Pool): Promise<number> => {
  const exists = await pool.query(`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) return 0;
  const { rows } = await pool.query('SELECT max(created_at)::bigint AS newest FROM drizzle.__drizzle_migrations');
  return Number(rows[0].newest ?? 0);
};

export const planStatus = async (pool: Pool, journal: JournalEntry[] = readJournal()): Promise<StepStatus[]> => {
  const newest = await newestApplied(pool);
  const out: StepStatus[] = [];
  for (const entry of journal) {
    const applied = entry.when <= newest;
    const step = PLAN.find((s) => s.tag === entry.tag);
    const verified = step ? Boolean((await pool.query(step.verify)).rows[0]?.ok) : null;
    out.push({ tag: entry.tag, applied, verified });
  }
  return out;
};

/** Applied steps whose result is not really in the database, or steps that look applied but are not. */
export const problems = (status: StepStatus[]): string[] =>
  status.flatMap((s) => (s.applied && s.verified === false ? [`${s.tag} is recorded as applied but its result is missing`] : !s.applied && s.verified === true ? [`${s.tag} is not recorded but its result is already there`] : []));

/** Undoes migrations from the newest down to and including `tag`, in one transaction. Only plan steps can be undone. */
export const rollbackTo = async (pool: Pool, tag: string, journal: JournalEntry[] = readJournal()): Promise<string[]> => {
  const status = await planStatus(pool, journal);
  const from = journal.findIndex((e) => e.tag === tag);
  if (from < 0) throw new Error(`Unknown migration ${tag}.`);
  const toUndo = journal.slice(from).filter((e) => status.find((s) => s.tag === e.tag)?.applied).reverse();
  const missing = toUndo.filter((e) => !PLAN.some((s) => s.tag === e.tag));
  if (missing.length) throw new Error(`No rollback is written for ${missing.map((m) => m.tag).join(', ')}. Restore the backup instead.`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of toUndo) for (const sql of PLAN.find((s) => s.tag === e.tag)!.rollback) await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return toUndo.map((e) => e.tag);
};
