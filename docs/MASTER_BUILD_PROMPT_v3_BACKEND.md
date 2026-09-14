# MASTER BUILD PROMPT v3 — Backend Migration
# My Budget — Node.js + Express + PostgreSQL backend
# Phase 3 (server) + Phase 4 (client integration) of the plan in docs/DATABASE_DESIGN.md
# Paste this whole file into a build session to implement from a cold start

---

## STATUS

**Built and verified.** Phase 3 (server) and Phase 4 (client integration) below are both implemented as specified, with two factual updates from what was originally planned:

- **Postgres runs on host port 5433, not 5432** — this dev machine already has a native Windows PostgreSQL service on 5432, so `docker-compose.yml` and `server/.env` map the container's 5432 to host 5433 instead. Internal container-to-container traffic (`server` → `postgres`) is unaffected, still port 5432 on the Docker network.
- **61 categories are seeded, not 63** — the actual count in `constants/categories.ts` after dedup.

Verified: 128 server-side integration/e2e tests (Supertest against real Postgres, no mocking, enforced by a coverage floor — see `docs/API_REFERENCE.md`) + 47 client-side unit tests, all passing; a full `docker compose up --build` of all three services (`mybudget-web` + `postgres` + `server`) with a real browser click-through — register, login, bulk "Input expenses" entry, add a loan/goal, Reports tab (trend chart, category breakdown, debt payoff simulator, net worth), CSV export, custom-category create/rename/search, and admin user management (deactivate → login blocked → reactivate → login restored) all confirmed working against the live containers. Both suites now also run automatically on every `git commit` via a Husky pre-commit hook (`.husky/pre-commit`).

**Added after the initial build, per explicit user request:** custom categories (add/rename/delete your own, `POST`/`PATCH`/`DELETE /api/v1/categories`, plus a search box in the picker) and a role-based access control system (`users.role`/`users.isActive`, `/api/v1/admin/users/*`, an in-app Admin screen). See `docs/README.md` §3/§3a for the full behavior and `docs/DATABASE_DESIGN.md` for the schema. The endpoint surface and phase plan below have been updated in place to match, not left as a stale historical snapshot.

---

## WHAT'S CHANGING, WHAT ISN'T

**Changing:** the storage layer. `utils/database.ts` (SQLite) and `utils/database.web.ts` (localStorage) get replaced by an HTTP API client talking to a new Express + PostgreSQL server. Auth moves from "hash locally, store in AsyncStorage" to real server-side bcrypt + JWT.

**Not changing:** `utils/calculations.ts` — all 15 pure functions, all 47 tests. The server **reuses this exact module** (see "Shared calculations module" below) rather than reimplementing money math, debt-payoff simulation, or category bucketing in SQL or duplicated server code. Screen components barely change — they still call a data-layer function per action, it just now does `fetch` instead of a SQLite/localStorage read.

**Decision made to keep this buildable in one pass:** the app becomes **fully online-only**. No local cache, no offline queue, no sync/conflict resolution. If you're offline, the app shows an error, same as any online-only web/mobile app. This was an open fork in `docs/DATABASE_DESIGN.md` §Phase 4 — resolved here in favor of the simpler option so this spec is actionable. Local-first-with-sync is a real, much bigger feature (background sync, conflict resolution, connectivity detection) — treat it as a separate future project, not part of this migration.

---

## TECH STACK (do not deviate)

```
Server:        Node.js 20 + Express 4, TypeScript
DB:            PostgreSQL 16, running in Docker (existing docker-compose.yml, new service)
ORM/migrations: Drizzle ORM + drizzle-kit
Auth:          bcrypt (password hashing) + jsonwebtoken (access + refresh)
Validation:    zod (request body/query validation)
Client HTTP:   axios, with a request interceptor for the JWT and a response
               interceptor for silent refresh-on-401
```

No ORM alternatives, no GraphQL, no separate auth-as-a-service — matches the "Node.js + Express + PostgreSQL" call made in chat.

---

## PHASE 3 — SERVER

### File structure

```
server/
├── src/
│   ├── index.ts                 ← Express app entry, mounts routes
│   ├── db/
│   │   ├── client.ts             ← Drizzle client + pg Pool
│   │   ├── schema.ts             ← Drizzle table definitions (mirrors docs/DATABASE_DESIGN.md DDL exactly)
│   │   ├── seed-categories.ts    ← generates categories seed from ../../constants/categories.ts — do not hand-type it twice
│   │   └── seed-accounts.ts      ← seeds one demo user + one super-admin account (docs/README.md §7 has the credentials)
│   ├── middleware/
│   │   ├── auth.ts               ← verifies access token, attaches req.userId
│   │   ├── requireAdmin.ts       ← runs after auth.ts; checks role fresh from the DB, attaches req.role
│   │   └── errorHandler.ts       ← consistent { error: string } JSON error shape
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── transactions.ts
│   │   ├── loans.ts
│   │   ├── investments.ts
│   │   ├── goals.ts
│   │   ├── reports.ts
│   │   ├── netWorth.ts
│   │   ├── categories.ts         ← GET (merged system+custom) · POST/PATCH/DELETE for a user's own custom categories
│   │   └── admin.ts              ← GET/PATCH/DELETE on /admin/users — requireAdmin-gated
│   └── calculations.ts           ← re-export of ../../utils/calculations.ts (see below)
├── drizzle/                       ← generated migration SQL files (drizzle-kit output)
├── package.json
├── tsconfig.json
└── Dockerfile                     ← separate from the existing web Dockerfile
```

### Shared calculations module

`server/src/calculations.ts` is a **one-line re-export**, not a copy:

```typescript
export * from '../../utils/calculations';
```

The server fetches rows via Drizzle, then calls `computeMonthSummary`, `simulateDebtPayoff`, `bucketForGroup`, etc. — the exact same functions and the exact same 47 tests that already cover them. If a relative import across `server/` into the Expo app's `utils/` proves awkward with the server's build tooling (module resolution, `tsconfig` `rootDir` conflicts), the fallback is a small `shared/` package both `app` and `server` depend on — but try the direct relative import first; don't add workspace tooling that isn't needed.

### Docker Compose — new Postgres service

Add to the existing `docker-compose.yml` (alongside the current `mybudget-web` service):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: mybudget
      POSTGRES_PASSWORD: mybudget_dev   # local-only, fine in compose; never used for anything internet-facing
      POSTGRES_DB: mybudget
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mybudget"]
      interval: 5s
      timeout: 3s
      retries: 5

  server:
    build: ./server
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://mybudget:mybudget_dev@postgres:5432/mybudget
      JWT_ACCESS_SECRET: ${JWT_ACCESS_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
    ports:
      - "4000:4000"

volumes:
  pgdata:
```

`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` come from a `.env` file at the repo root (add `.env` to `.gitignore` if not already covered — check, don't assume). Never commit real secrets; `.env.example` with placeholder values is fine to commit.

### Auth flow (server side)

```
POST /api/v1/auth/register  { name, email, password }
  → bcrypt.hash(password, 12) → insert users row → issue access+refresh → 201

POST /api/v1/auth/login  { email, password }
  → find by lower(email) → bcrypt.compare → issue access+refresh → 200
  → wrong password or unknown email: same generic 401 message either way
     (don't reveal whether the email exists)

POST /api/v1/auth/refresh  { refreshToken }
  → look up token_hash → check not revoked, not expired → revoke it,
    issue a new access+refresh pair (rotation) → 200
  → invalid/expired/revoked: 401, client must force re-login

POST /api/v1/auth/logout  { refreshToken }
  → revoke it → 204
```

Access token: 15 min expiry, JWT payload `{ userId }`, signed with `JWT_ACCESS_SECRET`.
Refresh token: 30 day expiry, random 32-byte value, **only the SHA-256 hash is stored** in `refresh_tokens.token_hash`, the raw value goes to the client once and is never stored server-side in plain form.

### API endpoint surface

Every route below except `POST /auth/register`, `POST /auth/login`, and `POST /auth/refresh` requires `Authorization: Bearer <accessToken>` and is scoped to `req.userId` from the middleware — never trust a `userId` in the request body/query for these. `/admin/users/*` additionally requires `requireAdmin` (role: 'admin', checked fresh from the database, not the JWT — see docs/DATABASE_DESIGN.md §5).

```
POST   /api/v1/auth/register
POST   /api/v1/auth/login                       → 403 if the account is deactivated (isActive: false)
POST   /api/v1/auth/refresh                     → also rejects/revokes if deactivated since the token was issued
POST   /api/v1/auth/logout
GET    /api/v1/auth/me                          → user profile incl. tier, budget_class, role, isActive
PATCH  /api/v1/auth/me/tier   { tier }          → dev-only "Try Pro" toggle, same as today's client-side one — mark clearly in code as a placeholder for real billing, not a real upgrade flow

GET    /api/v1/categories                       → system categories + the caller's own custom ones
POST   /api/v1/categories     { name, type }    → create a custom category owned by the caller
PATCH  /api/v1/categories/:key { name }         → rename the caller's own custom category (key stays stable) · 403 system category · 404 not yours
DELETE /api/v1/categories/:key                  → 403 system category · 404 not yours · 409 still in use by a transaction

GET    /api/v1/admin/users                      → every account (role: 'admin' only) — account fields only, never financial data
PATCH  /api/v1/admin/users/:id  { role?, isActive?, tier? }  → 400 if :id is the caller's own account
DELETE /api/v1/admin/users/:id                  → cascades to everything that account owns · 400 if :id is the caller's own account

GET    /api/v1/transactions?month=&year=
GET    /api/v1/transactions/range?startMonth=&startYear=&endMonth=&endYear=
POST   /api/v1/transactions          { amount, type, category_key, subcategory?, note?, date }
PATCH  /api/v1/transactions/:id      any non-empty subset of the POST body
DELETE /api/v1/transactions/:id

GET    /api/v1/loans
POST   /api/v1/loans                 { name, principal, outstanding, emi, interest_rate? }
PATCH  /api/v1/loans/:id             any non-empty subset of { name, principal, outstanding, emi, interest_rate }
DELETE /api/v1/loans/:id

GET    /api/v1/investments
POST   /api/v1/investments           { name, type, amount, current_value? }
PATCH  /api/v1/investments/:id       any non-empty subset of { name, type, amount, current_value } — returns_percent always server-recomputed
DELETE /api/v1/investments/:id

GET    /api/v1/goals
POST   /api/v1/goals                 { name, target_amount, deadline? } — deadline is YYYY-MM-DD, optional
PATCH  /api/v1/goals/:id             any non-empty subset of { name, target_amount, saved_amount, deadline } — goal edit form only
POST   /api/v1/goals/:id/contributions  { amount (>0), type: 'add'|'remove' } — the Add/Remove funds toggle; rejects a remove past 0, records history
GET    /api/v1/goals/:id/contributions  → history for that goal, newest first
DELETE /api/v1/goals/:id

GET    /api/v1/reports/summary?startMonth=&startYear=&endMonth=&endYear=
GET    /api/v1/reports/monthly-series?startMonth=&startYear=&endMonth=&endYear=
GET    /api/v1/reports/category-breakdown?startMonth=&startYear=&endMonth=&endYear=&type=
GET    /api/v1/reports/export.csv?startMonth=&startYear=&endMonth=&endYear=
GET    /api/v1/reports/debt-payoff?strategy=snowball|avalanche&extraPerMonth=
GET    /api/v1/reports/goal-eta

POST   /api/v1/net-worth/snapshot                → recomputes from current investments/goals/loans, upserts this month's row
GET    /api/v1/net-worth/history
```

`month`/`year`/`startMonth` etc. are query params, validated with zod (integers, month 1–12) — reject with 400 on anything else, don't let bad input reach the SQL layer.

### Server-computed budget class

Per the original spec (and `docs/PRO_FEATURES_DESIGN.md`'s "Known deviations" — this was always meant to be server-side, the local build's `classifyLocal` was explicitly a placeholder for having no server): recompute on every `POST /transactions` and on `GET /auth/me`, using the same `classifyLocal` from the shared calculations module, fed by a 3-month rolling average pulled via Drizzle. Store the result on `users.budget_class`.

---

## PHASE 4 — CLIENT INTEGRATION

### New file: `utils/api.ts`

Replaces `utils/database.ts` / `utils/database.web.ts` as the thing screens import from. Same exported function names and signatures as today's data layer where possible (`getTransactions`, `addTransaction`, `getLoans`, ...) so screen components need minimal changes — the call sites already look like `await getTransactions(...)`, just add the `await`.

```typescript
// utils/api.ts
import axios from 'axios';

const api = axios.create({ baseURL: process.env.EXPO_PUBLIC_API_URL });

api.interceptors.request.use(async (config) => {
  const token = await getAccessToken(); // from AsyncStorage
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retried) {
      error.config._retried = true;
      const refreshed = await tryRefresh(); // POST /auth/refresh, store new tokens
      if (refreshed) return api(error.config);
      await forceLogout(); // clear tokens, redirect to /login
    }
    throw error;
  }
);
```

`EXPO_PUBLIC_API_URL` — new env var, e.g. `http://localhost:4000/api/v1` for local dev. Expo's `EXPO_PUBLIC_` prefix makes it available client-side; set it in `.env` (native) and it needs to be reachable from the Docker web container too (`docker-compose.yml`'s `mybudget-web` service needs a build arg or runtime config pointing at the `server` service).

### AuthContext rewrite

`context/AuthContext.tsx` currently hashes locally and checks against a local `user_profile` row. Replace `login`/`register` with calls to `POST /auth/login` / `POST /auth/register`, store `{ accessToken, refreshToken }` in AsyncStorage (not the password hash — there's no local password check anymore, the server owns that entirely). `logout` calls `POST /auth/logout` then clears local tokens.

### Removed, not migrated

- `expo-crypto` password hashing in the client — delete once the server owns auth. Keep `expo-crypto` as a dependency only if something else in the app still needs it (check before removing from `package.json`).
- `utils/database.ts` / `.web.ts` — delete once every screen is confirmed working against `utils/api.ts`. Don't delete early "just in case"; delete after the swap is verified, so a broken build can't silently fall back to stale local logic.

### Existing local test data

Does **not** migrate automatically. Registering on the new backend starts with an empty account, same as any new user. This is a personal test project with disposable data — don't build a SQLite/localStorage → Postgres import tool unless specifically asked for later.

### Verification checklist for Phase 4

- [x] `npm run quality` still passes (calculations.ts tests are untouched by this migration) — 47/47 client tests, 100% line/function coverage
- [x] Register → login → add one transaction/loan/goal each → confirmed in the running Docker stack via real browser click-through (dashboard, loans, goals, reports all reflected the new data correctly)
- [x] Reports tab range queries return correct data — trend chart, category breakdown, debt payoff simulator, and net worth all verified against live data in the browser
- [x] Logout clears tokens; a subsequent app launch requires login again — confirmed via `AuthContext`'s `onSessionExpired` handler and `clearTokens()` in `logout()`
- [x] Token refresh implemented per spec (single-flight lock in `utils/api.ts`'s response interceptor); covered by the server's `auth.test.ts` rotation tests. Not separately re-verified by manually expiring a live token in the browser this session — low risk given the server-side rotation tests pass and the client interceptor logic is straightforward, but worth a manual check before shipping if this becomes safety-critical.

---

## CRITICAL RULES

1. **Every table query is scoped by `req.userId` from the auth middleware — never by a client-supplied user id.** This is the exact class of bug already found once in the local build (`docs/PRO_FEATURES_DESIGN.md` §C1); don't reintroduce it server-side.
2. **Passwords: bcrypt server-side only.** No client-side hashing of any kind — the local build's `expo-crypto` SHA-256 was a stopgap for having no server; a server exists now.
3. **Refresh tokens stored hashed, never in plaintext, in the database.**
4. **`utils/calculations.ts` is reused, not reimplemented.** If server-side logic and client-side logic for the same computation start to diverge, that's a sign the wrong file got edited — there should only ever be one copy.
5. **Money is `NUMERIC` in Postgres, never `FLOAT`/`REAL`.** Already specified in `docs/DATABASE_DESIGN.md`; repeated here because it's the single easiest mistake to make by accident in a hurry.
6. **No secrets committed.** `.env` holds `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`DATABASE_URL`; `.env.example` (placeholder values only) is what gets committed.
7. **This migration does not touch `utils/calculations.ts`'s test suite.** If `npm run quality` starts failing because of backend work, something's wrong with the reuse strategy above, not the tests.
