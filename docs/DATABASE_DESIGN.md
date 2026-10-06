# Database Design — PostgreSQL Backend

Status: **implemented.** This design was carried through Phase 3 (server + auth/API) and Phase 4 (client integration) exactly as laid out below — see [MASTER_BUILD_PROMPT_v3_BACKEND.md](MASTER_BUILD_PROMPT_v3_BACKEND.md) for the as-built server details and [README.md](README.md) for how to run it. The schema in `server/src/db/schema.ts` matches this document; the one deliberate deviation is noted inline in §3 (Drizzle JS property names).

**Decisions locked in from the planning discussion, now built:**
- Real relational structure in PostgreSQL, replacing the local SQLite/localStorage split
- Multi-user support with real server-side auth (JWT access + rotated refresh tokens)
- Runs as a **local Postgres container via Docker** (host port 5433 — this machine already has a native Postgres service on 5432)
- Backend: Node.js + Express + PostgreSQL + Drizzle ORM

**Resolved:** the app is **fully online-only** — no local cache, no offline queue, no background sync. Every screen calls the API directly through `utils/api.ts`/`utils/database.ts`; there is nothing left on-device except the JWT pair. This was the pragmatic call flagged during Phase 3 to keep the build spec actionable, and it's what actually shipped.

---

## 1. What's changing from the current schema

The current SQLite/localStorage schema (`utils/database.ts` / `.web.ts`) stores `category` as a free-text string on every transaction, matched against a hardcoded list in `constants/categories.ts` purely on the client. Two real design gaps that a relational database is supposed to fix:

1. **Categories become a real lookup table**, not a magic string repeated on every row. A transaction's category is a foreign key, not a string that happens to match an entry in a TypeScript file. Typos become impossible instead of silent.
2. **Every table gets a real `user_id` foreign key with `ON DELETE CASCADE`**, not an application-level filter that has to be remembered on every query (the exact class of bug already found once in this project — see `docs/PRO_FEATURES_DESIGN.md` §C1).

Everything else — the shape of transactions, loans, investments, goals, net worth snapshots — carries over from the working local schema, just properly typed and constrained.

---

## 2. Entity-relationship overview

```
users ──┬─< transactions >── categories
        ├─< loans
        ├─< investments
        ├─< savings_goals
        ├─< goal_contributions >── savings_goals
        ├─< net_worth_snapshots
        ├─< budgets >── categories
        ├─< refresh_tokens
        ├─< categories        (a user's own custom ones)
        ├─< admin_audit_log   (as actor and, separately, as target — see §3)
        └─< issue_reports     (Report issue submissions)

  ──<   = "one user has many"
  >──   = "many rows reference one"
```

`categories` is mostly a global lookup table — seeded once from `constants/categories.ts` (44 rows), `user_id NULL` — but a user can add their own on top via `POST /api/v1/categories`, which is where the second `users ── categories` edge above comes from. Every other table listed is still fully per-account data.

---

## 3. Schema (DDL)

This DDL matches what's actually running (`server/src/db/schema.ts` + `server/drizzle/*`), with one Drizzle-side deviation: the `transactions`, `loans`, `investments`, `savings_goals`, and `goal_contributions` tables use **snake_case JS property names** in Drizzle (instead of Drizzle's normal camelCase convention) so rows returned by a query structurally match `utils/types.ts`'s shared interfaces and flow straight into `utils/calculations.ts` with no mapping layer. The underlying SQL column names below are unaffected — this is purely a TypeScript-side naming choice. `users`, `refresh_tokens`, `net_worth_snapshots`, and `budgets` kept normal camelCase since nothing in `calculations.ts` consumes them directly. 61 categories are currently seeded (not 63, per an earlier estimate).

Migration `0015` added `transactions.split_group` and the `free_money_snapshots` table:

```sql
ALTER TABLE transactions ADD COLUMN split_group text;   -- same UUID on every entry saved by POST /transactions/split; NULL otherwise

CREATE TABLE free_money_snapshots (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start date   NOT NULL,                  -- Monday of the week, app time zone
  income     numeric(14,2) NOT NULL,
  committed  numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_free_money_user_week ON free_money_snapshots (user_id, week_start);
```

Migration `0016_owner_integrity` makes the database itself refuse to link one user's rows to another's — before, only the routes checked this:

```sql
-- A goal contribution must belong to the same user as its goal.
CREATE UNIQUE INDEX idx_goals_id_user ON savings_goals (id, user_id);   -- target of the FK below
ALTER TABLE goal_contributions ADD CONSTRAINT goal_contributions_goal_owner_fk
  FOREIGN KEY (goal_id, user_id) REFERENCES savings_goals (id, user_id) ON DELETE CASCADE
  NOT VALID;   -- new rows are checked; existing rows are checked by VALIDATE CONSTRAINT (OPERATIONS_RUNBOOK.md)

-- A transaction, repeating entry or budget may only use a system category
-- (user_id NULL) or the same user's own. A foreign key can't say "system OR
-- mine", so one trigger function guards all three tables; it raises
-- foreign_key_violation (23503). Triggers aren't in schema.ts (Drizzle has no
-- trigger support) — this migration is their only definition.
CREATE FUNCTION enforce_category_owner() RETURNS trigger …;   -- full body in server/drizzle/0016_owner_integrity.sql
CREATE TRIGGER transactions_category_owner BEFORE INSERT OR UPDATE OF category_key, user_id ON transactions           FOR EACH ROW EXECUTE FUNCTION enforce_category_owner();
CREATE TRIGGER recurring_category_owner    BEFORE INSERT OR UPDATE OF category_key, user_id ON recurring_transactions FOR EACH ROW EXECUTE FUNCTION enforce_category_owner();
CREATE TRIGGER budgets_category_owner      BEFORE INSERT OR UPDATE OF category_key, user_id ON budgets                FOR EACH ROW EXECUTE FUNCTION enforce_category_owner();
```

Migration `0017` added the People tables (lending, borrowing, shared bills):

```sql
CREATE TABLE people (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text   NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  due_date   date,                       -- "pay back by" for whatever is outstanding
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_people_user_name ON people (user_id, lower(name));

CREATE TABLE people_ledger (             -- append-only; balance = SUM(amount)
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  person_id  bigint NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind       text   NOT NULL CHECK (kind IN ('lent','borrowed','received','repaid','written_off')),
  amount     numeric(12,2) NOT NULL CHECK (amount <> 0),   -- + they owe the user more, − the user owes more / they paid back
  date       date   NOT NULL,
  note       text   CHECK (length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_people_ledger_person ON people_ledger (person_id, date DESC, id DESC);
CREATE INDEX idx_people_ledger_user   ON people_ledger (user_id);
```

Migration `0018` added the `split_share` kind (a friend's share of a bill the user paid) and a link from a ledger line to the user's own share:

```sql
ALTER TABLE people_ledger ADD COLUMN transaction_id bigint REFERENCES transactions(id) ON DELETE SET NULL;
-- kind CHECK now also allows 'split_share'
```

Lending is deliberately kept out of `transactions`: it is not spending or income, so reports and budgets are unaffected. A split bill adds only the user's own share to `transactions`.

`categories.user_id` and `users.role`/`users.isActive` were added after the initial migration (see `server/drizzle/0001_last_gamma_corps.sql`) to support user-created custom categories and admin-managed access control — both are covered below in place, not as a separate changelog, since this doc always describes the current shape.

```sql
-- ============================================================
-- categories — lookup table. System rows (user_id NULL) are seeded from
-- constants/categories.ts; user_id NOT NULL rows are a user's own custom
-- category, created via POST /api/v1/categories.
-- ============================================================
CREATE TABLE categories (
  id         BIGSERIAL NOT NULL,          -- stable sort order only; key stays the PK
  key        TEXT PRIMARY KEY,            -- e.g. 'groceries_milk', or 'custom_a1b2c3d4'
  label      TEXT NOT NULL,
  icon       TEXT NOT NULL,               -- emoji, matches current client rendering
  color      TEXT NOT NULL,               -- hex, matches current client rendering
  "group"    TEXT NOT NULL,               -- 'Household', 'Loans & EMIs', ... or 'Custom'
  type       TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,  -- NULL = system category
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_categories_id ON categories(id);
CREATE INDEX idx_categories_user ON categories(user_id);

-- ============================================================
-- users
-- ============================================================
CREATE TABLE users (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  phone          TEXT CHECK (phone ~ '^[+][1-9][0-9]{7,14}$'), -- E.164 (+91…), required at sign-up since 0014; NULL for older accounts; unique where not null (idx_users_phone)
  password_hash  TEXT NOT NULL,           -- bcrypt, server-side (see §5)
  tier           TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'pro')),
  budget_class   TEXT CHECK (budget_class IN ('low', 'middle', 'high', 'ultra_high', 'rich')),
  role           TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'support', 'system_manager')),
  is_active      BOOLEAN NOT NULL DEFAULT true,  -- rejected at login/refresh when false — see §5
  deactivated_at TIMESTAMPTZ,             -- set/cleared alongside is_active by PATCH /admin/users/:id
  last_login_at  TIMESTAMPTZ,             -- set on register/login, not on token refresh
  email_verified_at TIMESTAMPTZ,          -- set when the emailed confirmation (or a password-reset) link is opened
  tokens_valid_after TIMESTAMPTZ,         -- access tokens issued before this are rejected (password change/reset, sign out everywhere, deactivation)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- case-insensitive uniqueness without needing the citext extension
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));

-- ============================================================
-- refresh_tokens — server-side session tracking (new; didn't exist locally)
-- ============================================================
CREATE TABLE refresh_tokens (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,        -- hash of the token, never the raw token
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,                 -- set on logout / rotation, NULL = still valid
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ============================================================
-- user_tokens — single-use emailed tokens (password reset, email
-- verification). Only the SHA-256 hash is stored, like refresh_tokens.
-- ============================================================
CREATE TABLE user_tokens (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,   -- 1 hour (reset) / 7 days (verify)
  used_at     TIMESTAMPTZ,            -- set on use, and on older tokens when a new one is issued
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_tokens_user ON user_tokens(user_id, purpose);

-- ============================================================
-- accounts — bank / cash / wallet balances and credit-card dues, typed in
-- by the user and counted in net worth (credit cards subtract).
-- ============================================================
CREATE TABLE accounts (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('bank', 'cash', 'wallet', 'credit_card')),
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- credit_card: amount owed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_accounts_user ON accounts(user_id);

-- ============================================================
-- transactions
-- ============================================================
CREATE TABLE transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL REFERENCES categories(key),
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  subcategory TEXT,
  note        TEXT,
  date        DATE NOT NULL,
  month       SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        SMALLINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- month/year are copies of date kept for the API shape; they can never disagree with it.
  CONSTRAINT transactions_month_matches_date CHECK (month = EXTRACT(MONTH FROM date) AND year = EXTRACT(YEAR FROM date)),
  CONSTRAINT transactions_note_length CHECK (length(note) <= 500 AND length(subcategory) <= 100)
);
-- (idx_transactions_user_month was dropped: every month filter is now a date range on idx_transactions_user_date.)
-- Lists and report ranges read newest-first, optionally within a date range (server/src/lib/queries.ts).
CREATE INDEX idx_transactions_user_date ON transactions(user_id, date DESC, id DESC);
-- FK lookup: deleting a custom category checks for referencing rows.
CREATE INDEX idx_transactions_category ON transactions(category_key);

-- ============================================================
-- recurring_transactions  (repeating rules: monthly / quarterly / yearly)
-- ============================================================
CREATE TABLE recurring_transactions (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_key   TEXT NOT NULL REFERENCES categories(key),
  type           TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note           TEXT,
  posted_through DATE NOT NULL,   -- first day of the latest period already posted; advanced as entries are posted
  frequency      TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
  day_of_month   SMALLINT NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 31),  -- 29–31 fall back to the month's last day
  next_due       DATE NOT NULL,   -- date of the next entry; kept so the due check is one indexed comparison for any frequency
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The due-rule check (next_due <= today) runs before every transactions/reports/budgets request.
CREATE INDEX idx_recurring_user_due ON recurring_transactions(user_id, next_due);
CREATE INDEX idx_recurring_category ON recurring_transactions(category_key);

-- ============================================================
-- loans
-- ============================================================
CREATE TABLE loans (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  principal     NUMERIC(12,2) NOT NULL CHECK (principal > 0),
  outstanding   NUMERIC(12,2) NOT NULL CHECK (outstanding >= 0),
  emi           NUMERIC(12,2) NOT NULL CHECK (emi > 0),
  interest_rate NUMERIC(5,2),
  tenure_months SMALLINT,
  start_date    DATE,
  loan_type     TEXT,
  lender        TEXT,
  note          TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  counts_as_expense BOOLEAN NOT NULL DEFAULT true,  -- false: no monthly EMI expense is auto-posted; the debt still counts as a liability
  emi_expensed_through DATE,                        -- first day of the latest month whose EMI expense was auto-posted (NULL = none yet); each posting after the first also lowers outstanding by that month's principal
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_loans_user_active ON loans(user_id) WHERE is_active;

-- ============================================================
-- investments
-- ============================================================
CREATE TABLE investments (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  current_value   NUMERIC(12,2),
  start_date      DATE,
  maturity_date   DATE,
  returns_percent NUMERIC(12,2),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_investments_user ON investments(user_id);

-- ============================================================
-- savings_goals
-- ============================================================
CREATE TABLE savings_goals (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  target_amount NUMERIC(12,2) NOT NULL CHECK (target_amount > 0),
  saved_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (saved_amount >= 0),
  deadline      DATE,
  color         TEXT NOT NULL DEFAULT '#10B981',
  icon          TEXT NOT NULL DEFAULT 'star',
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_goals_user ON savings_goals(user_id);

-- ============================================================
-- goal_contributions — history of add/remove funds actions against a
-- savings goal, purely so the user can see how saved_amount got where it
-- is. savings_goals.saved_amount stays the source of truth for progress;
-- this table never needs to be summed to recompute it.
-- ============================================================
CREATE TABLE goal_contributions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id    BIGINT NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
  amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  type       TEXT NOT NULL CHECK (type IN ('add', 'remove')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_goal_contributions_goal ON goal_contributions(goal_id, created_at);
-- FK lookup for the ON DELETE CASCADE from users.
CREATE INDEX idx_goal_contributions_user ON goal_contributions(user_id);
-- Since 0016: the contribution's user must be the goal's user (see the note at the top of §3).
ALTER TABLE goal_contributions ADD CONSTRAINT goal_contributions_goal_owner_fk
  FOREIGN KEY (goal_id, user_id) REFERENCES savings_goals (id, user_id) ON DELETE CASCADE NOT VALID;

-- ============================================================
-- net_worth_snapshots
-- ============================================================
CREATE TABLE net_worth_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year        SMALLINT NOT NULL,
  net_worth   NUMERIC(14,2) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, year, month)
);

-- ============================================================
-- budgets — per-category monthly spending limits (Budgets screen + dashboard alerts)
-- ============================================================
CREATE TABLE budgets (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_key  TEXT NOT NULL REFERENCES categories(key),
  monthly_limit NUMERIC(12,2) NOT NULL CHECK (monthly_limit > 0),
  UNIQUE (user_id, category_key)
);
CREATE INDEX idx_budgets_category ON budgets(category_key);

-- ============================================================
-- monthly_budgets — one overall monthly spending limit per user (no carry-over).
-- EMI/card/investment categories count only when include_commitments is true.
-- ============================================================
CREATE TABLE monthly_budgets (
  user_id             BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  amount              NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  include_commitments BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- user_features — which optional features (goals, loans, investments) each
-- user has. Set by admin/system_manager only; no row means off. Switching off
-- never deletes the user's data. requested_at = the user asked and is waiting.
-- ============================================================
CREATE TABLE user_features (
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature_key      TEXT NOT NULL CHECK (feature_key IN ('goals','loans','investments')),
  status           TEXT NOT NULL CHECK (status IN ('on','off')),
  source           TEXT NOT NULL CHECK (source IN ('default','existing_data','admin','request')),
  changed_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
  requested_at     TIMESTAMPTZ,
  request_issue_id BIGINT REFERENCES issue_reports(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature_key)
);
CREATE INDEX idx_user_features_key_status ON user_features(feature_key, status);
CREATE INDEX idx_user_features_requested ON user_features(requested_at) WHERE requested_at IS NOT NULL;

-- ============================================================
-- app_settings — app-wide settings staff change without a redeploy.
-- 'signup_features' = { "goals": bool, "loans": bool, "investments": bool }.
-- ============================================================
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- admin_audit_log — one row per role/tier/active/delete change made
-- through /api/v1/admin/users, by an admin or support account. Account
-- metadata only (actor/target email, which field changed) — never touches
-- transactions/loans/investments/goals, same invariant as the admin routes.
-- ============================================================
CREATE TABLE admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- who made the change
  actor_email TEXT NOT NULL,                                   -- snapshotted so the row stays readable if actor_id is later nulled
  target_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- account that was changed
  target_email TEXT NOT NULL,                                  -- snapshotted for the same reason, incl. after the account is deleted
  action      TEXT NOT NULL,                                   -- 'account_updated' | 'account_deleted'
  details     TEXT,                                            -- e.g. "role: user -> admin, tier: standard -> pro"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_audit_actor ON admin_audit_log(actor_id);
CREATE INDEX idx_admin_audit_target ON admin_audit_log(target_id);
CREATE INDEX idx_admin_audit_created ON admin_audit_log(created_at);

-- ============================================================
-- issue_reports — "Report issue" submissions (POST /api/v1/issues).
-- Screenshot stored inline (bytea, ≤ 2 MB decoded) so backups stay one
-- pg_dump; list queries never select it. notified_at NULL = the nightly
-- digest hasn't emailed it yet. analysis/suggestion = what that job found,
-- kept so a retry after a failed send doesn't regenerate it.
-- Retention: the nightly job (server/src/lib/issuePrivacy.ts) sets screenshot,
-- screenshot_mime_type and screenshot_size to NULL once a report has been
-- resolved/wont_fix for ISSUE_SCREENSHOT_RETENTION_DAYS (default 90, measured
-- from updated_at); the text is kept. Only the reporter and admins can read
-- a screenshot through the API.
-- ============================================================
CREATE TABLE issue_reports (
  id                   BIGSERIAL PRIMARY KEY,
  user_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category             TEXT NOT NULL CHECK (category IN ('bug','crash','data','ui','performance','other')),
  severity             TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  screen               TEXT NOT NULL,                -- constants/issues.ts ISSUE_SCREENS key
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  steps_to_reproduce   TEXT,
  expected_behavior    TEXT,
  platform             TEXT,
  app_version          TEXT,
  device_info          TEXT,
  screenshot           BYTEA,
  screenshot_mime_type TEXT,                         -- sniffed from the bytes, not the client's claim
  screenshot_size      INTEGER CHECK (screenshot_size IS NULL OR screenshot_size <= 2097152),
  status               TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','resolved','wont_fix')),
  analysis             JSONB,                        -- { insight, fix, analyzedAt } from jobs/issueDigest.ts
  suggestion           TEXT,                         -- the fix suggestion that was emailed
  notified_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((screenshot IS NULL) = (screenshot_mime_type IS NULL))
);
CREATE INDEX idx_issue_reports_user ON issue_reports(user_id);
CREATE INDEX idx_issue_reports_created ON issue_reports(created_at);
CREATE INDEX idx_issue_reports_pending ON issue_reports(created_at) WHERE notified_at IS NULL;
```

---

## 4. Design notes

| Decision | Why |
|---|---|
| `BIGSERIAL` ids | Headroom beyond `SERIAL`'s ~2.1B rows; costs nothing to use now |
| `NUMERIC(12,2)` for money, never `FLOAT`/`REAL` | Floating point can't represent currency exactly — the exact bug class that makes budgeting apps show ₹99.99999999 |
| `ON DELETE CASCADE` everywhere | Matches the app's existing "delete account wipes its data" rule (`docs/PRO_FEATURES_DESIGN.md` §C1) — enforced by Postgres now, not by application code remembering to clean up |
| `lower(email)` unique index instead of `citext` | Same case-insensitive guarantee without requiring a Postgres extension to be enabled |
| `category_key` as FK, not free text | The one real normalization gap in the old schema — see §1 |
| `refresh_tokens` stores a hash, not the raw token | Standard practice — a leaked database dump shouldn't hand out valid session tokens |
| Composite index `(user_id, year, month)` on transactions | Matches the exact query shape `getTransactions(userId, month, year)` already uses today |
| `budgets` | Monthly limit per expense category; `GET /budgets` joins it to the month's spending for ok/warning/over alerts |
| `monthly_budgets` | The one overall monthly budget per user; `GET /budgets/overall` returns spent, left and a per-day figure |
| `user_features` + `app_settings` | Admin-driven feature access (replaces the planned Simple/Full mode). Migration 0020 switches on, for each existing user, only the features they already have data in; new accounts get `signup_features` (seeded as Goals on, Loans and Investments off). Routes check it on every request (`middleware/requireFeature.ts`), so a change applies at once |

### What does *not* need to change
`utils/calculations.ts` — the pure functions (`computeMonthSummary`, `simulateDebtPayoff`, `bucketForGroup`, etc.) operate on plain arrays already fetched from storage. They don't care whether those arrays came from SQLite, `localStorage`, or a Postgres row set over HTTP. That's the payoff of the architecture documented in the [architecture-flows artifact](https://claude.ai/code/artifact/3787e434-ead3-4e0a-881d-119411b2a53d) — the backend swap only touches the data layer, not the 47-test business logic module.

---

## 5. Auth model (implemented — touches `users`/`refresh_tokens`)

- Passwords hashed server-side with **bcrypt** (cost factor 12) — `AuthContext.tsx`'s old client-side SHA-256 (`expo-crypto`) is gone entirely; that was only ever a placeholder for a build with no server to hash against.
- **JWT access token**, short-lived (15 min), sent as `Authorization: Bearer`.
- **Refresh token**, long-lived (30d), stored hashed in `refresh_tokens`, rotated on every use (old one revoked, new one issued) — matches the original spec's token lifetimes. Rotation is a single `UPDATE … RETURNING`, so a token can be exchanged at most once even under concurrent requests. Each login/refresh deletes that user's revoked or expired rows, so the table stays proportional to live sessions. Login looks emails up as `lower(email) = $1`, matching `idx_users_email_lower`.
- **Access control**: `users.role` (`'user' | 'admin' | 'support' | 'system_manager'`) and `users.isActive` gate every request. Three role-gate middlewares, all re-checking the database on every request rather than trusting a JWT claim, so a role change or deactivation takes effect immediately instead of waiting for the access token to expire:
  - `requireAdmin` (`server/src/middleware/requireAdmin.ts`) — `role: 'admin'` only. Gates `DELETE /admin/users/:id` and the audit log.
  - `requireStaff` (`server/src/middleware/requireStaff.ts`) — `'admin' | 'support'`. Gates `GET`/`PATCH /admin/users`; `PATCH` further restricts `support` to the `isActive` field only (`routes/admin.ts` returns 403 if a support caller's body includes `role` or `tier`) — never role changes, never tier, never delete.
  - `requireSystemManager` (`server/src/middleware/requireSystemManager.ts`) — `'admin' | 'system_manager'`. Gates `GET /api/v1/system/metrics` only; a `system_manager` account never reaches the per-account list or any account action.
- Login and refresh both reject a deactivated (`isActive: false`) account — see `docs/README.md` §3a for the exact behavior. `deactivated_at` is set/cleared alongside `is_active` (not derived from `updated_at`, which every field change touches); `last_login_at` is set on register and login, not on refresh.
- Every `PATCH`/`DELETE` on `/admin/users/:id` writes one row to `admin_audit_log` (actor, target, which fields changed) before the target row is touched — see the table DDL above. Readable via `GET /api/v1/admin/audit-log`, admin-only.

---

## 6. Migration tooling

**[Drizzle ORM](https://orm.drizzle.team/)** — TypeScript-first schema definitions (the schema above is typed Drizzle table definitions in `server/src/db/schema.ts`), migrations generated from schema diffs via `npm run db:generate` and applied via `npm run db:migrate` (`server/src/db/migrate.ts`, `server/drizzle/*`), and gives the Express server type-safe queries without a heavy ORM's runtime overhead.

---

## 7. Seed data

`categories` is seeded via `npm run db:seed` (`server/src/db/seed-categories.ts`), which upserts all rows from `constants/categories.ts` (`onConflictDoUpdate`, so re-running it is safe) — generated directly from that file so the two never drift, rather than hand-typed twice.

---

## Status

Fully implemented and verified (2026-10-06): 386 server tests (Supertest against real Postgres — the database is never mocked — plus unit tests; 88% branch coverage) and 109 client unit tests, all passing, run before every commit by a Husky pre-commit hook and again in GitHub Actions. `dbIntegrity.test.ts` writes straight to the database to prove the 0016 constraints hold even when the routes' own checks are bypassed. Run it with `docker compose up --build` from the repo root, or see [README.md](README.md) §7 for the dev-server option.
