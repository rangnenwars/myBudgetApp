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
        └─< categories        (a user's own custom ones)

  ──<   = "one user has many"
  >──   = "many rows reference one"
```

`categories` is mostly a global lookup table — seeded once from `constants/categories.ts` (61 rows), `user_id NULL` — but a user can add their own on top via `POST /api/v1/categories`, which is where the second `users ── categories` edge above comes from. Every other table listed is still fully per-account data.

---

## 3. Schema (DDL)

This DDL matches what's actually running (`server/src/db/schema.ts` + `server/drizzle/*`), with one Drizzle-side deviation: the `transactions`, `loans`, `investments`, `savings_goals`, and `goal_contributions` tables use **snake_case JS property names** in Drizzle (instead of Drizzle's normal camelCase convention) so rows returned by a query structurally match `utils/types.ts`'s shared interfaces and flow straight into `utils/calculations.ts` with no mapping layer. The underlying SQL column names below are unaffected — this is purely a TypeScript-side naming choice. `users`, `refresh_tokens`, `net_worth_snapshots`, and `budgets` kept normal camelCase since nothing in `calculations.ts` consumes them directly. 61 categories are currently seeded (not 63, per an earlier estimate).

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
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,           -- bcrypt, server-side (see §5)
  tier          TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'pro')),
  budget_class  TEXT CHECK (budget_class IN ('low', 'middle', 'high', 'ultra_high', 'rich')),
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active     BOOLEAN NOT NULL DEFAULT true,  -- rejected at login/refresh when false — see §5
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
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
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transactions_user_month ON transactions(user_id, year, month);
CREATE INDEX idx_transactions_user_type_category ON transactions(user_id, type, category_key);

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
  returns_percent NUMERIC(6,2),
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
-- budgets — per-category monthly limits (schema existed locally, unused by any screen today)
-- ============================================================
CREATE TABLE budgets (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_key  TEXT NOT NULL REFERENCES categories(key),
  monthly_limit NUMERIC(12,2) NOT NULL CHECK (monthly_limit > 0),
  UNIQUE (user_id, category_key)
);
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
| `budgets` kept even though unused | Matches the existing local schema for continuity; flagged here so nobody's surprised it exists |

### What does *not* need to change
`utils/calculations.ts` — the pure functions (`computeMonthSummary`, `simulateDebtPayoff`, `bucketForGroup`, etc.) operate on plain arrays already fetched from storage. They don't care whether those arrays came from SQLite, `localStorage`, or a Postgres row set over HTTP. That's the payoff of the architecture documented in the [architecture-flows artifact](https://claude.ai/code/artifact/3787e434-ead3-4e0a-881d-119411b2a53d) — the backend swap only touches the data layer, not the 47-test business logic module.

---

## 5. Auth model (implemented — touches `users`/`refresh_tokens`)

- Passwords hashed server-side with **bcrypt** (cost factor 12) — `AuthContext.tsx`'s old client-side SHA-256 (`expo-crypto`) is gone entirely; that was only ever a placeholder for a build with no server to hash against.
- **JWT access token**, short-lived (15 min), sent as `Authorization: Bearer`.
- **Refresh token**, long-lived (30d), stored hashed in `refresh_tokens`, rotated on every use (old one revoked, new one issued) — matches the original spec's token lifetimes.
- **Access control**: `users.role` (`'user' | 'admin'`) and `users.isActive` gate every request. `requireAdmin` middleware (`server/src/middleware/requireAdmin.ts`) re-checks `role` against the database on every admin-route request rather than trusting a JWT claim, so an admin's access changes take effect immediately. Login and refresh both reject a deactivated (`isActive: false`) account — see `docs/README.md` §3a for the exact behavior.

---

## 6. Migration tooling

**[Drizzle ORM](https://orm.drizzle.team/)** — TypeScript-first schema definitions (the schema above is typed Drizzle table definitions in `server/src/db/schema.ts`), migrations generated from schema diffs via `npm run db:generate` and applied via `npm run db:migrate` (`server/src/db/migrate.ts`, `server/drizzle/*`), and gives the Express server type-safe queries without a heavy ORM's runtime overhead.

---

## 7. Seed data

`categories` is seeded via `npm run db:seed` (`server/src/db/seed-categories.ts`), which upserts all rows from `constants/categories.ts` (`onConflictDoUpdate`, so re-running it is safe) — generated directly from that file so the two never drift, rather than hand-typed twice.

---

## Status

Fully implemented and verified: 134 server-side integration/e2e tests (Supertest against real Postgres, no mocking, coverage-enforced — see `docs/API_REFERENCE.md`) plus 47 client-side unit tests, all passing, run automatically before every commit via a Husky pre-commit hook. Run it with `docker compose up --build` from the repo root, or see [README.md](README.md) §7 for the dev-server option.
