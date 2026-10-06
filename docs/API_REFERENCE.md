# API Reference — My Budget backend

Every endpoint implemented in `server/src/routes/*.ts`, as of the admin/RBAC + custom-categories build. This is the single source of truth for the HTTP surface — if you add, remove, or change a route, update this doc **and** the corresponding test file in the same change (see "Keeping this honest" at the bottom).

Base URL: `http://localhost:4000` locally (`EXPO_PUBLIC_API_URL` on the client). All routes below are prefixed with `/api/v1` except `/health`.

---

## Conventions

**Auth.** Send `Authorization: Bearer <accessToken>` on every route marked 🔒. The token comes from `POST /auth/login` or `POST /auth/register`. A route marked 🔒🛡️ additionally requires the caller's account to have `role: 'admin'`. On every 🔒 request the server also re-reads the account (one primary-key lookup): a deleted or deactivated account, or a token issued before the user changed/reset their password or chose "sign out everywhere" (`users.tokens_valid_after`), gets **401** immediately — not when the 15-minute token expires. Deactivation by staff also revokes all refresh tokens.

**Errors.** Every error response is `{ "error": "human-readable message" }`. Common statuses:

| Status | Meaning |
|---|---|
| 400 | Validation failed (zod) — message is the joined list of validation errors, or a route-specific rule (e.g. "Use your own account to change your own settings."). Also: a non-numeric `:id`, an amount above 9,999,999,999.99, an impossible date, over-long text (notes 500, subcategory 100, names 80), or a category of the wrong type (income vs expense) |
| 401 | Missing/invalid/expired access token, or (login only) wrong credentials |
| 403 | Authenticated, but not allowed to do this (deactivated account at login, non-admin on an admin route, deleting a system category) |
| 404 | Resource doesn't exist, or exists but isn't yours — the two are deliberately indistinguishable to the caller |
| 409 | Conflict — duplicate email or mobile number, or a category still referenced by a transaction |
| 429 | Rate limited — sign-in, sign-up, refresh and email endpoints per IP; password checks (change password, delete account) per account |
| 500 | Unexpected server error (generic message to the client; the server logs only the error code and message, never the failed query's values) |

**Money.** All amounts are `NUMERIC` server-side, returned as JS numbers over JSON (never strings, never floats used for the underlying storage).

**Scoping.** Every 🔒 route (except the admin ones, which operate account-wide by design) is implicitly scoped to the caller — there is no way to pass another user's id and see their data. This is enforced by a `WHERE user_id = req.userId` on every query, not by client-side convention.

---

## Health

### `GET /health`
No auth. Pings the database: **200** `{ "status": "ok" }`, or **503** `{ "status": "database unavailable" }`. Used for container healthchecks and the deploy smoke test, not called by the client app.

---

## Auth — `/api/v1/auth`

### `POST /auth/register`
Body: `{ name: string, email: string, phone: string, password: string (8–72 chars) }`
`phone` is a 10-digit Indian mobile number (starting 6–9). Spaces, dashes and a `+91`/`91`/`0` prefix are accepted; it is stored and returned as `+91XXXXXXXXXX`.
Also emails a confirmation link (see **Your account** below); a mail failure never blocks sign-up.
→ **201** `{ user: UserProfile, accessToken: string, refreshToken: string }`
Errors: 400 invalid input (including a missing or invalid mobile number) · 409 email already registered (case-insensitive) or mobile number already registered · 429 more than 5 registrations from one IP in 15 minutes

New accounts always start `role: 'user'`, `isActive: true`, `tier: 'standard'`. There is no self-service way to become an admin — see [README.md §3a](README.md#3a-custom-categories--access-control--how-they-actually-work).

### `POST /auth/login`
Body: `{ email: string, password: string }`
→ **200** `{ user: UserProfile, accessToken: string, refreshToken: string }`
Errors: 401 wrong email or password (same generic message for both, no enumeration) · 403 account deactivated (only returned once the password has been verified correct) · 429 more than 10 failed attempts from one IP in 15 minutes (successful logins don't count)

**Refresh-token transport.** Native clients get `refreshToken` in the JSON body of register/login/refresh and send it back in the body. The web client instead sends the header `X-Refresh-Transport: cookie` on every `/auth/*` call (with credentials): the server then omits `refreshToken` from the body and sets it as the cookie `mb_refresh` (`HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` under `NODE_ENV=production`, 30-day `Max-Age`). The cookie is only read when that header is present.

### `POST /auth/refresh`
Body: `{ refreshToken: string }` — or `{}` with the cookie transport
→ **200** `{ accessToken: string, refreshToken: string }` (cookie transport: `{ accessToken }` + a new cookie) — the old refresh token is revoked (rotation) atomically, so of two concurrent refreshes with the same token exactly one succeeds; the new one must be stored in its place
Errors: 401 token invalid/expired/already used, or the account has since been deactivated (which also revokes the token as a side effect) · 429 more than 60 refreshes from one IP in 15 minutes

Rate limits are per client IP (`middleware/rateLimit.ts`). Behind a reverse proxy, set `TRUST_PROXY` to the number of proxy hops (1 behind Caddy) or every client shares the proxy's bucket.

### `POST /auth/logout`
Body: `{ refreshToken: string }` — or `{}` with the cookie transport, which also clears the cookie
→ **204** — revokes the token. Best-effort; the client clears its local tokens regardless of the response.
Errors: 400 no token in the body and no cookie transport header

### `GET /auth/me` 🔒
→ **200** `UserProfile`
Errors: 401 if the account behind the token has since been deleted

### `PATCH /auth/me/tier` 🔒
Body: `{ tier: 'standard' | 'pro' }`
→ **200** `UserProfile` — the "Try Pro" test toggle; not a real billing flow (see code comment in `routes/auth.ts`)
Errors: 400 invalid tier, or if the account behind the token has since been deleted · 403 self-service plan changes are off — the default under `NODE_ENV=production` unless `ALLOW_SELF_TIER_CHANGE=true` (`ALLOW_SELF_TIER_CHANGE=false` turns it off anywhere). Admins can still set a tier via `PATCH /admin/users/:id`.

**`UserProfile` shape** (returned by register/login/me/tier — never includes the password hash):
```json
{ "id": 1, "name": "Ada", "email": "ada@example.com", "tier": "standard", "budgetClass": "middle", "role": "user", "isActive": true, "emailVerified": false }
```

---

## Your account — `/api/v1/auth` (`routes/account.ts`)

Emails are sent by `lib/mailer.ts`, shared with the issue digest: through Resend's HTTPS API when `RESEND_API_KEY` + `MAIL_FROM` are set (production — DigitalOcean blocks outbound SMTP), otherwise over SMTP (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`; `MAIL_FROM` falls back to `SMTP_FROM`); links point at `APP_URL` (default `http://localhost:8080`). With neither configured, development prints each email to the server log and production logs only a warning (never the link). Emailed tokens are single-use, stored only as a SHA-256 hash (`user_tokens`), and requesting a new one invalidates the previous one.

### `POST /auth/forgot-password`
Body: `{ email }` → **204** always, whether or not the email is registered (no account discovery). An active account gets a reset link valid for **1 hour**: `APP_URL/reset-password?token=…`. Rate-limited with the other email endpoints (5 per IP per 15 min → 429).

### `POST /auth/reset-password`
Body: `{ token, password (8–72) }` → **204**. Sets the new password, marks the email verified (the link proved it), and revokes every refresh token — all devices are signed out.
Errors: 400 invalid, used or expired token, or a bad password

### `POST /auth/verify-email`
Body: `{ token }` → **200** `UserProfile` with `emailVerified: true`. Link valid for 7 days. Works signed in or not.
Errors: 400 invalid, used or expired token

### `POST /auth/me/resend-verification` 🔒
→ **204** — sends a fresh confirmation link (the old one stops working). Errors: 400 already verified · 429 too many emails

### `POST /auth/me/password` 🔒
Body: `{ currentPassword, newPassword (8–72) }` → **200** a fresh token pair (same transport rules as login). Every other device is signed out.
Errors: 400 wrong current password, or new password equals the current one

### `POST /auth/me/logout-all` 🔒
→ **204** — revokes every refresh token for the account (this device included; clears the web cookie). Each session ends within one access-token lifetime (15 min).

### `GET /auth/me/export` 🔒
→ **200** JSON download (`Content-Disposition: attachment; filename="mybudget-export-YYYY-MM-DD.json"`) of everything the account owns: profile, transactions, repeating entries, loans, investments, goals with their contribution history, accounts, budgets, custom categories and net-worth history. Never includes the password hash or tokens.

### `DELETE /auth/me` 🔒
Body: `{ password }` → **204** — permanently deletes the account and everything it owns (FK cascades), then clears the web cookie.
Errors: 400 missing or wrong password · 409 the caller is the only active admin

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

---

## Transactions — `/api/v1/transactions`

### `GET /transactions?month=&year=` 🔒
Query (both optional): `month` (1–12), `year` (2000–2100) — omit both for the caller's history, capped at the newest 5,000 rows (use `GET /transactions/page` to page through everything).
→ **200** `Transaction[]`, newest first

### `GET /transactions/page` 🔒
What the Transactions screen uses: one newest-first page with search and filters done in the database (keyset pagination on `(date, id)`, served by `idx_transactions_user_date`), so the app never loads a user's whole history.
Query (all optional): `limit` (1–200, default 50) · `cursor` (the `nextCursor` from the previous page) · `q` (≤100 chars; case-insensitive match on note, subcategory or category name — `%`/`_` are literal — or an exact amount when numeric) · `type` (`income`|`expense`) · `category` (key) · `from` / `to` (YYYY-MM-DD, inclusive)
→ **200** `{ items: Transaction[], nextCursor: string | null }` — `null` means there are no more rows
Errors: 400 bad cursor, limit or date

### `GET /transactions/range?startMonth=&startYear=&endMonth=&endYear=` 🔒
Query (all required, all coerced ints): `startMonth`, `startYear`, `endMonth`, `endYear`.
→ **200** `Transaction[]` across the inclusive month range

### `POST /transactions` 🔒
Body: `{ amount: number (>0), type: 'income'|'expense', category_key: string, subcategory?: string|null, note?: string|null, date: string (a real YYYY-MM-DD date) }`
Optional `repeat_frequency: 'monthly'|'quarterly'|'yearly'` (or the older `repeat_monthly: true`, = monthly) — also saves a repeating rule (see **Repeating entries** below) that adds the same entry again every period on the entry's day of the month. Create-only; `PATCH` ignores it. The entry and its rule are written in one transaction; an identical rule (same type, category, amount) is refused with 409 and nothing is saved.
→ **201** `Transaction` — also recomputes and persists `users.budgetClass` server-side as a side effect
Errors: 400 invalid body, or `category_key` doesn't exist / isn't a system category / isn't the caller's own custom category

### `POST /transactions/batch` 🔒
Body: `{ entries: [ …1–50 POST bodies, without repeat options… ] }` — all-or-nothing: if any entry is invalid nothing is saved (used by Input Expenses, so a failed save can't leave a partial batch to be re-submitted as duplicates).
→ **201** `Transaction[]` · Errors: 400 if any entry is invalid

### `PATCH /transactions/:id` 🔒
Body: any non-empty subset of the `POST` body above (all fields optional, but provide at least one)
→ **200** `Transaction` — recomputes `budgetClass` again, same as `POST`, since an edit can shift which month/amount counts
Errors: 400 empty body, invalid field, or `category_key` isn't valid/yours · 404 not found, or belongs to another user

### `DELETE /transactions/:id` 🔒
→ **204** — recomputes `budgetClass` like `POST`/`PATCH`
Errors: 404 not found, or belongs to another user

**`Transaction` shape:**
```json
{ "id": 1, "amount": 1500, "type": "expense", "category": "fuel_petrol", "subcategory": null, "note": "petrol", "date": "2026-08-29", "month": 8, "year": 2026, "created_at": "2026-08-29T10:00:00.000Z" }
```

---

## Repeating entries — `/api/v1/recurring`

A rule created by `POST /transactions` with `repeat_frequency` (or `POST /recurring`). Each rule has a `frequency` (`monthly`, `quarterly` = every 3 months, `yearly`) and a `day_of_month` (1–31, taken from the original entry; 29–31 fall back to the last day of shorter months). There is no scheduler: before any request to `/transactions`, `/reports` or `/budgets` is served (`recurringMiddleware`, `server/src/lib/recurringTransactions.ts`), the server posts every entry whose date has arrived as an ordinary transaction (same type, category and the rule's current amount; dated on the rule's day; note = the rule's note, or `Repeats <frequency>`). The user's original entry keeps its own date; posting starts one period later, oldest first, capped at the latest 24 months' worth. `posted_through` (first day of the last period posted) and `next_due` (date of the next entry) record how far it has got, so posting is idempotent, safe under parallel requests (rows are locked), and a posted transaction the user deletes does not come back. Dates use UTC. Posted months are normal transactions — they appear in the Transactions list, Reports, trends and CSV export.

### `GET /recurring` 🔒
→ **200** `Recurring[]`, newest first — `{ id, type, category, amount, note, frequency, day_of_month, posted_through, next_due, created_at, updated_at }`

### `POST /recurring` 🔒
Body: `{ transaction_id: number, frequency?: 'monthly'|'quarterly'|'yearly' (default monthly) }` — makes an **existing** transaction repeat. The rule copies its type, category, amount, note and day of the month, and the next entry is one period after it (e.g. a 19 September salary next posts on 19 October). A rule with the same type, category and amount is refused so a double tap can't post every month twice.
→ **201** `Recurring`
Errors: 400 missing/invalid `transaction_id` · 404 transaction not found / not yours · 409 an identical entry already repeats

### `PATCH /recurring/:id` 🔒
Body: at least one of `{ amount: number (>0), note: string|null, frequency, day_of_month: 1–31 }`. Changes apply to entries not yet posted; transactions already posted keep theirs. A new frequency or day recomputes `next_due` counting on from `posted_through`.
→ **200** `Recurring`
Errors: 400 empty body or invalid field · 404 not found / not yours

### `DELETE /recurring/:id` 🔒
Stops the repeat. Transactions already posted stay.
→ **204**
Errors: 404 not found / not yours

A category used by a rule cannot be deleted (409), same as one used by a transaction.

---

## Loans — `/api/v1/loans`

**Automatic monthly EMI expenses and pay-down.** A loan with `counts_as_expense: true` (the default), a positive `emi` and `outstanding > 0` contributes its EMI to expenses every month **and is paid down automatically**: each posted month splits the EMI into interest (outstanding × `interest_rate` ÷ 12 ÷ 100; zero when no rate is set) and principal, lowers `outstanding` by the principal, and caps the final instalment at balance + interest (`splitEmi` in `utils/calculations.ts`). The very first posting for a loan (or after it is switched back on) records the expense only — the balance just entered is taken as today's. If the EMI doesn't cover the month's interest, no principal is repaid and the balance is held. There is no scheduler: before any request to `/loans`, `/transactions` or `/reports` is served (`loanEmiMiddleware`, `server/src/lib/loanEmiExpenses.ts`), the server posts any missing months as `expense` transactions (category `loan_emi`, note `EMI - <loan name>`, dated the 1st of the month, amount = the loan's `emi` at posting time). A loan never posted before gets only the current month (its history isn't known); after a gap every missed month is posted, oldest first, capped at the latest 24. The loan's `emi_expensed_through` records how far posting has got, so it is idempotent, safe under parallel requests (rows are locked), and a posted transaction the user deletes does not come back. Switching a loan from off to on never back-fills the months it was off. Posted months are ordinary transactions: they appear in the Transactions list, Reports, trends and CSV export. Loans with `counts_as_expense: false` or `outstanding: 0` are skipped, but their `outstanding` still counts as a liability (net worth, Reports → Liabilities).

### `GET /loans` 🔒
→ **200** `Loan[]` — only rows where `is_active: true`, newest first

### `POST /loans` 🔒
Body: `{ name: string, principal: number (>0), outstanding: number (>=0), emi: number (>0), interest_rate?: number|null (0–99.99, % per year), tenure_months?: number|null (1–600), start_date?: 'YYYY-MM-DD'|null, loan_type?: string|null, lender?: string|null, note?: string|null, counts_as_expense?: boolean }`
→ **201** `Loan` (`is_active: true` and `counts_as_expense: true` by default)
Errors: 400 invalid body

### `PATCH /loans/:id` 🔒
Body: any non-empty subset of the `POST` fields (same constraints) — the Loans screen's edit form can send any/all of them. ("Mark EMI paid" no longer uses this — see `POST /loans/:id/pay-emi`.)
→ **200** `Loan`
Errors: 400 empty body or invalid field · 404 not found / not yours

### `POST /loans/:id/pay-emi` 🔒
Body: `{ date: 'YYYY-MM-DD' }`
Only for loans with `counts_as_expense: false` (e.g. money borrowed from family): marks one EMI as paid by lowering `outstanding` by `min(emi, outstanding)`, with no expense transaction. Counted loans are refused — they are paid down automatically each month (see above), so a manual tap would reduce the balance twice. Deleting a transaction later does **not** restore the loan balance.
→ **201** `{ loan: Loan }`
Errors: 400 malformed date, loan counts as an expense, or loan already fully paid (`outstanding` is 0) · 404 not found / not yours

### `POST /loans/:id/part-payment` 🔒
Body: `{ amount: number (>0), date: 'YYYY-MM-DD' }`
Records a part payment (prepayment). `outstanding` drops by `amount` and `emi` is scaled by the same ratio (`new emi = emi × new outstanding ÷ old outstanding`, rounded to paise, never below 0.01), which keeps the number of instalments left unchanged. `principal` (the original amount) is untouched, so "% paid" counts the prepayment. A payment equal to `outstanding` closes the loan (`outstanding: 0`) and leaves `emi` as it was. An expense transaction (category `loan_part_payment`, note `Part payment - <loan name>`) is inserted only when the loan's `counts_as_expense` is true; otherwise only the loan changes. Balance and transaction are written atomically.
→ **201** `{ loan: Loan, transaction: Transaction | null }`
Errors: 400 amount ≤ 0 / not a number, amount greater than `outstanding`, malformed date, or loan already fully paid · 404 not found / not yours

### `DELETE /loans/:id` 🔒
→ **204**
Errors: 404 not found / not yours

---

## Accounts — `/api/v1/accounts`

Where the user's money sits: bank accounts, cash, wallets/UPI and credit cards. Balances are typed in by the user (not computed from transactions) and count toward net worth — bank/cash/wallet balances add, a credit card's `balance` is the amount owed and subtracts.

### `GET /accounts` 🔒
→ **200** `Account[]` in creation order — `{ id, name, type: 'bank'|'cash'|'wallet'|'credit_card', balance, created_at, updated_at }`

### `POST /accounts` 🔒
Body: `{ name: string (1–60), type, balance?: number (default 0; may be negative for an overdrawn account) }`
→ **201** `Account`

### `PATCH /accounts/:id` 🔒
Body: any non-empty subset of the `POST` body → **200** `Account` · 404 not found / not yours

### `DELETE /accounts/:id` 🔒
→ **204** · 404 not found / not yours

---

## Budgets — `/api/v1/budgets`

A monthly spending limit per **expense** category. The EMI and repeating-entry middleware run first, so "spent" includes this month's automatic entries.

### `GET /budgets?month=&year=` 🔒
Query optional (defaults to the current UTC month).
→ **200** `BudgetStatus[]`, most-used first — `{ category, monthly_limit, spent, ratio, status }` where `ratio = spent ÷ limit` and `status` is `ok` (< 80%), `warning` (80–99%) or `over` (≥ 100%). One query: each limit left-joined to that month's expense total for its category.

### `PUT /budgets/:categoryKey` 🔒
Body: `{ monthly_limit: number (>0) }` — creates or replaces the limit for that category.
→ **200** `{ category, monthly_limit }`
Errors: 400 unknown category, someone else's custom category, an income category, or a bad limit

### `DELETE /budgets/:categoryKey` 🔒
→ **204** · 404 no limit set for that category

Deleting a custom category also removes its limit (in the same transaction, so nothing changes if the category turns out to be in use).

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
Body: `{ name: string, target_amount: number (>0), deadline?: string | null }` — `deadline` is `YYYY-MM-DD`, optional, defaults to `null`
→ **201** `SavingsGoal` (`saved_amount: 0`) — `color` is assigned round-robin from a fixed palette based on the caller's existing goal count
Errors: 400 invalid body (including a malformed `deadline`)

### `PATCH /goals/:id` 🔒
Body: any non-empty subset of `{ name, target_amount, saved_amount, deadline }` — used by the goal's own edit form (`name`/`target_amount`/`deadline`); `saved_amount` can still be set directly here, but the "Add/Remove funds" UI uses `POST /goals/:id/contributions` below instead, since that endpoint enforces the remove-more-than-saved rule and keeps history. Send `deadline: null` to clear it.
→ **200** `SavingsGoal`
Errors: 400 empty body, non-positive `target_amount`, negative `saved_amount`, or malformed `deadline` · 404 not found / not yours

### `POST /goals/:id/contributions` 🔒
Body: `{ amount: number (>0), type: 'add' | 'remove' }` — adds to or subtracts from `saved_amount` and records the action, atomically
→ **201** `{ goal: SavingsGoal, contribution: GoalContribution }`
Errors: 400 invalid body, or a `'remove'` whose `amount` exceeds the goal's current `saved_amount` · 404 not found / not yours

### `GET /goals/:id/contributions` 🔒
→ **200** `GoalContribution[]`, newest first — `{ id, amount, type: 'add' | 'remove', created_at }`
Errors: 404 not found / not yours

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

`GET`/`PATCH` require `role: 'admin'` or `role: 'support'` (`requireStaff`); `DELETE` requires `role: 'admin'` only (`requireAdmin`). Role is re-checked from the database on every request, never from the JWT. None of these routes expose any user's financial data — account fields only.

### `GET /admin/users`
Query (all optional): `q` (name or email contains, case-insensitive) · `limit` (1–200, default 100) · `offset` (default 0)
→ **200** `AdminUser[]`, newest accounts first; header `X-Total-Count` = how many match in all

### `PATCH /admin/users/:id`
Body: at least one of `{ role: 'user'|'admin'|'support'|'system_manager', isActive: boolean, tier: 'standard'|'pro' }`
→ **200** `AdminUser`
Errors: 400 empty body, or `:id` is the caller's own account (use your own login to change your own settings — this is also what makes a "last admin" lockout structurally impossible, see [README.md §3a](README.md#3a-custom-categories--access-control--how-they-actually-work)) · 403 caller is `support` and the body includes `role` or `tier` (support may only flip `isActive`), or the target is staff (`admin`/`support`/`system_manager` — support may only act on `role: 'user'` accounts) · 404 not found

Setting `isActive: false` also stamps `deactivatedAt`; setting it back to `true` clears it. Every successful `PATCH` writes one row to the admin audit log (see below).

### `DELETE /admin/users/:id`
→ **204** — cascades to everything that account owns (transactions, loans, investments, goals, categories, etc.)
Errors: 400 `:id` is the caller's own account · 403 caller is `support`, not `admin` · 404 not found

Writes one `account_deleted` row to the admin audit log before the account itself is removed.

**`AdminUser` shape:**
```json
{ "id": 2, "name": "Bob", "email": "bob@example.com", "role": "user", "tier": "standard", "isActive": true, "budgetClass": null, "createdAt": "2026-08-29T09:00:00.000Z", "deactivatedAt": null, "lastLoginAt": "2026-09-16T08:12:00.000Z" }
```

---

## Admin audit log — `/api/v1/admin/audit-log` 🔒🛡️

Admin-only (`requireAdmin` — not `support`, since this is a record of what staff did, not an account-management action itself).

### `GET /admin/audit-log`
Query (optional): `limit` (1–200, default 100) · `before` (an entry id — returns entries older than it, for "Load older")
→ **200** `AdminAuditLogEntry[]`, newest first
```json
{ "id": 5, "actorId": 2, "actorEmail": "admin@mybudget.local", "targetId": 9, "targetEmail": "bob@example.com", "action": "account_updated", "details": "tier: standard -> pro", "createdAt": "2026-09-16T08:12:00.000Z" }
```
`action` is `account_updated` or `account_deleted`. `actorId`/`targetId` are `ON DELETE SET NULL` — if that account is later deleted, the id goes `null` but `actorEmail`/`targetEmail` (snapshotted at write time) keep the entry readable.

---

## System metrics — `/api/v1/system/metrics` 🔒🛡️

Requires `role: 'admin'` or `role: 'system_manager'` (`requireSystemManager`). Every field is a count or a date — this route never selects a row from `transactions`/`loans`/`investments`/`savings_goals`, only how many exist.

### `GET /system/metrics`
→ **200**
```json
{
  "users": { "total": 42, "active": 39, "inactive": 3, "byRole": { "user": 38, "admin": 1, "support": 2, "system_manager": 1 }, "byTier": { "standard": 30, "pro": 12 } },
  "signups": { "last30Days": 5 },
  "engagement": { "loggedInLast30Days": 20, "loggedInLast7Days": 8 },
  "usage": { "transactions": 1204, "loans": 18, "investments": 25, "goals": 40, "customCategories": 11 },
  "finance": { "costPerUserPerYearInr": 100, "estimatedAnnualCostInr": 3900, "proUsers": 12, "estimatedAnnualRevenueInr": 0, "estimatedAnnualMarginInr": -3900, "revenueNote": "No real billing wired up yet — Pro is a test-mode toggle (docs/README.md)." }
}
```
`costPerUserPerYearInr` (₹100) is a planning assumption, not a billed rate. `estimatedAnnualRevenueInr` is always `0` today since there's no real payment processor (see README.md "Known deviations") — this route exists so that stays a visible number instead of a silent gap once real billing is added.

---

## Report issue — `/api/v1/issues` 🔒

Any signed-in user can file a report. This route alone accepts JSON bodies up to 3 MB (everything else keeps express's 100 kB default) because the screenshot travels base64-encoded. Rate-limited to 10 reports per IP per 15 minutes.

### `POST /issues`
Body:
```json
{
  "category": "bug|crash|data|ui|performance|other",
  "severity": "low|medium|high|critical",
  "screen": "dashboard|transactions|input_expenses|loans|investments|goals|reports|login|admin|other",
  "title": "3–120 chars",
  "description": "10–5000 chars",
  "steps_to_reproduce": "optional, ≤5000",
  "expected_behavior": "optional, ≤2000",
  "platform": "optional, e.g. ios|android|web",
  "app_version": "optional",
  "device_info": "optional, ≤200",
  "screenshot": { "data": "<base64 or data: URL>", "mime_type": "image/png|image/jpeg|image/webp" }
}
```
→ **201** `IssueReport` (never includes the image bytes)
Errors: 400 validation · 400 screenshot over **2 MB** after decoding, not valid base64, or not actually a PNG/JPEG/WebP (the first bytes are sniffed; the sniffed type is what's stored, not `mime_type`) · 413 body over 3 MB · 429 rate limit

### `GET /issues/mine`
→ **200** `IssueReport[]` — the caller's own, newest first, up to 50

### `GET /issues/:id/screenshot`
→ **200** the image bytes with its `Content-Type` and `X-Content-Type-Options: nosniff`. Reporter or staff (`admin`/`support`) only; anyone else gets **404** (not 403, so it doesn't confirm the report exists). 404 also when the report has no screenshot.

### `GET /issues?status=` 🛡️
Staff only (`requireStaff`). → **200** `IssueReport[]` plus `reporter_email`, `suggestion`, `notified_at`; newest first, up to 200. Optional `status` filter.

### `PATCH /issues/:id` 🛡️
Staff only. Body `{ "status": "new|triaged|resolved|wont_fix" }` → **200** `IssueReport` · 404 not found

**`IssueReport` shape:**
```json
{ "id": 7, "category": "data", "severity": "high", "screen": "loans", "title": "EMI total is wrong", "description": "…", "steps_to_reproduce": "…", "expected_behavior": null, "platform": "android", "app_version": "1.0.0", "device_info": "android · 34", "has_screenshot": true, "screenshot_size": 183244, "status": "new", "created_at": "2026-10-03T08:00:00.000Z", "updated_at": "2026-10-03T08:00:00.000Z" }
```

The nightly digest that analyses these and emails fix suggestions is a background job, not an endpoint — see [README.md](README.md) "Report issue & nightly digest".

---

## Keeping this honest

This document is authoritative for what's *implemented*, not what's *planned* — if a route here doesn't exist in `server/src/routes/`, or a route exists that isn't listed here, one of the two is wrong and needs fixing in the same change that caused the drift.

**Every route above has at least one test** in `server/src/__tests__/` (one file per resource, named to match; the `support`/`system_manager` roles and the audit-log and system-metrics routes are covered in `roles.test.ts`) — 216 tests total, run against a real Postgres instance, no mocking. `server/jest.config.js` enforces a coverage floor (80% branches, 90% functions/lines/statements) over `src/routes/`, `src/middleware/`, and `src/lib/`, so a new endpoint or background process shipped without a test fails `npm run test:coverage` — see [README.md §6](README.md#6-testing--quality) for the exact commands, and the repo's git pre-commit hook (`.husky/pre-commit` — see §"Enforcement") which runs the full quality gate automatically before every commit.
