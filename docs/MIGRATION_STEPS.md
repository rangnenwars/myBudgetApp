# Migration steps: 0025 to 0029

Migrations normally apply by themselves. This page is for checking they did, and for doing them by hand if they did not.

| Migration | What it does | Risk |
|---|---|---|
| `0025_paid_access` | Adds the tables `access_grants`, `access_notices`, `payment_claims`, `payment_settings`; the columns `users.account_kind` and `user_features.denied`; then **fills data**: marks admin, support, system manager and `@mybudget.local` accounts as Company, and gives every other existing user a free period of 6 months from their own sign-up date. | Medium. It writes one row per existing customer. The plan stays **switched off**, so nobody loses access. |
| `0026_loan_payment_links` | Adds two empty columns to `loan_payments` (`transaction_id`, `emi_before`) and a link to `transactions`. Changes no existing row. | Low. Needs 0025 first (it is numbered after it, nothing else depends on it). |
| `0027_investment_sip` | Adds optional SIP columns to `investments` (`sip_amount`, `sip_day`, `sip_category`, `sip_ends_on`, `sip_no_end`, `sip_posted_through`) with four safety checks. Changes no existing row. | Low. |
| `0029_user_activity` | Creates `user_activity` and `activity_daily`, adds `users.share_activity` (default true). | Low. New tables and one column with a default. |
| `0028_tour_outcomes` | Creates the small table `tour_outcomes` (one row per person: how the first-time tour ended). | Low. New table only. |

## 0. The automated way (use this)

One command does the backup, applies what is pending, and checks every result is really in the database. It stops at the first problem and tells you how to go back.

```bash
server/scripts/migrate-safe.sh --dry-run   # only show what is pending; changes nothing
server/scripts/migrate-safe.sh             # backup, apply, verify, inside the running server container
server/scripts/migrate-safe.sh --local     # same, from a checkout using DATABASE_URL in server/.env
```

The pieces, if you want one on its own (run inside `server/`, or with `docker compose exec server` in front):

| Command | What it does |
|---|---|
| `npm run db:plan -- status` | Lists migrations: applied or pending, and for each planned one whether its result is really there. Add `--all` to show the old ones too. |
| `npm run db:plan -- verify` | Same, and exits 1 if anything is pending, or recorded but missing, or there but not recorded. CI runs this after migrating an empty database. |
| `npm run db:plan -- rollback <tag> --yes` | Undoes that migration and every newer one in one transaction. Without `--yes` it only says what you would lose. |
| `npm run db:migrate` | Applies pending migrations (the container does this at every start). |

The plan lives in code: `server/src/db/migrationPlan.ts` holds, for each migration from 0025, its check and its undo statements (the same SQL as sections 6 and 7 below). A test (`migrationPlan.test.ts`) applies every migration to a throwaway database, undoes them newest first, and applies them again, and it fails if a new migration is added without an entry. **When you add a migration, add its entry** (`verify`, `rollback`, `rollbackLoses`).

Restoring the backup is still the way back once real use has happened after the migration.

The sections below are the same steps by hand, for when the command cannot run.

## 1. The normal way: do nothing

`server/docker-entrypoint.sh` runs `npx tsx src/db/migrate.ts` every time the server container starts, before the API begins to listen. Deploy the new image as usual (see [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) section 5) and the migrations apply once, in order. Already-applied ones are skipped.

If the container exits straight after starting, read its log: `docker compose logs server | head -40`. A failed migration stops the start on purpose. Drizzle runs all the pending migrations in a single transaction, so a failure leaves the database as it was.

## 2. Before you start (do this either way)

Take a backup, as in [DATABASE_BACKUP.md](DATABASE_BACKUP.md). A restore is the clean way back from 0025, because it fills data.

```bash
docker compose exec postgres pg_dump -U mybudget -Fc mybudget > backups/before-paid-plan.dump
```

## 3. Check what is applied

Run these in `psql` (or `docker compose exec postgres psql -U mybudget mybudget`). Each answers one question.

```sql
-- 0025 applied? (true / false)
SELECT to_regclass('public.access_grants') IS NOT NULL AS m0025_applied;

-- 0026 applied? (should list both columns)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'loan_payments' AND column_name IN ('transaction_id', 'emi_before');

-- What drizzle thinks is applied (last row = newest)
SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;
```

After 0025 the newest `created_at` is `1794192226363`; after 0026 `1794326603658`; after 0027 `1795257939468`; after 0028 `1795258987097`; after 0029 `1795261177681`. The migrator applies every file whose timestamp in `server/drizzle/meta/_journal.json` is **newer than the newest row** in that table, so what matters is that table, not the file hash.

## 4. Apply by hand: the safe way

This is the same code the container runs, started yourself. Idempotent, so running it twice is harmless.

```bash
docker compose exec server npx tsx src/db/migrate.ts
```

or from a checkout with `server/.env` pointing at the database:

```bash
cd server && npm run db:migrate
```

Then run the checks in section 3 and the verification in section 6.

## 5. Apply by hand: only if the server cannot run it

Use this only if you must apply the SQL yourself (for example an operator without the container). Apply the files **in order**, then record them so the server does not try again.

```bash
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f server/drizzle/0025_paid_access.sql
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f server/drizzle/0026_loan_payment_links.sql
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f server/drizzle/0027_investment_sip.sql
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f server/drizzle/0028_tour_outcomes.sql
psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f server/drizzle/0029_user_activity.sql
```

`--single-transaction` and `ON_ERROR_STOP` make a failure leave nothing half-applied. Skip any file the checks in section 3 say is already applied.

Then record each one you applied (the migrator reads only `created_at`; the hash is informational):

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0025 applied by hand', 1794192226363);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0026 applied by hand', 1794326603658);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0027 applied by hand', 1795257939468);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0028 applied by hand', 1795258987097);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0029 applied by hand', 1795261177681);
```

If you skip this step, the next server start tries to apply the file again and stops with "already exists".

## 6. Verify

```sql
-- 0025: every customer has a trial, and company accounts are marked
SELECT account_kind, count(*) FROM users GROUP BY 1;
SELECT kind, count(*) FROM access_grants GROUP BY 1;            -- trial = number of customers
SELECT count(*) FROM users u WHERE u.account_kind = 'customer'
  AND NOT EXISTS (SELECT 1 FROM access_grants g WHERE g.user_id = u.id);   -- expect 0

-- 0027: the SIP columns exist and no existing investment has a SIP
SELECT count(*) FILTER (WHERE sip_amount IS NOT NULL) AS with_sip, count(*) AS total FROM investments;   -- with_sip = 0 right after migrating

-- 0029: activity tables and column exist
SELECT to_regclass('public.user_activity') IS NOT NULL AND to_regclass('public.activity_daily') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'share_activity') AS m0029_applied;
-- 0028: the tour table exists and is empty
SELECT to_regclass('public.tour_outcomes') IS NOT NULL AS m0028_applied;

-- 0026: both columns exist and old rows are untouched (all null)
SELECT count(*) FILTER (WHERE transaction_id IS NOT NULL OR emi_before IS NOT NULL) AS filled, count(*) AS total FROM loan_payments;   -- filled = 0 right after migrating
```

In the app, as an admin: Admin, then Plan and pricing should open and show the plan **switched off**.

## 7. Roll back

Prefer restoring the backup from section 2 if real use has happened since. Otherwise:

**0026** (safe, only drops what it added):

```sql
ALTER TABLE loan_payments DROP CONSTRAINT IF EXISTS loan_payments_transaction_id_transactions_id_fk;
ALTER TABLE loan_payments DROP COLUMN IF EXISTS transaction_id, DROP COLUMN IF EXISTS emi_before;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794326603658;
```

**0029** (loses all activity records and each person's sharing choice):

```sql
DROP TABLE IF EXISTS user_activity, activity_daily;
ALTER TABLE users DROP COLUMN IF EXISTS share_activity;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795261177681;
```

**0028** (loses only the tour counts):

```sql
DROP TABLE IF EXISTS tour_outcomes;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795258987097;
```

**0027** (drops the SIP settings; SIP transactions already added stay in Transactions):

```sql
ALTER TABLE investments DROP CONSTRAINT IF EXISTS investments_sip_end_check, DROP CONSTRAINT IF EXISTS investments_sip_day_check,
  DROP CONSTRAINT IF EXISTS investments_sip_amount_check, DROP CONSTRAINT IF EXISTS investments_sip_together_check,
  DROP CONSTRAINT IF EXISTS investments_sip_category_categories_key_fk;
ALTER TABLE investments DROP COLUMN IF EXISTS sip_amount, DROP COLUMN IF EXISTS sip_day, DROP COLUMN IF EXISTS sip_category,
  DROP COLUMN IF EXISTS sip_ends_on, DROP COLUMN IF EXISTS sip_no_end, DROP COLUMN IF EXISTS sip_posted_through;
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795257939468;
```

**0025** (destroys every access grant, payment claim and the saved QR, so use only before the plan has been used):

```sql
DROP TABLE IF EXISTS payment_claims, payment_settings, access_notices, access_grants;
ALTER TABLE user_features DROP COLUMN IF EXISTS denied;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_kind_check;
ALTER TABLE users DROP COLUMN IF EXISTS account_kind;
DELETE FROM app_settings WHERE key = 'plan';
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794192226363;
```

Roll back in reverse order (0029, 0028, 0027, 0026, then 0025) if you need more than one. After a rollback, deploy the previous image, because the new code expects the columns.

## 8. Order of a release that includes both

1. Backup (section 2).
2. Deploy the image. The migrations run on start.
3. Section 3 and 6 checks.
4. Paid plan: leave enforcement off until the admin steps in [PAID_PLAN.md](PAID_PLAN.md) are done.
