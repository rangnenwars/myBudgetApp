# API Request/Response Reference

Every endpoint, with the exact method, URL, port, path, headers, body, and response — verified against the running server (not hand-typed from the route code), so these are copy-paste testable with curl or Postman. For the narrative version (what each field means, why), see [API_REFERENCE.md](API_REFERENCE.md); this file is the literal wire format.

## Base URL & port

| Environment | Base URL |
|---|---|
| Local dev / `docker compose up` (this repo's default) | `http://localhost:4000` |
| Client's default fallback (`utils/api.ts`) | `http://localhost:4000/api/v1` |
| Anywhere else | Whatever `EXPO_PUBLIC_API_URL` / `DATABASE_URL`'s host is — port `4000` is the Express server's own listen port (`server/.env`'s `PORT`), unrelated to Postgres's port |

Every path below is relative to `http://localhost:4000` and already includes the `/api/v1` prefix (except `/health`, which doesn't have one). So `POST /api/v1/auth/login` in local dev is `POST http://localhost:4000/api/v1/auth/login`.

## Standard headers

| Header | When |
|---|---|
| `Content-Type: application/json` | Every request with a JSON body (POST/PATCH). Omit on GET/DELETE — they take no body. |
| `Authorization: Bearer <accessToken>` | Every route marked 🔒 below. Get a token from `POST /auth/login` or `POST /auth/register` first. |

Every response body is JSON (except CSV export, noted below). Every error response is `{ "error": "message" }` — see [API_REFERENCE.md](API_REFERENCE.md#conventions) for the status-code legend.

---

## Health

### `GET /health`
- **Method**: GET
- **Port**: 4000
- **Path**: `/health`
- **Full URL**: `http://localhost:4000/health`
- **Headers**: none
- **Body**: none
- **Response — 200 OK**:
```json
{ "status": "ok" }
```

---

## Auth

### `POST /api/v1/auth/register`
- **Method**: POST
- **Port**: 4000
- **Path**: `/api/v1/auth/register`
- **Full URL**: `http://localhost:4000/api/v1/auth/register`
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "password123" }
```
- **Response — 201 Created**:
```json
{
  "user": { "id": 465, "name": "Ada Lovelace", "email": "ada@example.com", "tier": "standard", "budgetClass": null, "role": "user", "isActive": true },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "e31e5875bd3c83f75159df869edb4d9366de66f..."
}
```
- **Errors**: `400` invalid input (message lists every failed field, joined by `; `) · `409 { "error": "An account with that email already exists." }`

### `POST /api/v1/auth/login`
- **Method**: POST
- **Port**: 4000
- **Path**: `/api/v1/auth/login`
- **Full URL**: `http://localhost:4000/api/v1/auth/login`
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{ "email": "user@mybudget.local", "password": "User@12345" }
```
- **Response — 200 OK**: identical shape to register's response above.
- **Errors**: `401 { "error": "Invalid email or password." }` (same message whether the email is unknown or the password is wrong) · `403 { "error": "This account has been deactivated. Contact an administrator." }` (only once the password has verified correct)

### `POST /api/v1/auth/refresh`
- **Method**: POST
- **Port**: 4000
- **Path**: `/api/v1/auth/refresh`
- **Full URL**: `http://localhost:4000/api/v1/auth/refresh`
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{ "refreshToken": "e31e5875bd3c83f75159df869edb4d9366de66f..." }
```
- **Response — 200 OK**:
```json
{ "accessToken": "eyJhbGciOiJIUzI1NiIs...", "refreshToken": "a9c1..." }
```
(the old refresh token is revoked — reusing it now returns 401)
- **Errors**: `401 { "error": "Refresh token is invalid or expired." }` · `401 { "error": "Account no longer active." }` if the account was deactivated since the token was issued

### `POST /api/v1/auth/logout`
- **Method**: POST
- **Port**: 4000
- **Path**: `/api/v1/auth/logout`
- **Full URL**: `http://localhost:4000/api/v1/auth/logout`
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{ "refreshToken": "e31e5875bd3c83f75159df869edb4d9366de66f..." }
```
- **Response — 204 No Content** (empty body)

### `GET /api/v1/auth/me` 🔒
- **Method**: GET
- **Port**: 4000
- **Path**: `/api/v1/auth/me`
- **Full URL**: `http://localhost:4000/api/v1/auth/me`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: none
- **Response — 200 OK**:
```json
{ "id": 464, "name": "Demo User", "email": "user@mybudget.local", "tier": "standard", "budgetClass": null, "role": "user", "isActive": true }
```
- **Errors**: `401` missing/invalid/expired token, or the account behind it was since deleted

### `PATCH /api/v1/auth/me/tier` 🔒
- **Method**: PATCH
- **Port**: 4000
- **Path**: `/api/v1/auth/me/tier`
- **Full URL**: `http://localhost:4000/api/v1/auth/me/tier`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body**:
```json
{ "tier": "pro" }
```
(`tier` must be `"standard"` or `"pro"`)
- **Response — 200 OK**: same `UserProfile` shape as `/auth/me`, with the new `tier`.
- **Errors**: `400` invalid tier value

---

## Categories

### `GET /api/v1/categories` 🔒
- **Method**: GET
- **Port**: 4000
- **Path**: `/api/v1/categories`
- **Full URL**: `http://localhost:4000/api/v1/categories`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: none
- **Response — 200 OK** (array — system categories, `isCustom: false`, followed by the caller's own custom ones, `isCustom: true`):
```json
[
  { "key": "electricity_laundry", "label": "Electricity & laundry", "icon": "⚡", "color": "#FCD34D", "group": "Household", "type": "expense", "isCustom": false },
  { "key": "custom_9f909c78", "label": "Pet care", "icon": "🏷️", "color": "#FB923C", "group": "Custom", "type": "expense", "isCustom": true }
]
```

### `POST /api/v1/categories` 🔒
- **Method**: POST
- **Port**: 4000
- **Path**: `/api/v1/categories`
- **Full URL**: `http://localhost:4000/api/v1/categories`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body**:
```json
{ "name": "Pet care", "type": "expense" }
```
(`name`: 1–40 chars · `type`: `"income"` or `"expense"`)
- **Response — 201 Created**:
```json
{ "key": "custom_9f909c78", "label": "Pet care", "icon": "🏷️", "color": "#FB923C", "group": "Custom", "type": "expense", "isCustom": true }
```
- **Errors**: `400` blank name / invalid type

### `PATCH /api/v1/categories/:key` 🔒
- **Method**: PATCH
- **Port**: 4000
- **Path**: `/api/v1/categories/:key` — e.g. `/api/v1/categories/custom_a9721fe5`
- **Full URL**: `http://localhost:4000/api/v1/categories/custom_a9721fe5`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body**:
```json
{ "name": "Pet care" }
```
- **Response — 200 OK** (only `label` changes — `key` is stable, so existing transactions referencing it are unaffected):
```json
{ "key": "custom_a9721fe5", "label": "Pet care", "icon": "🏷️", "color": "#60A5FA", "group": "Custom", "type": "expense", "isCustom": true }
```
- **Errors**: `400` blank name · `403 { "error": "System categories cannot be renamed." }` · `404 { "error": "Category not found." }` (doesn't exist, or belongs to another user)

### `DELETE /api/v1/categories/:key` 🔒
- **Method**: DELETE
- **Port**: 4000
- **Path**: `/api/v1/categories/:key` — e.g. `/api/v1/categories/custom_9f909c78`
- **Full URL**: `http://localhost:4000/api/v1/categories/custom_9f909c78`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: none
- **Response — 204 No Content** (empty body)
- **Errors**: `403 { "error": "System categories cannot be deleted." }` · `404 { "error": "Category not found." }` (doesn't exist, or belongs to another user) · `409 { "error": "This category is used by existing transactions and cannot be deleted." }`

### The weekly "common category" batch (not an HTTP endpoint)
No request to make — this runs automatically inside the server process (`node-cron`, Sundays 03:00) or on demand via `cd server && npm run batch:promote-categories`. See [API_REFERENCE.md](API_REFERENCE.md#the-weekly-common-category-batch--how-a-personal-category-becomes-shared) for what it does: once 3+ different users have each independently created a custom category with the same name and type, one of those rows is promoted to a system category (`user_id → NULL`, `group → "Community"`) — every other matching row is left completely untouched.

---

## Transactions

### `GET /api/v1/transactions?month=&year=` 🔒
- **Method**: GET
- **Port**: 4000
- **Path**: `/api/v1/transactions`
- **Full URL (no filter)**: `http://localhost:4000/api/v1/transactions`
- **Full URL (filtered)**: `http://localhost:4000/api/v1/transactions?month=8&year=2026`
- **Query params** (both optional): `month` (1–12), `year` (2000–2100)
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: none
- **Response — 200 OK**:
```json
[
  {
    "id": 317, "userId": 464, "category": "fuel_petrol", "amount": 500, "type": "expense",
    "subcategory": null, "note": "test", "date": "2026-08-25", "month": 8, "year": 2026,
    "created_at": "2026-08-30 16:10:09.358601+00"
  }
]
```
(note `created_at`'s format here — space-separated with a `+00` offset, not ISO-`T` — this table stores it as a raw string, unlike every other table below)

### `GET /api/v1/transactions/range?startMonth=&startYear=&endMonth=&endYear=` 🔒
- **Method**: GET
- **Port**: 4000
- **Path**: `/api/v1/transactions/range`
- **Full URL**: `http://localhost:4000/api/v1/transactions/range?startMonth=7&startYear=2026&endMonth=8&endYear=2026`
- **Query params** (all required, ints): `startMonth`, `startYear`, `endMonth`, `endYear`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: none
- **Response — 200 OK**: same array shape as `GET /transactions` above, across the inclusive month range.

### `POST /api/v1/transactions` 🔒
- **Method**: POST
- **Port**: 4000
- **Path**: `/api/v1/transactions`
- **Full URL**: `http://localhost:4000/api/v1/transactions`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body**:
```json
{ "amount": 500, "type": "expense", "category_key": "fuel_petrol", "date": "2026-08-25", "note": "test", "subcategory": null }
```
(`amount` > 0 · `type`: `"income"`/`"expense"` · `category_key`: a system category or one of your own custom ones · `date`: `YYYY-MM-DD` · `subcategory`/`note` optional, nullable)
- **Response — 201 Created**:
```json
{
  "id": 317, "userId": 464, "category": "fuel_petrol", "amount": 500, "type": "expense",
  "subcategory": null, "note": "test", "date": "2026-08-25", "month": 8, "year": 2026,
  "created_at": "2026-08-30 16:10:09.358601+00"
}
```
- **Errors**: `400` invalid amount/type/date, or `category_key` doesn't exist / isn't yours

### `PATCH /api/v1/transactions/:id` 🔒
- **Method**: PATCH
- **Port**: 4000
- **Path**: `/api/v1/transactions/:id` — e.g. `/api/v1/transactions/474`
- **Full URL**: `http://localhost:4000/api/v1/transactions/474`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body** (any non-empty subset of the `POST` fields):
```json
{ "amount": 650, "note": "petrol (corrected)" }
```
- **Response — 200 OK**:
```json
{ "id": 474, "userId": 464, "category": "fuel_petrol", "amount": 650, "type": "expense", "subcategory": null, "note": "petrol (corrected)", "date": "2026-09-13", "month": 9, "year": 2026, "created_at": "2026-09-13 11:07:42.223069+00" }
```
- **Errors**: `400` empty body, invalid field, or `category_key` invalid/not yours · `404` not found / not yours

### `DELETE /api/v1/transactions/:id` 🔒
- **Method**: DELETE
- **Port**: 4000
- **Path**: `/api/v1/transactions/:id` — e.g. `/api/v1/transactions/317`
- **Full URL**: `http://localhost:4000/api/v1/transactions/317`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Body**: none
- **Response — 204 No Content** (empty body)
- **Errors**: `404 { "error": "Transaction not found." }` (doesn't exist, or belongs to another user)

---

## Loans

### `GET /api/v1/loans` 🔒
- **Method**: GET · **Port**: 4000 · **Path**: `/api/v1/loans` · **Full URL**: `http://localhost:4000/api/v1/loans`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK** (only `is_active: true` rows):
```json
[
  {
    "id": 195, "userId": 464, "name": "Test loan", "principal": 100000, "outstanding": 85000, "emi": 5000,
    "interest_rate": null, "tenure_months": null, "start_date": null, "loan_type": null, "lender": null, "note": null,
    "is_active": true, "created_at": "2026-08-30T16:10:09.456Z", "updated_at": "2026-08-30T16:10:57.311Z"
  }
]
```

### `POST /api/v1/loans` 🔒
- **Method**: POST · **Port**: 4000 · **Path**: `/api/v1/loans` · **Full URL**: `http://localhost:4000/api/v1/loans`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body**:
```json
{ "name": "Test loan", "principal": 100000, "outstanding": 90000, "emi": 5000, "interest_rate": null }
```
(`principal` > 0 · `outstanding` >= 0 · `emi` > 0 · `interest_rate` optional, nullable)
- **Response — 201 Created**: same shape as one item of the `GET /loans` array above (`is_active: true` by default).
- **Errors**: `400` invalid body

### `PATCH /api/v1/loans/:id` 🔒
- **Method**: PATCH · **Port**: 4000 · **Path**: `/api/v1/loans/:id` — e.g. `/api/v1/loans/265`
- **Full URL**: `http://localhost:4000/api/v1/loans/265`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body** (any non-empty subset of `{ name, principal, outstanding, emi, interest_rate }`):
```json
{ "name": "Car loan (refinanced)", "emi": 9500, "interest_rate": 7.9 }
```
The "mark EMI paid" quick action just sends `{ "outstanding": outstanding - emi }`; the full edit form can send any/all fields.
- **Response — 200 OK**:
```json
{ "id": 265, "userId": 464, "name": "Car loan (refinanced)", "principal": 500000, "outstanding": 400000, "emi": 9500, "interest_rate": 7.9, "tenure_months": null, "start_date": null, "loan_type": null, "lender": null, "note": null, "is_active": true, "created_at": "2026-09-13T11:07:42.531Z", "updated_at": "2026-09-13T11:07:42.742Z" }
```
- **Errors**: `400` empty body or invalid field · `404 { "error": "Loan not found." }` (doesn't exist, or belongs to another user)

### `DELETE /api/v1/loans/:id` 🔒
- **Method**: DELETE · **Port**: 4000 · **Path**: `/api/v1/loans/:id` — e.g. `/api/v1/loans/195`
- **Full URL**: `http://localhost:4000/api/v1/loans/195`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 204 No Content** (empty body)
- **Errors**: `404` not found / not yours

---

## Investments

### `GET /api/v1/investments` 🔒
- **Method**: GET · **Port**: 4000 · **Path**: `/api/v1/investments` · **Full URL**: `http://localhost:4000/api/v1/investments`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK**:
```json
[
  {
    "id": 109, "userId": 464, "name": "Test fund", "type": "Mutual fund", "amount": 10000, "current_value": 10000,
    "start_date": "2026-08-30", "maturity_date": null, "returns_percent": 0, "note": null,
    "created_at": "2026-08-30T16:10:09.541Z", "updated_at": "2026-08-30T16:10:09.541Z"
  }
]
```

### `POST /api/v1/investments` 🔒
- **Method**: POST · **Port**: 4000 · **Path**: `/api/v1/investments` · **Full URL**: `http://localhost:4000/api/v1/investments`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body**:
```json
{ "name": "Test fund", "type": "Mutual fund", "amount": 10000, "current_value": 12000 }
```
(`amount` > 0 · `current_value` optional — defaults to `amount` if omitted. **Never send `returns_percent`** — the server always derives and overwrites it.)
- **Response — 201 Created**: same shape as one item of `GET /investments` above (`returns_percent` computed server-side: `(current_value - amount) / amount * 100`).
- **Errors**: `400` invalid body

### `PATCH /api/v1/investments/:id` 🔒
- **Method**: PATCH · **Port**: 4000 · **Path**: `/api/v1/investments/:id` — e.g. `/api/v1/investments/166`
- **Full URL**: `http://localhost:4000/api/v1/investments/166`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body** (any non-empty subset of `{ name, type, amount, current_value }`):
```json
{ "current_value": 11000 }
```
- **Response — 200 OK** (`returns_percent` **recomputed server-side** using the resulting `amount`/`current_value` — existing values fill in whichever field wasn't sent — still never accepted from the client):
```json
{ "id": 166, "userId": 464, "name": "Index fund", "type": "Mutual fund", "amount": 10000, "current_value": 11000, "start_date": "2026-09-13", "maturity_date": null, "returns_percent": 10, "note": null, "created_at": "2026-09-13T11:07:42.809Z", "updated_at": "2026-09-13T11:07:43.024Z" }
```
- **Errors**: `400` empty body or invalid field · `404` not found / not yours

### `DELETE /api/v1/investments/:id` 🔒
- **Method**: DELETE · **Port**: 4000 · **Path**: `/api/v1/investments/:id` — e.g. `/api/v1/investments/109`
- **Full URL**: `http://localhost:4000/api/v1/investments/109`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 204 No Content** (empty body)
- **Errors**: `404` not found / not yours

---

## Goals

### `GET /api/v1/goals` 🔒
- **Method**: GET · **Port**: 4000 · **Path**: `/api/v1/goals` · **Full URL**: `http://localhost:4000/api/v1/goals`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK**:
```json
[
  {
    "id": 171, "userId": 464, "name": "Test goal", "target_amount": 50000, "saved_amount": 5000,
    "deadline": null, "color": "#10B981", "icon": "star", "note": null,
    "created_at": "2026-08-30T16:10:09.645Z", "updated_at": "2026-08-30T16:10:57.564Z"
  }
]
```

### `POST /api/v1/goals` 🔒
- **Method**: POST · **Port**: 4000 · **Path**: `/api/v1/goals` · **Full URL**: `http://localhost:4000/api/v1/goals`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body**:
```json
{ "name": "Test goal", "target_amount": 50000 }
```
(`target_amount` > 0. `color` is assigned server-side, round-robin from a fixed palette — don't send it.)
- **Response — 201 Created**: same shape as one item of `GET /goals` above, with `saved_amount: 0`.
- **Errors**: `400` invalid body

### `PATCH /api/v1/goals/:id` 🔒
- **Method**: PATCH · **Port**: 4000 · **Path**: `/api/v1/goals/:id` — e.g. `/api/v1/goals/243`
- **Full URL**: `http://localhost:4000/api/v1/goals/243`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <accessToken>`
- **Body** (any non-empty subset of `{ name, target_amount, saved_amount }`):
```json
{ "name": "Emergency fund (6mo)", "target_amount": 150000 }
```
The "Add funds" action sends just `{ "saved_amount": current.saved_amount + contribution }` — the new **cumulative total**, not a delta.
- **Response — 200 OK**:
```json
{ "id": 243, "userId": 464, "name": "Emergency fund (6mo)", "target_amount": 150000, "saved_amount": 0, "deadline": null, "color": "#10B981", "icon": "star", "note": null, "created_at": "2026-09-13T11:07:43.088Z", "updated_at": "2026-09-13T11:07:43.294Z" }
```
- **Errors**: `400` empty body, non-positive `target_amount`, or negative `saved_amount` · `404` not found / not yours

### `DELETE /api/v1/goals/:id` 🔒
- **Method**: DELETE · **Port**: 4000 · **Path**: `/api/v1/goals/:id` — e.g. `/api/v1/goals/171`
- **Full URL**: `http://localhost:4000/api/v1/goals/171`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 204 No Content** (empty body)
- **Errors**: `404` not found / not yours

---

## Reports

All routes in this section take the same four query params (`startMonth`, `startYear`, `endMonth`, `endYear` — all required ints) except `/goal-eta`, which takes none (always uses the trailing 3 months).

### `GET /api/v1/reports/summary` 🔒
- **Full URL**: `http://localhost:4000/api/v1/reports/summary?startMonth=8&startYear=2026&endMonth=8&endYear=2026`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK**:
```json
{ "totalIncome": 0, "totalExpense": 500, "netSavings": -500 }
```

### `GET /api/v1/reports/monthly-series` 🔒
- **Full URL**: `http://localhost:4000/api/v1/reports/monthly-series?startMonth=8&startYear=2026&endMonth=8&endYear=2026`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK** (one entry per calendar month in range, zero-filled if empty):
```json
[{ "month": 8, "year": 2026, "label": "Aug 2026", "income": 0, "expense": 500, "net": -500 }]
```

### `GET /api/v1/reports/category-breakdown` 🔒
- **Full URL**: `http://localhost:4000/api/v1/reports/category-breakdown?startMonth=8&startYear=2026&endMonth=8&endYear=2026&type=expense`
- **Query adds**: `type` = `"income"` or `"expense"` (required)
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK** (descending by total):
```json
[{ "category": "fuel_petrol", "total": 500 }]
```

### `GET /api/v1/reports/export.csv` 🔒
- **Full URL**: `http://localhost:4000/api/v1/reports/export.csv?startMonth=8&startYear=2026&endMonth=8&endYear=2026`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK**, `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="mybudget-2026-08_to_2026-08.csv"` — **not JSON**, raw CSV text:
```
date,type,category,amount,note
2026-08-25,expense,fuel_petrol,500,test
```
(header row only if there are no transactions in range)

### `GET /api/v1/reports/debt-payoff` 🔒
- **Full URL**: `http://localhost:4000/api/v1/reports/debt-payoff?strategy=snowball&extraPerMonth=0`
- **Query**: `strategy` = `"snowball"` or `"avalanche"` (default `snowball`) · `extraPerMonth` (default `0`)
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK**:
```json
[{ "loanId": 195, "name": "Test loan", "payoffMonths": 18, "payoffDate": "2028-02" }]
```

### `GET /api/v1/reports/goal-eta` 🔒
- **Full URL**: `http://localhost:4000/api/v1/reports/goal-eta`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK**:
```json
{
  "avgMonthlySavings": -166.66666666666666,
  "goals": [{ "goalId": 171, "name": "Test goal", "monthsRemaining": null, "etaDate": null }]
}
```
(`monthsRemaining`/`etaDate` are `null` when average savings isn't positive — nothing to project from)

---

## Net worth

### `POST /api/v1/net-worth/snapshot` 🔒
- **Method**: POST · **Port**: 4000 · **Path**: `/api/v1/net-worth/snapshot` · **Full URL**: `http://localhost:4000/api/v1/net-worth/snapshot`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none (recomputed entirely server-side)
- **Response — 200 OK**:
```json
{ "id": 97, "userId": 464, "month": 8, "year": 2026, "netWorth": -80000, "recordedAt": "2026-08-30T16:10:21.383Z" }
```
(upserts — calling again in the same month updates this row rather than creating a new one)

### `GET /api/v1/net-worth/history` 🔒
- **Method**: GET · **Port**: 4000 · **Path**: `/api/v1/net-worth/history` · **Full URL**: `http://localhost:4000/api/v1/net-worth/history`
- **Headers**: `Authorization: Bearer <accessToken>` · **Body**: none
- **Response — 200 OK** (ascending by year, month):
```json
[{ "month": 8, "year": 2026, "netWorth": -80000 }]
```

---

## Admin 🔒🛡️ (`role: 'admin'` required)

### `GET /api/v1/admin/users`
- **Method**: GET · **Port**: 4000 · **Path**: `/api/v1/admin/users` · **Full URL**: `http://localhost:4000/api/v1/admin/users`
- **Headers**: `Authorization: Bearer <adminAccessToken>` · **Body**: none
- **Response — 200 OK** (ordered by `createdAt` — account fields only, never financial data):
```json
[{ "id": 1, "name": "Verify User", "email": "verify-...@example.com", "role": "user", "tier": "pro", "isActive": true, "budgetClass": "middle", "createdAt": "2026-08-26T13:48:39.998Z" }]
```
- **Errors**: `401` no/invalid token · `403 { "error": "Admin access required." }` if the caller isn't an admin

### `PATCH /api/v1/admin/users/:id`
- **Method**: PATCH · **Port**: 4000 · **Path**: `/api/v1/admin/users/:id` — e.g. `/api/v1/admin/users/465`
- **Full URL**: `http://localhost:4000/api/v1/admin/users/465`
- **Headers**: `Content-Type: application/json`, `Authorization: Bearer <adminAccessToken>`
- **Body** (at least one field):
```json
{ "isActive": false, "role": "user", "tier": "standard" }
```
- **Response — 200 OK**: the updated account, same shape as `GET /admin/users`' array items.
- **Errors**: `400` empty body, or `:id` is the caller's own account (use your own login for that) · `403` non-admin caller · `404` account not found

### `DELETE /api/v1/admin/users/:id`
- **Method**: DELETE · **Port**: 4000 · **Path**: `/api/v1/admin/users/:id` — e.g. `/api/v1/admin/users/465`
- **Full URL**: `http://localhost:4000/api/v1/admin/users/465`
- **Headers**: `Authorization: Bearer <adminAccessToken>` · **Body**: none
- **Response — 204 No Content** (empty body) — cascades to everything that account owns
- **Errors**: `400` `:id` is the caller's own account · `403` non-admin caller · `404` account not found

---

## Getting a token to test with

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@mybudget.local","password":"User@12345"}'
```
Take `.accessToken` from the response and use it as `Authorization: Bearer <that value>` on every 🔒 route above. It expires in 15 minutes — re-login or use `.refreshToken` against `POST /auth/refresh` to get a new pair. Swap the credentials for `admin@mybudget.local` / `Admin@12345` (see [FAQ.md](FAQ.md#10-test-accounts--1-user-1-admin)) to test the 🛡️ admin routes.
