# My Budget — App Documentation

Personal budgeting app, built from `DESIGN_SPEC_v2.md` / `MASTER_BUILD_PROMPT_v2.md` (mobile + web), now backed by a real Node.js + Express + PostgreSQL server — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) and [MASTER_BUILD_PROMPT_v3_BACKEND.md](MASTER_BUILD_PROMPT_v3_BACKEND.md) for how it's built.

> This doc reflects what is actually implemented today, not the full original spec. Deviations from the spec are called out explicitly below.

---

## 0. Documentation index

| Doc | Covers |
|---|---|
| This file | Tech stack, architecture, feature list, flows, screens, testing, running the app |
| [API_REFERENCE.md](API_REFERENCE.md) | Every HTTP endpoint the server exposes — method, auth, request/response shapes, error cases. Kept in sync with the route code and its tests — see that doc's "Keeping this honest" section |
| [API_REQUESTS.md](API_REQUESTS.md) · [API_REQUESTS.csv](API_REQUESTS.csv) | The literal wire format for every endpoint — method, full URL, port, headers, body, and a real captured response for each. Copy-paste testable with curl/Postman; the CSV is the same 39 rows, spreadsheet-friendly |
| [FAQ.md](FAQ.md) | Answers to specific questions asked about the running system (admin access, scalability, deployment, test accounts, etc.) — add new ones here rather than re-asking |
| [PRO_FEATURES_DESIGN.md](PRO_FEATURES_DESIGN.md) | Pro feature roadmap, Ramsey Solutions research, data/session design |
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | PostgreSQL schema design — implemented, matches `server/src/db/schema.ts` |
| [MASTER_BUILD_PROMPT_v3_BACKEND.md](MASTER_BUILD_PROMPT_v3_BACKEND.md) | Server structure, API endpoints, auth flow, Docker changes, client integration — implemented and verified |
| [pro-roadmap.html](pro-roadmap.html) · [live](https://claude.ai/code/artifact/80837269-945e-4a79-b5da-678c946641a1) | Rendered version of the Pro roadmap |
| [architecture-flows.html](architecture-flows.html) · [live](https://claude.ai/code/artifact/3787e434-ead3-4e0a-881d-119411b2a53d) | Layered architecture, debt-payoff simulation, bulk-entry/bucketing, Docker deployment, test coverage map |
| [database-erd.html](database-erd.html) · [live](https://claude.ai/code/artifact/93804504-fbe6-4c83-9a90-0415e333b7a1) | Entity-relationship diagram for the Postgres schema |

The `.html` files are self-contained — open them directly in any browser, no server needed. The "live" links are the same content hosted on claude.ai with nicer rendering/theming.

---

## 1. Tech stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 57 + React Native 0.86, React 19, TypeScript |
| Routing | expo-router (file-based, tab navigator) |
| Client data layer | `utils/database.ts` + `utils/api.ts` — thin axios wrapper calling the server's REST API; identical on native and web (no more platform split) |
| Business logic | `utils/calculations.ts` — pure, storage-agnostic functions shared by **both** the client and the server (`server/src/calculations.ts` re-exports it directly) |
| Session | `@react-native-async-storage/async-storage`, storing a short-lived JWT access token + a rotated refresh token (`utils/tokenStorage.ts`) |
| Icons | `@expo/vector-icons` (Ionicons) |
| Charts | `react-native-chart-kit` (line + pie, Reports tab) |
| File export | `expo-file-system` + `expo-sharing` (native), Blob download (web) — CSV text now comes straight from the server (`GET /reports/export.csv`) |
| Alerts/confirms | Custom `utils/alert.ts` / `.web.ts` — see "Known deviations" |
| State management | React Context (`AuthContext`) |
| Web support | react-native-web, react-dom |
| Client testing | Jest + `jest-expo`, `@types/jest` |
| **Server** | Node.js + Express 4 + TypeScript (`server/`) |
| **Server ORM** | Drizzle ORM + drizzle-kit (schema in `server/src/db/schema.ts`, migrations in `server/drizzle/`) |
| **Database** | PostgreSQL 16, via Docker (host port 5433 — see note below) |
| **Auth** | bcrypt (password hashing, cost 12) + jsonwebtoken (15-min access token, 30-day rotated refresh token, hashed at rest) |
| **Server validation** | zod (request body/query validation) |
| **Server testing** | Jest + Supertest, against a real Postgres instance (no mocking) |
| Local deployment | Docker Compose — three services: `mybudget-web` (static export → nginx), `server` (Express), `postgres` |

---

## 2. Server architecture

The app is **fully online-only** — every screen calls the API server directly through `utils/api.ts`/`utils/database.ts`; nothing is cached or queued on-device beyond the JWT pair. This was a deliberate simplification (see [DATABASE_DESIGN.md](DATABASE_DESIGN.md)) to avoid the much larger scope of background sync/conflict resolution; it's a real design choice, not a placeholder.

```
Screen component
  → utils/database.ts (CRUD functions, same names as the old local layer)
    → utils/api.ts (axios instance: attaches JWT, silent-refreshes on 401)
      → HTTP → Express server (server/src/routes/*.ts)
        → Drizzle ORM → PostgreSQL
        → utils/calculations.ts (re-exported, same module the client also uses)
```

All aggregation and business math (month summaries, category breakdowns, net worth, debt payoff simulation, CSV formatting) lives in **`utils/calculations.ts`**, a pure module with zero dependency on SQLite, `localStorage`, HTTP, or `Platform` — the server imports it via a one-line re-export (`server/src/calculations.ts`) rather than reimplementing any of it. This is the architectural centerpiece that made the SQLite/localStorage → Postgres migration a data-layer swap, not a rewrite. See [architecture-flows.html](architecture-flows.html) for the full diagram (note: predates the backend migration — the layered-architecture and testing sections are still accurate, but its "no server" framing is now out of date).

Every table is scoped by `user_id`, enforced **server-side** in the `requireAuth` middleware plus a `WHERE user_id = req.userId` on every query — never trusted from the client. This closes the class of bug found earlier in the local build (see [PRO_FEATURES_DESIGN.md](PRO_FEATURES_DESIGN.md) §C1) properly, at the source of truth instead of an app-level convention.

Postgres runs in Docker, mapped to **host port 5433, not 5432** — this dev machine already has a native Windows PostgreSQL service occupying 5432. Container-to-container traffic (the `server` service talking to `postgres`) is unaffected, still port 5432 on the internal Docker network.

### Known deviations from the spec
- **Budget class is now server-computed**, as originally spec'd — `recomputeBudgetClass` runs on every `POST /transactions` and is reflected via `GET /auth/me`, using the same `classifyLocal` from the shared calculations module fed by a real Drizzle query. The old client-side placeholder is gone.
- **No OTP / phone login** — email + password only (OTP requires an SMS backend that doesn't exist here).
- **No cloud sync conflict-resolution, Admin portal, or Enterprise API** — out of scope for this build so far. (Basic server-side session/user administration exists in the form of the auth endpoints themselves; there's no separate admin UI.)
- **"Pro" is a test toggle, not a real subscription.** There's no payment processor (RevenueCat was never wired up), so every `ProGate` shows a "Try Pro (test mode)" button that calls `PATCH /auth/me/tier` and flips `tier` to `'pro'` server-side — real billing is future work.
- **`Alert.alert` doesn't work on web** — `react-native-web`'s implementation is a literal no-op (`static alert() {}`), which silently broke every delete-confirmation and save dialog on web until fixed. Replaced with a platform-split helper (`utils/alert.ts` uses the real native `Alert`; `utils/alert.web.ts` uses `window.confirm`/`window.alert`). Worth remembering if you add a new confirm dialog — always go through `utils/alert`, never `Alert` from `react-native` directly.

---

## 3. Feature list

**Free (Standard tier)**
- **Auth** — register/login with email + password, server-side bcrypt + JWT session, no guest mode
- **Dashboard** — current-month income/expense/net savings, top-5 expense categories, budget-class badge, Expense/Loan/Investment breakdown
- **Input expenses** — bulk entry screen: pick Monthly/Quarterly/Yearly, add one row per category+amount, save all at once (mirrors the original Excel workflow)
- **Transactions** — add/edit/delete, income or expense, all 50+ categories from the source Excel data, optional Monthly/Quarterly/Yearly period on new entries (converted to a monthly-equivalent amount, same as Input Expenses) — tap a row to edit it, tap the trash icon to delete it
- **Custom categories** — add, rename, and delete your own category (name + income/expense) from any category picker, with a search box to find items once the list grows — see §3a. Widely-adopted custom categories are folded into the shared list automatically by a weekly batch, without ever touching anyone's own list or data
- **Loans** — add/edit/delete, track principal/outstanding/EMI/interest rate, "mark EMI paid" button — tap a card to edit any field, trash icon to delete
- **Investments** — add/edit/delete, invested vs. current value, auto-computed gain % (recomputed server-side on every edit), portfolio summary — tap a card to edit, trash icon to delete
- **Goals** — add/edit/delete, contribute funds, progress bar toward target — tap a card to edit name/target, trash icon to delete

**Pro (test-mode toggle, no real billing)**
- **Reports tab** — time-range picker (month/3mo/6mo/year/all-time), income/expense/net trend chart, category donut, debt payoff progress, goal progress, CSV export
- **Debt payoff planner** (Loans tab) — snowball or avalanche strategy, month-by-month payoff simulation with EMI-rolling, "what if I add ₹X/mo"
- **Goal ETA** (Goals tab) — projected completion date from your trailing 3-month savings rate
- **Spending insights** (Dashboard) — month-over-month category deltas, savings rate
- **Net worth tracking** — computed live (investments + goal savings − loan outstanding) and snapshotted monthly for trending in Reports

**Admin (role: 'admin' accounts only)**
- **User management** (`/admin`, shield icon on the Dashboard) — list every account (name, email, role, tier, active status, budget class, join date), without visibility into anyone's financial data
- **Access control** — activate/deactivate any account (deactivated accounts are rejected at login, and mid-session within one refresh cycle — see §3a), promote/demote between `user` and `admin`, override tier
- **Account deletion** — permanently remove an account and everything it owns (cascading delete)
- An admin can never modify or delete their own account through this screen (self-lockout is structurally impossible, not just guarded) — use your own login to change your own settings

---

## 3a. Custom categories & access control — how they actually work

**Custom categories.** Every category is a row in the server's `categories` table. System categories (seeded from `constants/categories.ts`, `user_id NULL`) are shared by everyone and can't be deleted or renamed. `POST /api/v1/categories { name, type }` creates a new one owned by the caller (`group: 'Custom'`, a rotating icon/color, a generated `custom_xxxxxxxx` key) — `GET /api/v1/categories` returns system categories plus only the caller's own, and the `CategoryPicker` component's search box filters that combined list client-side once it grows. `PATCH /api/v1/categories/:key { name }` renames the caller's own custom category (the `key` never changes, so nothing referencing it breaks). `DELETE /api/v1/categories/:key` is rejected with 403 for a system category, 404 for another user's custom category (existence isn't leaked), and 409 if it's still referenced by one of the user's own transactions (the database's foreign key is what actually enforces this — the route just turns the constraint violation into a friendly message). `POST /transactions` independently re-validates that a submitted category is a system category or belongs to the caller, so a guessed/leaked custom category key from another account can't be used to log a transaction against it.

**The common list improves itself, without ever touching anyone's own list.** A weekly batch (`node-cron`, Sundays 03:00, `server/src/index.ts`; also runnable by hand via `cd server && npm run batch:promote-categories`) scans every custom category across every account (`server/src/lib/categoryPromotion.ts`). Whenever 3 or more *different* users have each independently created a custom category with the same name and type — and no system category already covers it — one of those rows is promoted: its `user_id` flips to `NULL` and its `group` to `'Community'`, so it now shows up in *everyone's* list, including brand-new users who've never touched it. Its `key` never changes, so existing transactions keep working. Critically, every *other* user's identically-named row is left completely alone — still theirs, still in `'Custom'`, still separately editable/deletable — the mechanism only ever adds to the shared list, it never merges, deletes, or repoints anyone's data. It also never reads anything but category labels, so it carries none of the cross-user financial-data exposure the rest of this doc is careful to rule out. See [API_REFERENCE.md](API_REFERENCE.md#the-weekly-common-category-batch--how-a-personal-category-becomes-shared) for the exact algorithm and [categoryPromotion.test.ts](../server/src/__tests__/categoryPromotion.test.ts) for what's verified.

**Access control.** `users.role` (`'user' | 'admin'`) and `users.isActive` gate everything:
- `POST /api/v1/auth/login` rejects a correct password with 403 if `isActive` is false (checked only after the password is verified, so it can't be used to enumerate accounts).
- `POST /api/v1/auth/refresh` re-checks `isActive` on every refresh and revokes the refresh token if the account has since been deactivated — a deactivated user's session dies within one access-token lifetime (15 min), even if they were already logged in.
- `/api/v1/admin/users/*` requires `requireAuth` then `requireAdmin` (`server/src/middleware/requireAdmin.ts`), which looks the caller's role up fresh from the database on every request rather than trusting a JWT claim, so a demotion takes effect immediately on this surface instead of waiting for token expiry.
- Every admin route refuses to act on the caller's own account (`id === req.userId` → 400) — since the acting admin is therefore always still a valid active admin after any operation the endpoint allows, there's no separate "don't demote the last admin" check needed; self-modification being blocked already makes that scenario unreachable.

---

## 4. Functionality flows

**Auth flow**
```
app launch → check AsyncStorage for a token pair
  → tokens found → GET /auth/me (axios interceptor silently refreshes
      the access token first if it's stale) → succeeds → /(tabs) dashboard
                                             → fails → /login
  → none found → /login
       → "Create an account" → /register → POST /auth/register → tokens stored → /(tabs)
       → sign in → POST /auth/login → tokens stored → /(tabs)
```

**Add-data flow** (same pattern for transactions / loans / investments / goals)
```
tab screen → tap "+" → modal form → validate inputs → setSaving(true)
  → POST to the API (utils/database.ts → utils/api.ts) → close modal on success
  → show the server's error message on failure (apiErrorMessage) → setSaving(false)
  → list re-fetches from the server on screen focus
```

**Bulk expense entry** (Input Expenses)
```
Dashboard → "Input expenses" → pick period (Monthly/Quarterly/Yearly)
  → fill category+amount rows (add/remove as needed)
  → Save → each row becomes a transaction, amount divided to its monthly
    equivalent if Quarterly/Yearly → back to Dashboard, breakdown updates
```

**Category selection**
```
form → tap category field → bottom-sheet modal
  (grouped: Household, Food & dining, Transport, Health, Family, Loans & EMIs,
   Credit cards, Shopping & misc, Property & farming, Investments & savings,
   Lending / personal loans, Income)
  → tap item → selection reflected in the form
```

**Reports (on-demand)**
```
Reports tab → pick range preset → getMonthlySeriesForRange / getRangeSummary /
  getCategoryBreakdownForRange (utils/database.ts → API) → server pulls rows via
  Drizzle → computeMonthlySeries etc. (the same pure calculations module,
  running server-side) → JSON response → charts + summary render
  → Export CSV → GET /reports/export.csv → server-generated CSV text → share/download
```

**Budget-class recompute**
```
POST /transactions (server) → pull last 3 months' expense totals via Drizzle → average
  → classifyLocal (low/middle/high/ultra_high/rich) → persist to users.budget_class
  → next GET /auth/me (e.g. dashboard focus) reflects the updated class
```

---

## 5. Pages / screens (10 total)

| # | Screen | File | Notes |
|---|---|---|---|
| 1 | Login | `app/login.tsx` | Email + password |
| 2 | Register | `app/register.tsx` | Name, email, password |
| 3 | Input expenses | `app/input-expenses.tsx` | Modal stack screen, reached from Dashboard |
| 4 | Dashboard | `app/(tabs)/index.tsx` | Tab 1 |
| 5 | Transactions | `app/(tabs)/transactions.tsx` | Tab 2 |
| 6 | Loans | `app/(tabs)/loans.tsx` | Tab 3 |
| 7 | Investments | `app/(tabs)/investments.tsx` | Tab 4 |
| 8 | Goals | `app/(tabs)/goals.tsx` | Tab 5 |
| 9 | Reports | `app/(tabs)/reports.tsx` | Tab 6, Pro-gated |
| 10 | Admin — Users | `app/admin/index.tsx` | Modal stack screen, reached from the Dashboard's shield icon (`role: 'admin'` only) |

`app/index.tsx` is a redirect (session check → `/login` or `/(tabs)`), not a user-facing page, so it's not counted above.

---

## 6. Testing & quality

**Client** (repo root):
```bash
npm test              # run once — 47 tests, utils/calculations.ts only
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
npm run typecheck     # tsc --noEmit
npm run quality       # typecheck + coverage — the single gate to run before any build
```

47 tests cover every function in `utils/calculations.ts` (100% line/function coverage, 98% branch), enforced by a coverage threshold in `package.json`. The root Jest config excludes `server/` (`testPathIgnorePatterns`), since the server has its own Jest config and needs a live Postgres connection.

**Server** (`server/`):
```bash
npm run typecheck     # tsc --noEmit
npm test               # 125 tests — one file per resource (auth, categories,
                        # transactions, loans, investments, goals, reports,
                        # net worth, admin), the weekly category-promotion
                        # batch, a health/404 smoke test, and one full e2e
                        # lifecycle test
npm run test:coverage  # same, plus a coverage report + enforced floor (see below)
npm run quality        # typecheck && test
```

The server suite runs against a **real Postgres instance** via Supertest (no mocking) — `docker compose up -d postgres` (or the existing native/Docker Postgres on `DATABASE_URL`) must be reachable first, and migrations/seed data applied (`npm run db:migrate && npm run db:seed`). Every resource file checks cross-user data isolation (a second account can never read/modify/delete the first account's rows) and unauthenticated access (401 without a token); `e2e.test.ts` walks a full lifecycle (register → add data across all resource types → verify server-computed budget class → verify reports/debt-payoff/net-worth/CSV export → tier toggle → logout invalidates the refresh token but not the still-live access token).

**Every route documented in [API_REFERENCE.md](API_REFERENCE.md) has direct test coverage.** `server/jest.config.js` collects coverage over `src/routes/`, `src/middleware/`, and `src/lib/` and enforces a floor (80% branches, 90% functions/lines/statements) — `npm run test:coverage` (and therefore `npm run quality`, and therefore the pre-commit hook below) **fails the build** if a new endpoint or branch ships without a test. The handful of intentionally-uncovered lines are defensive fallbacks that zod validation already makes unreachable (documented inline in the route files) — not gaps.

**Not covered by automated tests:** screen components and `AuthContext` — verified instead by a real click-through in the browser against the live Docker stack (register, login, bulk "Input expenses" entry, add/delete across every tab, Reports charts, CSV export, admin user management). See [architecture-flows.html](architecture-flows.html) for the coverage map and debt-payoff simulation flowchart (client-side testing architecture, still accurate).

### Enforcement — tests run automatically before every commit

A git pre-commit hook (Husky — `.husky/pre-commit`, wired up via the root `package.json`'s `prepare` script, so it's installed automatically on `npm install`) runs the quality gate on every `git commit`:

1. **Client**: `npm run quality` (typecheck + the full client test suite) — always.
2. **Server**: `cd server && npm run quality` (typecheck + the full server test suite) — **only if the commit touches anything under `server/`**, so a client-only commit doesn't require Postgres to be running. If it does run and can't reach Postgres, the hook fails with a reminder to `docker compose up -d postgres` rather than silently skipping.

A commit is blocked if either gate fails. This is what "tested every time a change happens" means concretely in this repo — not a CI service (there's no remote), but a local gate nothing can bypass without `git commit --no-verify`.

### `scripts/` — terse wrappers for the noisy commands

Running the client and server quality gates separately, or rebuilding the Docker stack, prints a lot of output (coverage tables, npm/Metro build logs) that's only useful when something actually fails. These wrap the same commands and only surface the noise on failure:

| Script | Does |
|---|---|
| `npm run verify` (`scripts/verify.sh`) | Client + server typecheck and tests. Prints `Client: OK` / `Server: OK` / `ALL CHECKS PASSED`, or the last 40 log lines if either side fails. |
| `npm run verify:docker` (`scripts/docker-verify.sh`) | `docker compose up --build -d`, polls `/health` until the server's actually up (migrations + seeding can take a few seconds on a cold start), then prints container status. Fails loudly with recent server logs if it never comes up. |
| `scripts/get-token.sh [email] [password]` | Prints a fresh access token for the given account (defaults to the seeded demo user) — for one-off `curl` testing without retyping the login/parse boilerplate each time, e.g. `TOKEN=$(scripts/get-token.sh); curl -H "Authorization: Bearer $TOKEN" ...`. |

---

## 7. Running it

A running backend is required for every option below — the app is fully online-only.

### Option A — full Docker stack (closest to a real deployment)

```bash
cd D:\MyBudgetApp
docker compose up --build
```

Brings up all three services: `postgres` (host port 5433), `server` (Express API, host port 4000, runs migrations + seeds categories **and two demo accounts** on every start via `docker-entrypoint.sh`), and `mybudget-web` (static `expo export --platform web` build served via nginx, host port 8080). Open `http://localhost:8080`. Stop with `docker compose down` (add `-v` only if you intend to also wipe the Postgres volume — that deletes all data, including the demo accounts, which get recreated on the next `up` anyway).

**Test accounts** (seeded by `server/src/db/seed-accounts.ts` — local dev only, never reuse these for anything internet-facing):

| Role | Email | Password |
|---|---|---|
| Super admin | `admin@mybudget.local` | `Admin@12345` |
| Standard user | `user@mybudget.local` | `User@12345` |

Re-seed manually any time with `cd server && npm run db:seed:accounts` (idempotent — resets the password/role, doesn't touch their data).

### Option B — dev server + Dockerized backend (hot reload for UI work)

```bash
docker compose up -d postgres server   # backend only
npx expo start --web --port 8090       # client with hot reload
```

Then open `http://localhost:8090`. The client's default API base URL (`utils/api.ts`, `EXPO_PUBLIC_API_URL` fallback) already points at `http://localhost:4000/api/v1`, which matches the Dockerized server's host port mapping — no extra config needed for local dev.

### Option C — server running directly on the host (no server container)

```bash
docker compose up -d postgres          # database only
cd server
npm run db:migrate && npm run db:seed  # first time only, or after a schema change
npm run dev                             # tsx watch — hot reload on server changes
```

Useful when iterating on server code, since `tsx watch` is faster to reload than rebuilding the Docker image each time.

### Option D — Android APK

EAS Build is set up (`eas.json`, `preview` profile → APK) but requires `npx eas-cli login` first (interactive, must be run by you). The APK will need `EXPO_PUBLIC_API_URL` pointed at a server reachable from the device (not `localhost`) — a real deployed server or the dev machine's LAN IP.
