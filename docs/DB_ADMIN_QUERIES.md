# Database Admin Queries — Direct SQL for Operational Tasks

Copy-paste SQL for jobs that have no screen in the app (or that you need when the app is unreachable): making a user admin, resetting a password, cleaning up test accounts, usage statistics.

> **Prefer the app where it exists.** The Admin screen (and `PATCH /api/v1/admin/users/:id`) writes a row to `admin_audit_log` and refuses self-lockout. **Raw SQL does neither.** Use SQL for the first admin, for recovery, and for bulk clean-up — and add an audit row yourself when it matters (§7).
>
> **Privacy.** The staff screens deliberately never show financial data. A database shell can. Only look at a person's transactions/loans/etc. with their consent, for support, and never export them casually.
>
> **Back up before you write.** Any `UPDATE`/`DELETE` below is a production data change. Take a dump first ([OPERATIONS_RUNBOOK.md §8](OPERATIONS_RUNBOOK.md#8-backups-and-restore)). Every write below is shown with `RETURNING` so you see what changed; wrap risky ones in a transaction (`BEGIN; … ROLLBACK;` to rehearse, `COMMIT;` to apply).

Column reference (`users`): `id, name, email, password_hash, tier ('standard'|'pro'), budget_class, role ('user'|'admin'|'support'|'system_manager'), is_active, deactivated_at, last_login_at, email_verified_at, tokens_valid_after, created_at, updated_at`. E-mail uniqueness is case-insensitive (`lower(email)`), so always match with `lower(email) = lower('…')`.

---

## 0. Opening a SQL shell

**Production** (SSH to the Droplet as `deploy`):

```bash
cd /opt/mybudget
alias dc='docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env'
dc exec postgres psql -U mybudget -d mybudget          # interactive
dc exec -T postgres psql -U mybudget -d mybudget -c "SELECT count(*) FROM users;"      # one-shot
```

**Local dev:**

```bash
docker exec -it mybudgetapp-postgres-1 psql -U mybudget -d mybudget
```

Useful `psql` meta-commands: `\dt` (tables) · `\d users` (columns) · `\x` (toggle expanded output) · `\q` (quit).

---

## 1. Look at users

```sql
-- everyone, newest first
SELECT id, name, email, role, tier, is_active, email_verified_at IS NOT NULL AS verified,
       last_login_at, created_at
FROM users ORDER BY id DESC;

-- one person
SELECT * FROM users WHERE lower(email) = lower('you@example.com');

-- users grouped by role (the "available users with role" list)
SELECT role, count(*) AS users, count(*) FILTER (WHERE is_active) AS active
FROM users GROUP BY role ORDER BY role;

-- only staff
SELECT id, name, email, role, is_active FROM users WHERE role <> 'user' ORDER BY role, id;

-- anything that looks like a leftover demo/test account
SELECT id, email, role, created_at FROM users
WHERE email LIKE '%@mybudget.local' OR email LIKE '%@example.com'
ORDER BY id;
```

---

## 2. Make a user admin, support or system manager

The user must already have **registered** in the app (self-registration always creates role `user`). Then either:

**(a) Script — preferred, same effect as the SQL:**

```bash
dc exec server npx tsx src/db/create-admin.ts you@example.com
```

**(b) SQL:**

```sql
UPDATE users
SET role = 'admin', is_active = true, deactivated_at = NULL, updated_at = now()
WHERE lower(email) = lower('you@example.com')
RETURNING id, email, role, is_active;
```

Other roles — change the value:

```sql
UPDATE users SET role = 'support',        updated_at = now() WHERE lower(email) = lower('helper@example.com')  RETURNING id, email, role;  -- activate/deactivate regular users
UPDATE users SET role = 'system_manager', updated_at = now() WHERE lower(email) = lower('boss@example.com')    RETURNING id, email, role;  -- read-only metrics
UPDATE users SET role = 'user',           updated_at = now() WHERE lower(email) = lower('someone@example.com') RETURNING id, email, role;  -- demote
```

The change is effective immediately (roles are read from the DB on every request); the person just reopens the app, or signs out/in so the dashboard shows the right icons.

**Never leave the system without an active admin.** Before demoting or deactivating anyone:

```sql
SELECT count(*) AS active_admins FROM users WHERE role = 'admin' AND is_active;   -- must stay >= 1
```

---

## 3. Tier (Free / Pro) and budget class

In production users cannot switch themselves to Pro (`ALLOW_SELF_TIER_CHANGE` is off); an admin grants it from the Admin screen or:

```sql
UPDATE users SET tier = 'pro',      updated_at = now() WHERE lower(email) = lower('you@example.com') RETURNING id, email, tier;
UPDATE users SET tier = 'standard', updated_at = now() WHERE lower(email) = lower('you@example.com') RETURNING id, email, tier;

-- grant Pro to everyone (e.g. a free launch period) — rehearse in a transaction first
BEGIN;
UPDATE users SET tier = 'pro', updated_at = now() WHERE tier = 'standard';
SELECT tier, count(*) FROM users GROUP BY tier;
ROLLBACK;   -- or COMMIT;
```

`budget_class` (`low|middle|high|ultra_high|rich`) is recomputed by the server on each new transaction; it rarely needs manual editing. Allowed values are enforced by a CHECK constraint.

---

## 4. Deactivate, reactivate, sign out, verify e-mail

```sql
-- deactivate: blocks login and refresh; also kill live sessions right now
BEGIN;
UPDATE users
SET is_active = false, deactivated_at = now(), tokens_valid_after = now(), updated_at = now()
WHERE lower(email) = lower('someone@example.com')
RETURNING id, email, is_active;
UPDATE refresh_tokens SET revoked_at = now()
WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE lower(email) = lower('someone@example.com'));
COMMIT;

-- reactivate
UPDATE users SET is_active = true, deactivated_at = NULL, updated_at = now()
WHERE lower(email) = lower('someone@example.com') RETURNING id, email, is_active;

-- "sign out everywhere" for one user (access tokens issued before now stop working; refresh tokens revoked)
BEGIN;
UPDATE users SET tokens_valid_after = now(), updated_at = now() WHERE lower(email) = lower('someone@example.com');
UPDATE refresh_tokens SET revoked_at = now()
WHERE revoked_at IS NULL AND user_id = (SELECT id FROM users WHERE lower(email) = lower('someone@example.com'));
COMMIT;

-- mark an e-mail as confirmed (e.g. SMTP isn't configured, or the mail never arrived)
UPDATE users SET email_verified_at = now(), updated_at = now()
WHERE lower(email) = lower('someone@example.com') AND email_verified_at IS NULL
RETURNING id, email, email_verified_at;
```

---

## 5. Reset a forgotten password

Passwords are stored as bcrypt hashes (cost 12), so you cannot type the new password into SQL. Generate the hash with the server container's own `bcrypt`, then write it. This version keeps the password out of the command line and shell history:

```bash
cd /opt/mybudget; alias dc='docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env'

read -rsp 'New password (8+ chars): ' PW; echo
HASH=$(printf '%s' "$PW" | dc exec -T server node -e \
  "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>require('bcrypt').hash(s,12).then(console.log))")
unset PW

printf "UPDATE users SET password_hash='%s', tokens_valid_after=now(), updated_at=now() WHERE lower(email)=lower('%s') RETURNING id, email;\n" \
  "$HASH" 'someone@example.com' | dc exec -T postgres psql -U mybudget -d mybudget
```

`tokens_valid_after = now()` signs the person out everywhere, as a normal password change does. Tell them the temporary password through a safe channel and ask them to change it in **Settings → Change password**. (If SMTP is configured, "Forgot password?" on the login screen does all of this by e-mail with no admin involvement.)

For local dev, use `docker exec -i mybudgetapp-server-1 node -e …` and `docker exec -i mybudgetapp-postgres-1 psql …` in place of `dc exec -T …`.

---

## 6. Delete accounts and clean up

Deleting a `users` row **cascades** to everything the user owns (transactions, loans, investments, goals, goal contributions, accounts, budgets, recurring rules, net-worth snapshots, custom categories, refresh tokens, e-mail tokens, issue reports). It cannot be undone — back up first. `admin_audit_log` rows survive (`actor_id`/`target_id` become NULL; the e-mail snapshots remain).

```sql
-- preview exactly what will go
SELECT id, name, email, role, created_at FROM users
WHERE email LIKE '%@example.com' AND role = 'user';

-- one account
DELETE FROM users WHERE lower(email) = lower('someone@example.com') AND role = 'user' RETURNING id, email;

-- all leftover test accounts (check the preview above first!)
BEGIN;
DELETE FROM users WHERE email LIKE '%@example.com' AND role = 'user' RETURNING id, email;
COMMIT;   -- or ROLLBACK;

-- demo accounts that must not exist in production
DELETE FROM users WHERE email IN ('admin@mybudget.local', 'user@mybudget.local') RETURNING id, email;
```

Never delete the last admin; run the §2 check first. Deleting through the Admin screen additionally records `account_deleted` in the audit log.

---

## 7. Audit log

```sql
-- latest 50 staff actions
SELECT created_at, actor_email, action, target_email, details
FROM admin_audit_log ORDER BY created_at DESC LIMIT 50;

-- everything that happened to one account
SELECT created_at, actor_email, action, details FROM admin_audit_log
WHERE lower(target_email) = lower('someone@example.com') ORDER BY created_at;

-- record a change you made by hand, so the trail stays complete
INSERT INTO admin_audit_log (actor_email, target_email, target_id, action, details)
SELECT 'dba@manual', email, id, 'account_updated', 'role: user -> admin (manual SQL)'
FROM users WHERE lower(email) = lower('you@example.com');
```

Actions the app writes today: `account_updated` (details list the changed fields) and `account_deleted`.

---

## 8. Usage and health statistics

```sql
-- headline counts
SELECT count(*) AS users,
       count(*) FILTER (WHERE is_active)                                 AS active,
       count(*) FILTER (WHERE tier = 'pro')                              AS pro,
       count(*) FILTER (WHERE email_verified_at IS NOT NULL)             AS verified,
       count(*) FILTER (WHERE last_login_at > now() - interval '30 days') AS active_30d,
       count(*) FILTER (WHERE created_at   > now() - interval '7 days')  AS new_7d
FROM users;

-- signups per day, last 30 days
SELECT created_at::date AS day, count(*) FROM users
WHERE created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1;

-- accounts that registered but never signed in again / never confirmed
SELECT id, email, created_at FROM users WHERE email_verified_at IS NULL AND created_at < now() - interval '7 days';

-- rows per table (approximate, fast)
SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC;

-- how much data each user holds (counts only — no amounts or notes)
SELECT u.id, u.email,
       (SELECT count(*) FROM transactions t WHERE t.user_id = u.id) AS transactions,
       (SELECT count(*) FROM loans l        WHERE l.user_id = u.id) AS loans,
       (SELECT count(*) FROM investments i  WHERE i.user_id = u.id) AS investments,
       (SELECT count(*) FROM savings_goals g WHERE g.user_id = u.id) AS goals
FROM users u ORDER BY transactions DESC LIMIT 20;

-- database and biggest tables on disk
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;

-- system categories seeded (expected 45) and which migrations have run
SELECT count(*) FROM categories WHERE user_id IS NULL;
SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id;

-- live connections
SELECT state, count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state;
```

---

## 9. "Report issue" submissions

```sql
-- open reports, most severe first (screenshot bytes are never selected here)
SELECT id, created_at, severity, category, screen, title, status, platform, app_version
FROM issue_reports WHERE status IN ('new', 'triaged')
ORDER BY array_position(ARRAY['critical','high','medium','low'], severity), created_at DESC;

-- who reported what
SELECT r.id, u.email, r.title, r.status FROM issue_reports r JOIN users u ON u.id = r.user_id ORDER BY r.id DESC LIMIT 20;

-- change a status (new | triaged | resolved | wont_fix)
UPDATE issue_reports SET status = 'resolved', updated_at = now() WHERE id = 42 RETURNING id, status;

-- reports not yet e-mailed by the nightly digest
SELECT count(*) FROM issue_reports WHERE notified_at IS NULL;
```

---

## 10. Housekeeping

```sql
-- expired / revoked refresh tokens and used or expired e-mail tokens are safe to purge
DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days' OR revoked_at < now() - interval '7 days';
DELETE FROM user_tokens    WHERE expires_at < now() - interval '7 days' OR used_at    < now() - interval '7 days';

-- find (and cancel) a runaway query
SELECT pid, now() - query_start AS running, state, left(query, 80) FROM pg_stat_activity
WHERE datname = current_database() AND state <> 'idle' ORDER BY running DESC;
SELECT pg_cancel_backend(<pid>);
```

Do **not** run `DROP`, `TRUNCATE` or schema changes by hand — schema changes go through Drizzle migrations (`server/drizzle/`), applied automatically on deploy, so every environment stays identical.
