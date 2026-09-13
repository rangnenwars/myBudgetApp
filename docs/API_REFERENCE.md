# API Reference — My Budget backend

Every endpoint implemented in `server/src/routes/*.ts`, as of the admin/RBAC + custom-categories build. This is the single source of truth for the HTTP surface — if you add, remove, or change a route, update this doc **and** the corresponding test file in the same change (see "Keeping this honest" at the bottom).

Base URL: `http://localhost:4000` locally (`EXPO_PUBLIC_API_URL` on the client). All routes below are prefixed with `/api/v1` except `/health`.

---

## Conventions

**Auth.** Send `Authorization: Bearer <accessToken>` on every route marked 🔒. The token comes from `POST /auth/login` or `POST /auth/register`. A route marked 🔒🛡️ additionally requires the caller's account to have `role: 'admin'`.

**Errors.** Every error response is `{ "error": "human-readable message" }`. Common statuses:

| Status | Meaning |
|---|---|
| 400 | Validation failed (zod) — message is the joined list of validation errors, or a route-specific rule (e.g. "Use your own account to change your own settings.") |
| 401 | Missing/invalid/expired access token, or (login only) wrong credentials |
| 403 | Authenticated, but not allowed to do this (deactivated account at login, non-admin on an admin route, deleting a system category) |
| 404 | Resource doesn't exist, or exists but isn't yours — the two are deliberately indistinguishable to the caller |
| 409 | Conflict — duplicate email, or a category still referenced by a transaction |
| 500 | Unexpected server error (logged server-side, generic message to the client) |

**Money.** All amounts are `NUMERIC` server-side, returned as JS numbers over JSON (never strings, never floats used for the underlying storage).

**Scoping.** Every 🔒 route (except the admin ones, which operate account-wide by design) is implicitly scoped to the caller — there is no way to pass another user's id and see their data. This is enforced by a `WHERE user_id = req.userId` on every query, not by client-side convention.

---

## Health

### `GET /health`
No auth. Returns `{ "status": "ok" }`. Used for container healthchecks, not called by the client app.

---

## Auth — `/api/v1/auth`

### `POST /auth/register`
Body: `{ name: string, email: string, password: string (min 6 chars) }`
→ **201** `{ user: UserProfile, accessToken: string, refreshToken: string }`
Errors: 400 invalid input · 409 email already registered (case-insensitive)

New accounts always start `role: 'user'`, `isActive: true`, `tier: 'standard'`. There is no self-service way to become an admin — see [README.md §3a](README.md#3a-custom-categories--access-control--how-they-actually-work).

### `POST /auth/login`
Body: `{ email: string, password: string }`
→ **200** `{ user: UserProfile, accessToken: string, refreshToken: string }`
Errors: 401 wrong email or password (same generic message for both, no enumeration) · 403 account deactivated (only returned once the password has been verified correct)

### `POST /auth/refresh`
Body: `{ refreshToken: string }`
→ **200** `{ accessToken: string, refreshToken: string }` — the old refresh token is revoked (rotation); the new one must be stored in its place
Errors: 401 token invalid/expired/already used, or the account has since been deactivated (which also revokes the token as a side effect)

### `POST /auth/logout`
Body: `{ refreshToken: string }`
→ **204** — revokes the token. Best-effort; the client clears its local tokens regardless of the response.

### `GET /auth/me` 🔒
→ **200** `UserProfile`
Errors: 401 if the account behind the token has since been deleted

### `PATCH /auth/me/tier` 🔒
Body: `{ tier: 'standard' | 'pro' }`
→ **200** `UserProfile` — the "Try Pro" test toggle; not a real billing flow (see code comment in `routes/auth.ts`)
Errors: 400 invalid tier, or if the account behind the token has since been deleted

**`UserProfile` shape** (returned by register/login/me/tier — never includes the password hash):
```json
{ "id": 1, "name": "Ada", "email": "ada@example.com", "tier": "standard", "budgetClass": "middle", "role": "user", "isActive": true }
```

---

## Categories — `/api/v1/categories`

### `GET /categories` 🔒
→ **200** `Category[]` — every system category plus the caller's own custom ones, ordered to preserve `constants/categories.ts`'s group order followed by the caller's custom ones in creation order.

### `POST /categories` 🔒
Body: `{ name: string (1–40 chars), type: 'income' | 'expense' }`
→ **201** `Category` — creates a custom category owned by the caller. `group` is always `'Custom'`; `icon`/`color` are auto-assigned; `key` is generated (`custom_xxxxxxxx`).
Errors: 400 invalid name/type

### `PATCH /categories/:key` 🔒
Body: `{ name: string (1–40 chars) }`
→ **200** `Category` — renames the caller's own custom category. Only `label` changes; `key` is stable, so every transaction already referencing it (including the caller's own) keeps working unchanged.
Errors: 400 blank name · 403 `:key` is a system category · 404 `:key` doesn't exist, or belongs to another user (indistinguishable)

### `DELETE /categories/:key` 🔒
→ **204**
Errors: 403 `:key` is a system category (`user_id` is null) · 404 `:key` doesn't exist, or belongs to another user (indistinguishable) · 409 still referenced by one of the caller's own transactions

**`Category` shape:**
```json
{ "key": "groceries_milk", "label": "Groceries & milk", "icon": "🛒", "color": "#34D399", "group": "Food & dining", "type": "expense", "isCustom": false }
```

### The weekly "common category" batch — how a personal category becomes shared

Every category a user creates is *theirs alone* at first (`user_id` set, `group: 'Custom'`) — nothing here is a real-time API endpoint, it's a background process, but it changes what `GET /categories` returns over time, so it's documented here rather than in a route.

Once a week (`node-cron`, `0 3 * * 0`, wired up in `server/src/index.ts`; also runnable on demand via `cd server && npm run batch:promote-categories`), `server/src/lib/categoryPromotion.ts`'s `promoteCommonCategories()` scans every custom category across every account, and for each **distinct name + type** combination that **3 or more different users** have each independently created (case-insensitive, and only if no system category already covers it), promotes exactly one of those rows to a system category — flips its `user_id` to `NULL` and its `group` to `'Community'`. Nothing else changes: the row's `key` is untouched, so any transaction already pointing at it (including the original creator's own) keeps working exactly as before.

**Deliberately additive, never destructive** — this was an explicit design requirement ("improve the common list while keeping the user list intact"):
- Every *other* user who separately created the same-named category keeps their own row exactly as it was — still theirs, still editable, still deletable, still referenced by their own transactions. It is never deleted, merged, or repointed.
- Only category **labels** are ever read by this process — it never touches, joins against, or has any visibility into transactions, loans, investments, or goals. The same per-user financial-data isolation applies here as everywhere else.
- The threshold (`PROMOTION_THRESHOLD = 3`) and the promoted group name (`PROMOTED_GROUP = 'Community'`) are both named constants in `categoryPromotion.ts` — change them there, not by editing the batch script.
- Fully idempotent — re-running it (by hand, or next week) never re-promotes or duplicates anything already promoted.

---

## Transactions — `/api/v1/transactions`

### `GET /transactions?month=&year=` 🔒
Query (both optional): `month` (1–12), `year` (2000–2100) — omit both for the caller's full history.
→ **200** `Transaction[]`, newest first

### `GET /transactions/range?startMonth=&startYear=&endMonth=&endYear=` 🔒
Query (all required, all coerced ints): `startMonth`, `startYear`, `endMonth`, `endYear`.
→ **200** `Transaction[]` across the inclusive month range

### `POST /transactions` 🔒
Body: `{ amount: number (>0), type: 'income'|'expense', category_key: string, subcategory?: string|null, note?: string|null, date: string (YYYY-MM-DD) }`
→ **201** `Transaction` — also recomputes and persists `users.budgetClass` server-side as a side effect
Errors: 400 invalid body, or `category_key` doesn't exist / isn't a system category / isn't the caller's own custom category

### `PATCH /transactions/:id` 🔒
Body: any non-empty subset of the `POST` body above (all fields optional, but provide at least one)
→ **200** `Transaction` — recomputes `budgetClass` again, same as `POST`, since an edit can shift which month/amount counts
Errors: 400 empty body, invalid field, or `category_key` isn't valid/yours · 404 not found, or belongs to another user

### `DELETE /transactions/:id` 🔒
→ **204**
Errors: 404 not found, or belongs to another user

**`Transaction` shape:**
```json
{ "id": 1, "amount": 1500, "type": "expense", "category": "fuel_petrol", "subcategory": null, "note": "petrol", "date": "2026-08-29", "month": 8, "year": 2026, "created_at": "2026-08-29T10:00:00.000Z" }
```

---

## Loans — `/api/v1/loans`

### `GET /loans` 🔒
→ **200** `Loan[]` — only rows where `is_active: true`, newest first

### `POST /loans` 🔒
Body: `{ name: string, principal: number (>0), outstanding: number (>=0), emi: number (>0), interest_rate?: number|null }`
→ **201** `Loan` (`is_active: true` by default)
Errors: 400 invalid body

### `PATCH /loans/:id` 🔒
Body: any non-empty subset of `{ name, principal, outstanding, emi, interest_rate }` (same constraints as `POST`) — the "mark EMI paid" action sends just `{ outstanding: outstanding - emi }`; the Loans screen's edit form can send any/all of them
→ **200** `Loan`
Errors: 400 empty body or invalid field · 404 not found / not yours

### `DELETE /loans/:id` 🔒
→ **204**
Errors: 404 not found / not yours

---

## Investments — `/api/v1/investments`

### `GET /investments` 🔒
→ **200** `Investment[]`, newest first

### `POST /investments` 🔒
Body: `{ name: string, type: string, amount: number (>0), current_value?: number|null }`
→ **201** `Investment` — `returns_percent` is computed server-side from `amount`/`current_value`, **never** accepted from the client; `current_value` defaults to `amount` if omitted
Errors: 400 invalid body

### `PATCH /investments/:id` 🔒
Body: any non-empty subset of `{ name, type, amount, current_value }`
→ **200** `Investment` — `returns_percent` is **recomputed server-side** from the resulting `amount`/`current_value` (existing values are used for whichever field wasn't sent), same rule as `POST` — still never accepted from the client
Errors: 400 empty body or invalid field · 404 not found / not yours

### `DELETE /investments/:id` 🔒
→ **204**
Errors: 404 not found / not yours

---

## Goals — `/api/v1/goals`

### `GET /goals` 🔒
→ **200** `SavingsGoal[]`, newest first

### `POST /goals` 🔒
Body: `{ name: string, target_amount: number (>0) }`
→ **201** `SavingsGoal` (`saved_amount: 0`) — `color` is assigned round-robin from a fixed palette based on the caller's existing goal count
Errors: 400 invalid body

### `PATCH /goals/:id` 🔒
Body: any non-empty subset of `{ name, target_amount, saved_amount }` — the "Add funds" action sends just `{ saved_amount: current + contribution }` (the new cumulative total, not a delta); the goal's own edit form can send `name`/`target_amount` too
→ **200** `SavingsGoal`
Errors: 400 empty body, non-positive `target_amount`, or negative `saved_amount` · 404 not found / not yours

### `DELETE /goals/:id` 🔒
→ **204**
Errors: 404 not found / not yours

---

## Reports — `/api/v1/reports`

All routes below take a month range via query params: `startMonth`, `startYear`, `endMonth`, `endYear` (all required, all coerced ints) — except `/goal-eta`, which always uses the trailing 3 months.

### `GET /reports/summary` 🔒
→ **200** `{ totalIncome: number, totalExpense: number, netSavings: number }`

### `GET /reports/monthly-series` 🔒
→ **200** `MonthPoint[]` — one entry per calendar month in the range (inclusive), zero-filled for months with no transactions:
```json
[{ "month": 6, "year": 2026, "label": "Jun 2026", "income": 0, "expense": 0, "net": 0 }, ...]
```

### `GET /reports/category-breakdown?...&type=` 🔒
Query adds: `type: 'income'|'expense'`.
→ **200** `{ category: string, total: number }[]`, descending by total

### `GET /reports/export.csv` 🔒
→ **200**, `Content-Type: text/csv`, `Content-Disposition: attachment` — CSV text (`date,type,category,amount,note` header, one row per transaction in range). Header row only if there are no transactions.

### `GET /reports/debt-payoff?strategy=&extraPerMonth=` 🔒
Query: `strategy: 'snowball'|'avalanche'` (default `snowball`), `extraPerMonth: number` (default 0).
→ **200** payoff simulation results, one entry per active loan, ordered by payoff month (see `utils/calculations.ts`'s `simulateDebtPayoff`)

### `GET /reports/goal-eta` 🔒
→ **200** `{ avgMonthlySavings: number, goals: { goalId: number, name: string, monthsRemaining: number|null, etaDate: string|null }[] }` — projected from the caller's trailing 3-month average net savings

---

## Net worth — `/api/v1/net-worth`

### `POST /net-worth/snapshot` 🔒
→ **200** the upserted row — recomputes net worth server-side (`investments + goal savings − loan outstanding`) for the current calendar month and upserts it (calling twice in the same month updates the same row, doesn't duplicate)

### `GET /net-worth/history` 🔒
→ **200** `{ month: number, year: number, netWorth: number }[]`, ascending by (year, month)

---

## Admin — `/api/v1/admin/users` 🔒🛡️

Every route below requires `role: 'admin'`, re-checked from the database on every request (not from the JWT). None of them expose any user's financial data — account fields only.

### `GET /admin/users`
→ **200** `AdminUser[]`, ordered by `createdAt`

### `PATCH /admin/users/:id`
Body: at least one of `{ role: 'user'|'admin', isActive: boolean, tier: 'standard'|'pro' }`
→ **200** `AdminUser`
Errors: 400 empty body, or `:id` is the caller's own account (use your own login to change your own settings — this is also what makes a "last admin" lockout structurally impossible, see [README.md §3a](README.md#3a-custom-categories--access-control--how-they-actually-work)) · 404 not found

### `DELETE /admin/users/:id`
→ **204** — cascades to everything that account owns (transactions, loans, investments, goals, categories, etc.)
Errors: 400 `:id` is the caller's own account · 404 not found

**`AdminUser` shape:**
```json
{ "id": 2, "name": "Bob", "email": "bob@example.com", "role": "user", "tier": "standard", "isActive": true, "budgetClass": null, "createdAt": "2026-08-29T09:00:00.000Z" }
```

---

## Keeping this honest

This document is authoritative for what's *implemented*, not what's *planned* — if a route here doesn't exist in `server/src/routes/`, or a route exists that isn't listed here, one of the two is wrong and needs fixing in the same change that caused the drift.

**Every route above has at least one test** in `server/src/__tests__/` (one file per resource, named to match — the weekly batch has its own `categoryPromotion.test.ts`) — 125 tests total, run against a real Postgres instance, no mocking. `server/jest.config.js` enforces a coverage floor (80% branches, 90% functions/lines/statements) over `src/routes/`, `src/middleware/`, and `src/lib/`, so a new endpoint or background process shipped without a test fails `npm run test:coverage` — see [README.md §6](README.md#6-testing--quality) for the exact commands, and the repo's git pre-commit hook (`.husky/pre-commit` — see §"Enforcement") which runs the full quality gate automatically before every commit.
