# Migration steps: 0025 (paid plan) and 0026 (delete a part payment)

Migrations normally apply by themselves. This page is for checking they did, and for doing them by hand if they did not.

| Migration | What it does | Risk |
|---|---|---|
| `0025_paid_access` | Adds the tables `access_grants`, `access_notices`, `payment_claims`, `payment_settings`; the columns `users.account_kind` and `user_features.denied`; then **fills data**: marks admin, support, system manager and `@mybudget.local` accounts as Company, and gives every other existing user a free period of 6 months from their own sign-up date. | Medium. It writes one row per existing customer. The plan stays **switched off**, so nobody loses access. |
| `0026_loan_payment_links` | Adds two empty columns to `loan_payments` (`transaction_id`, `emi_before`) and a link to `transactions`. Changes no existing row. | Low. Needs 0025 first (it is numbered after it, nothing else depends on it). |

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

After 0025 the newest `created_at` is `1794192226363`; after 0026 it is `1794326603658`. The migrator applies every file whose timestamp in `server/drizzle/meta/_journal.json` is **newer than the newest row** in that table, so what matters is that table, not the file hash.

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
```

`--single-transaction` and `ON_ERROR_STOP` make a failure leave nothing half-applied. Skip any file the checks in section 3 say is already applied.

Then record each one you applied (the migrator reads only `created_at`; the hash is informational):

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0025 applied by hand', 1794192226363);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0026 applied by hand', 1794326603658);
```

If you skip this step, the next server start tries to apply the file again and stops with "already exists".

## 6. Verify

```sql
-- 0025: every customer has a trial, and company accounts are marked
SELECT account_kind, count(*) FROM users GROUP BY 1;
SELECT kind, count(*) FROM access_grants GROUP BY 1;            -- trial = number of customers
SELECT count(*) FROM users u WHERE u.account_kind = 'customer'
  AND NOT EXISTS (SELECT 1 FROM access_grants g WHERE g.user_id = u.id);   -- expect 0

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

**0025** (destroys every access grant, payment claim and the saved QR, so use only before the plan has been used):

```sql
DROP TABLE IF EXISTS payment_claims, payment_settings, access_notices, access_grants;
ALTER TABLE user_features DROP COLUMN IF EXISTS denied;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_kind_check;
ALTER TABLE users DROP COLUMN IF EXISTS account_kind;
DELETE FROM app_settings WHERE key = 'plan';
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1794192226363;
```

Roll back 0026 before 0025 if you need both. After a rollback, deploy the previous image, because the new code expects the columns.

## 8. Order of a release that includes both

1. Backup (section 2).
2. Deploy the image. The migrations run on start.
3. Section 3 and 6 checks.
4. Paid plan: leave enforcement off until the admin steps in [PAID_PLAN.md](PAID_PLAN.md) are done.
