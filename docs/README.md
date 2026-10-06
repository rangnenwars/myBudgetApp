# Prapanji — App Documentation

Prapanji (formerly "My Budget") is a personal money app for everyone — student-specific features are kept as options. Personal budgeting app, built from `DESIGN_SPEC_v2.md` / `MASTER_BUILD_PROMPT_v2.md` (mobile + web), now backed by a real Node.js + Express + PostgreSQL server — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) and [MASTER_BUILD_PROMPT_v3_BACKEND.md](MASTER_BUILD_PROMPT_v3_BACKEND.md) for how it's built.

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
| [DEPLOYMENT.md](DEPLOYMENT.md) | Step-by-step guide to deploying this app on a cloud Linux server — provisioning, Docker, TLS, hardening, backups |
| [DEPLOYMENT_DIGITALOCEAN.md](DEPLOYMENT_DIGITALOCEAN.md) | Production plan for prapanji.in on a DigitalOcean Droplet with GitHub Actions CI/CD — GHCR images, Caddy TLS, approval-gated deploys, rollback, backups |
| [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) | **Manual** deployment to the DigitalOcean Droplet (registry path and image-transfer path), rollback, backups/restore, everyday commands, troubleshooting |
| [INFRASTRUCTURE_REFERENCE.md](INFRASTRUCTURE_REFERENCE.md) | Production vs local inventory — IPs, ports, database details, Cloud Firewall rules, DNS/TLS, where each secret and env var lives |
| [SYSTEM_ARCHITECTURE_GUIDE.md](SYSTEM_ARCHITECTURE_GUIDE.md) | How the stack works end to end, request flow, roles, repo map, and a "which file do I edit to change X" table |
| [SECURITY_REVIEW.md](SECURITY_REVIEW.md) | Code, database and user-confidentiality review (2026-10-06): what was found, what was fixed, what is still open |
| [ROADMAP.md](ROADMAP.md) · [PRAPANJI_SPEC.md](PRAPANJI_SPEC.md) | What's planned next for Prapanji, and the product spec it draws ideas from |
| [DB_ADMIN_QUERIES.md](DB_ADMIN_QUERIES.md) | SQL cookbook: make a user admin, grant Pro, deactivate, reset a password, delete test accounts, audit log, usage and issue-report queries |
| [CONFIGURATION_STATE.md](CONFIGURATION_STATE.md) | Dated change log (2026-10-03), configuration matrix of what is in the repo vs what must be confirmed in external accounts, known gaps |
| [USER_MANUAL.md](USER_MANUAL.md) | End-user guide to every screen, plus a section for staff accounts |
| [USER_WORKFLOWS.md](USER_WORKFLOWS.md) | One flow diagram per screen (25 total, Mermaid) — almost no prose; renders on GitHub |
| [USER_DISTRIBUTION.md](USER_DISTRIBUTION.md) | How to get the app and manual to end users — web first, Android APK / Play / TestFlight later — with onboarding message and rollout plan |
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
| Session | Short-lived JWT access token + rotated refresh token. Native: both in the OS keychain/keystore via `expo-secure-store` (`utils/tokenStorage.ts`, migrating any tokens older builds left in AsyncStorage). Web: refresh token only in an httpOnly cookie, access token only in memory (`utils/tokenStorage.web.ts`) — nothing in `localStorage` |
| Icons | `@expo/vector-icons` (Ionicons) |
| Charts | `react-native-chart-kit` (line + pie, Reports tab) |
| File export | `expo-file-system` + `expo-sharing` (native), Blob download (web) — CSV text now comes straight from the server (`GET /reports/export.csv`) |
| Alerts/confirms | Custom `utils/alert.ts` / `.web.ts` — see "Known deviations" |
| State management | React Context (`AuthContext`) |
| Web support | react-native-web, react-dom |
| Image picking | `expo-image-picker` — Report issue screenshots (photo library only; camera and microphone permissions disabled in `app.json`) |
| Client testing | Jest + `jest-expo`, `@types/jest` |
| **Server** | Node.js + Express 4 + TypeScript (`server/`) |
| **Server ORM** | Drizzle ORM + drizzle-kit (schema in `server/src/db/schema.ts`, migrations in `server/drizzle/`) |
| **Database** | PostgreSQL 16, via Docker (host port 5433 — see note below) |
| **Auth** | bcrypt (password hashing, cost 12) + jsonwebtoken (15-min access token, 30-day rotated refresh token, hashed at rest) |
| **Server validation** | zod (request body/query validation) |
| **Security headers** | helmet (API) + nginx CSP / frame-deny / no-referrer (web app) |
| **Email** | nodemailer over SMTP — account emails and the nightly issue digest |
| **Server testing** | Jest + Supertest, against a real Postgres instance — the database is never mocked; only the SMTP connection is |
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

Every table is scoped by `user_id`, enforced **server-side** in the `requireAuth` middleware plus a `WHERE user_id = req.userId` on every query — never trusted from the client. Since migration 0016 the database also refuses to link one user's rows to another's (a goal contribution must belong to its goal's owner; a transaction, repeating entry or budget can only use a system category or the user's own) — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md). This closes the class of bug found earlier in the local build (see [PRO_FEATURES_DESIGN.md](PRO_FEATURES_DESIGN.md) §C1) properly, at the source of truth instead of an app-level convention.

Postgres runs in Docker, mapped to **host port 5433, not 5432** — this dev machine already has a native Windows PostgreSQL service occupying 5432. Container-to-container traffic (the `server` service talking to `postgres`) is unaffected, still port 5432 on the internal Docker network.

### Known deviations from the spec
- **Budget class is now server-computed**, as originally spec'd — `recomputeBudgetClass` runs on every `POST /transactions` and is reflected via `GET /auth/me`, using the same `classifyLocal` from the shared calculations module fed by a real Drizzle query. The old client-side placeholder is gone.
- **No OTP / phone login** — email + password only (OTP requires an SMS backend that doesn't exist here).
- **No cloud sync conflict-resolution or Enterprise API** — out of scope for this build so far. Staff screens exist (User management, Audit log, System metrics — see the feature list).
- **Pro features are on for every account.** Migration 0013 set every existing account to `tier = 'pro'` and made `'pro'` the default for new ones; there's no payment processor. The old "Try Pro" self-service switch (`PATCH /auth/me/tier`) still exists for development but is off in production unless `ALLOW_SELF_TIER_CHANGE=true`; admins can still change a tier from User management.
- **`Alert.alert` doesn't work on web** — `react-native-web`'s implementation is a literal no-op (`static alert() {}`), which silently broke every delete-confirmation and save dialog on web until fixed. Replaced with a platform-split helper (`utils/alert.ts` uses the real native `Alert`; `utils/alert.web.ts` uses `window.confirm`/`window.alert`). Worth remembering if you add a new confirm dialog — always go through `utils/alert`, never `Alert` from `react-native` directly.

---

## 3. Feature list

**Core features**
- **Auth** — register with name, email, Indian mobile number (stored as +91…, one account per number) and password (8–72 characters); sign in with email + password; server-side bcrypt + JWT session, no guest mode
- **Your account** (gear icon on the Dashboard → Settings) — email confirmation (link emailed on sign-up, resend from Settings, a reminder banner on the Dashboard until confirmed), forgotten-password reset by emailed link ("Forgot password?" on the login screen), change password (signs out other devices), sign out everywhere, download all your data as JSON, and delete your account (password required) — see API_REFERENCE "Your account"
- **Budgets** (Dashboard → Budgets) — a monthly limit per expense category with a progress bar for this month; anything at 80%+ shows as a "Budget alerts" card on the Dashboard (yellow at 80%, red when over)
- **Accounts** (Dashboard → Accounts) — bank, cash, wallet/UPI and credit-card balances you type in; they count toward net worth (card dues subtract)
- **Dashboard** — income/expense/net savings for the current month (‹ › arrows step back to earlier months), top-5 expense categories, budget-class badge, Expense/Loan/Investment breakdown
- **Input expenses** — bulk entry screen: pick Monthly/Quarterly/Yearly, add one row per category+amount, save all at once (mirrors the original Excel workflow)
- **Transactions** — add/edit/delete, income or expense, all 50+ categories from the source Excel data, a date for every entry (Today by default, or Yesterday / any past date via the date control; future dates are rejected; editing can change it too), and a Once/Monthly/Quarterly/Yearly period on new entries (Once logs the exact amount on the chosen date; Quarterly/Yearly are converted to a monthly-equivalent amount, same as Input Expenses), and a "Repeat" switch for salary, rent, insurance or any fixed amount (income or expense) — monthly, quarterly or yearly, added again on the same day of the month (29–31 fall back to the month's end) until stopped from the "Repeating" button (change the amount, how often or the day, or stop it). Search (notes, category names, amounts) and the All/Expenses/Income filter run on the server, and the list loads 50 at a time as you scroll — tap a row to edit it, tap the trash icon to delete it
- **People** (Dashboard → People button, `/people`) — **Split a bill** (a simple page: how much, what for, who shared it; equal or changed amounts; only your own share counts as spending) and **Lent or borrowed**: a per-person running ledger with part payments, due dates and an Overdue flag, write-off, and per-line undo. Not counted as spending (`/api/v1/people`, `POST /transactions/split-people`)
- **Quick add** (orange + on the Dashboard) — amount keypad, your most-used category chips, Save; logs for today
- **Free-money day** (Dashboard card → `/free-money-day`) — the day of the month by which income has covered every EMI and repeating bill, with a week-on-week change and a "what if I prepay a loan" preview (`GET /reports/free-money-day`)
- **Custom categories** — add, rename, and delete your own category (name + income/expense) from any category picker, with a search box to find items once the list grows — see §3a
- **Loans** — add/edit/delete, track principal/outstanding/EMI/interest rate plus optional loan type, lender, tenure, start date and note. A per-loan "Add monthly EMI to expenses" toggle (on by default) posts the EMI to expenses every month as a `Loan EMI` transaction **and pays the balance down by that month's principal** (interest worked out from the rate), so the balance stays right without any tapping; each card shows the next EMI's interest/principal split and the months left at the current rate — see API_REFERENCE "Automatic monthly EMI expenses and pay-down". Loans not counted as expenses (e.g. family loans) keep a "Mark EMI paid" button instead. Either way the outstanding debt shows under Reports → Liabilities and in net worth. "Part payment" button (prepayment): lowers the outstanding balance and scales the EMI down proportionally so the remaining tenure is unchanged, with a live before/after preview — tap a card to edit any field, trash icon to delete
- **Investments** — add/edit/delete, invested vs. current value, auto-computed gain % (recomputed server-side on every edit), portfolio summary — tap a card to edit, trash icon to delete
- **Goals** — add/edit/delete, contribute funds, progress bar toward target — tap a card to edit name/target, trash icon to delete
- **Report issue** (bug icon on the Dashboard, every signed-in user) — category, where it happened, severity, title, description, steps, expected behaviour, optional screenshot (PNG/JPEG/WebP, max 2 MB); app version and device are attached automatically; earlier reports and their status are listed underneath — see "Report issue & nightly digest" below
- **Legal pages** — Terms (`app/legal/terms.tsx`) and Privacy policy (`app/legal/privacy.tsx`), linked from sign-up. Both are **draft placeholders** until reviewed before launch — see [SECURITY_REVIEW.md](SECURITY_REVIEW.md)

**Pro features (on for every account — see "Known deviations")**
- **Reports tab** — time-range picker (month/3mo/6mo/year/all-time), income/expense/net trend chart, category donut, debt payoff progress, goal progress, CSV export
- **Debt payoff planner** (Loans tab) — snowball or avalanche strategy, month-by-month payoff simulation with EMI-rolling, "what if I add ₹X/mo"
- **Goal ETA** (Goals tab) — projected completion date from your trailing 3-month savings rate
- **Spending insights** (Dashboard) — month-over-month category deltas, savings rate
- **Net worth tracking** — computed live (investments + goal savings + account balances − loan outstanding − credit-card dues) and snapshotted monthly for trending in Reports

**Staff (role: 'admin' accounts only, unless noted)**
- **User management** (`/admin`, shield icon on the Dashboard; admin and support) — searchable by name or email; unconfirmed emails are tagged — list every account (name, email, role, tier, active status, budget class, join date), without visibility into anyone's financial data
- **Access control** — activate/deactivate any account (deactivated accounts are rejected at login, and mid-session within one refresh cycle — see §3a), promote/demote between `user`/`admin`/`support`/`system_manager`, override tier
- **Account deletion** — permanently remove an account and everything it owns (cascading delete)
- An admin can never modify or delete their own account through this screen (self-lockout is structurally impossible, not just guarded) — use your own login to change your own settings
- **Support role** — opens the same User management screen, which shows only the Active switch, and only for regular users; the server enforces the same rules (a `PATCH` with `role` or `tier`, or one aimed at another staff account, is rejected with 403). Can't delete accounts.
- **System manager role** — the shield icon opens **System metrics** (`app/admin/metrics.tsx`, also reachable by admins from User management) backed by `GET /api/v1/system/metrics` only (user counts, active/inactive split, signup and login activity, aggregate usage counts, a cost/revenue estimate at ₹100/user/year). Never reaches the per-account list or any account action.
- **Admin audit log** (`app/admin/audit-log.tsx`, document icon on User management) — every `PATCH`/`DELETE` on an account is recorded (actor, target, what changed); the latest 100 are listed, admin-only.
- **Issue triage** (API only, no screen yet) — admin and support can list every issue report and set its status (`GET`/`PATCH /api/v1/issues`); **only admins** can open a report's screenshot, since it shows the user's own balances.

---

## 3a. Custom categories & access control — how they actually work

**Custom categories.** Every category is a row in the server's `categories` table. System categories (seeded from `constants/categories.ts`, `user_id NULL`) are shared by everyone and can't be deleted or renamed. `POST /api/v1/categories { name, type }` creates a new one owned by the caller (`group: 'Custom'`, a rotating icon/color, a generated `custom_xxxxxxxx` key) — `GET /api/v1/categories` returns system categories plus only the caller's own, and the `CategoryPicker` component's search box filters that combined list client-side once it grows. `PATCH /api/v1/categories/:key { name }` renames the caller's own custom category (the `key` never changes, so nothing referencing it breaks). `DELETE /api/v1/categories/:key` is rejected with 403 for a system category, 404 for another user's custom category (existence isn't leaked), and 409 if it's still referenced by one of the user's own transactions (the database's foreign key is what actually enforces this — the route just turns the constraint violation into a friendly message). `POST /transactions` independently re-validates that a submitted category is a system category or belongs to the caller, so a guessed/leaked custom category key from another account can't be used to log a transaction against it — and since migration 0016 a database trigger enforces the same rule for transactions, repeating entries and budgets, whatever code path writes them.

**Access control.** `users.role` (`'user' | 'admin' | 'support' | 'system_manager'`) and `users.isActive` gate everything:
- `POST /api/v1/auth/login` rejects a correct password with 403 if `isActive` is false (checked only after the password is verified, so it can't be used to enumerate accounts). An unknown email runs the same bcrypt comparison as a wrong password (against a dummy hash), so neither the message nor the response time reveals which emails are registered. A successful login (and register) also stamps `lastLoginAt`.
- `POST /api/v1/auth/refresh` re-checks `isActive` on every refresh and revokes the refresh token if the account has since been deactivated — a deactivated user's session dies within one access-token lifetime (15 min), even if they were already logged in.
- `GET`/`PATCH /api/v1/admin/users/*` require `requireAuth` then `requireStaff` (`server/src/middleware/requireStaff.ts`, `'admin' | 'support'`); `DELETE` requires `requireAdmin` (`server/src/middleware/requireAdmin.ts`, `'admin'` only). `GET /api/v1/system/metrics` requires `requireSystemManager` (`'admin' | 'system_manager'`) instead. `requireAuth` itself looks the caller up fresh from the database on every request (exists, active, role, and not signed out everywhere since the token was issued) rather than trusting a JWT claim, so a demotion, deactivation or password change takes effect on the very next request instead of waiting for token expiry.
- Every admin route refuses to act on the caller's own account (`id === req.userId` → 400) — since the acting admin is therefore always still a valid active admin after any operation the endpoint allows, there's no separate "don't demote the last admin" check needed; self-modification being blocked already makes that scenario unreachable.
- `isActive: false` also stamps `deactivatedAt` (cleared on reactivation) — kept separate from `updatedAt`, which every field change touches, so "inactive since when" stays answerable.
- Every `PATCH`/`DELETE` on an account writes a row to `admin_audit_log` (actor, target, which fields changed) — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) and [API_REFERENCE.md](API_REFERENCE.md#admin-audit-log--apiv1adminaudit-log-).

## 3b. Report issue & nightly digest

**Submitting.** `app/report-issue.tsx` (bug icon on the Dashboard) posts to `POST /api/v1/issues`. The allowed categories, severities and screens live in `constants/issues.ts`, shared by client and server. The screenshot is picked with `expo-image-picker` (photo-library permission only — camera and microphone are disabled in `app.json`), checked against 2 MB on the device, then sent base64-encoded; the server decodes it, enforces 2 MB again, sniffs the real image type from its first bytes, and stores it in `issue_reports.screenshot` (bytea). Reports are a separate table — see [DATABASE_DESIGN.md](DATABASE_DESIGN.md).

**Privacy of reports** (`server/src/lib/issuePrivacy.ts`). A screenshot of this app shows the user's own balances, and staff are otherwise kept away from users' financial data, so:
- Only the reporter and **admins** can open a screenshot (`GET /api/v1/issues/:id/screenshot`); support accounts get 404.
- By default the digest email names the reporter as `user #<id>` (not their email) and does **not** attach screenshots. Each can be turned on: `ISSUE_DIGEST_SHOW_REPORTER=true`, `ISSUE_DIGEST_ATTACH_SCREENSHOTS=true`.
- **Reports never go to an outside service.** Fix suggestions are worked out by the server's own rules; there is no AI or other third-party processing (`issueSuggestions.test.ts` fails if an AI SDK is added to the server).
- **Retention:** a screenshot is deleted `ISSUE_SCREENSHOT_RETENTION_DAYS` (default 90) after its report is resolved or closed; the report text stays. This runs every night whether or not the digest email is switched on.
- A user's reports are included in "Download all your data" (`GET /auth/me/export`), and deleted with their account.
- Users are told who sees their report: a notice above the screenshot button on the Report issue screen, a line under the form linking to the privacy policy, and a "Problem reports" section in `app/legal/privacy.tsx`. If you change any of the defaults above, update those texts too.

**Nightly job** (`server/src/jobs/issueDigest.ts`, run by the in-process scheduler in `jobs/scheduler.ts`):
1. **Stack analysis first** (`server/src/lib/issueAnalysis.ts`) over every report from the last 180 days plus anything still un-emailed: totals and week-over-week trend; breakdowns by category/severity/screen/platform/app version; hotspot screens (most open, severe reports); duplicate clusters (word-overlap similarity, boosted by same screen or a shared error signature); recurring error signatures (`TypeError…`, `HTTP 500`, timeouts, `NaN`); new app versions that already have several reports. Each report gets a P1–P4 priority from severity, category, how many similar reports exist, hotspot and regression signals.
2. **Check new issues** — the not-yet-emailed ones, highest priority first (max `ISSUE_DIGEST_MAX`, default 25).
3. **Fix suggestion** per issue, worked out by the server's own rules (`lib/issueSuggestions.ts` → `heuristicSuggestion` in `lib/issueAnalysis.ts`): the screen's client and server files to check, hints from keywords in the report (sign-in, CSV, dates, EMIs, repeating entries, categories, charts), error signatures to search the logs for, and which similar reports probably share the cause. No outside service is involved.
4. **Email** to `ISSUE_DIGEST_TO` (or every active admin if unset) via SMTP: the stack summary, then each issue with its suggestion (screenshot inline only if opted in). Without SMTP the job logs only the subject line — never report text — and leaves the reports pending. Reports are marked `notified_at` only after SMTP accepts the message, so a failed send is retried the next night — reusing the stored suggestion rather than paying for it again. A Postgres advisory lock keeps it to one send even with several server replicas.

**Turning it on** — in the `.env` next to `docker-compose.yml`: `ISSUE_DIGEST_ENABLED=true`, `ISSUE_DIGEST_TO=<your email>`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (Gmail needs an App Password), `ISSUE_DIGEST_TIME` (default `02:00`) and `TZ` (default `Asia/Kolkata`). Then `docker compose up -d --build server`. All variables are listed in `server/.env.example`.

**By hand:**
- `docker compose exec server npm run issues:analyze` — print the stack analysis (`-- --json` for the full report)
- `docker compose exec server npm run issues:digest -- --dry-run` — analyse and print the email that would be sent; no email, nothing written
- `docker compose exec server npm run issues:digest` — run the real digest now

---

## 4. Functionality flows

**Auth flow**
```
app launch → check secure storage for a token pair (web: always try — the refresh cookie is invisible to JS)
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

## 5. Pages / screens (25 total)

| # | Screen | File | Notes |
|---|---|---|---|
| 1 | Login | `app/login.tsx` | Email + password |
| 2 | Register | `app/register.tsx` | Name, email, mobile number, password |
| 3 | Input expenses | `app/input-expenses.tsx` | Modal stack screen, reached from Dashboard |
| 4 | Dashboard | `app/(tabs)/index.tsx` | Tab 1 |
| 5 | Transactions | `app/(tabs)/transactions.tsx` | Tab 2 |
| 6 | Loans | `app/(tabs)/loans.tsx` | Tab 3 |
| 7 | Investments | `app/(tabs)/investments.tsx` | Tab 4 |
| 8 | Goals | `app/(tabs)/goals.tsx` | Tab 5 |
| 9 | Reports | `app/(tabs)/reports.tsx` | Tab 6, Pro-gated |
| 10 | Admin — Users | `app/admin/index.tsx` | Modal stack screen, reached from the Dashboard's shield icon (admin; support with Active switch only) |
| 11 | Admin — Audit log | `app/admin/audit-log.tsx` | From User management (admin only) |
| 12 | System metrics | `app/admin/metrics.tsx` | Shield icon for system managers; from User management for admins |
| 13 | Settings | `app/settings.tsx` | Gear icon on the Dashboard — email confirmation, password, data export, sign out everywhere, delete account |
| 14 | Budgets | `app/budgets.tsx` | Dashboard → Budgets |
| 15 | Accounts | `app/accounts.tsx` | Dashboard → Accounts |
| 16 | Forgot password | `app/forgot-password.tsx` | "Forgot password?" on Login |
| 17 | Reset password | `app/reset-password.tsx` | Opened from the emailed link (`?token=…`) |
| 18 | Confirm email | `app/verify-email.tsx` | Opened from the emailed link (`?token=…`) |
| 19 | Free-money day | `app/free-money-day.tsx` | From the Dashboard's free-money card; breakdown of EMIs and repeating bills, plus the "what if I prepay a loan" preview |
| 20 | Report an issue | `app/report-issue.tsx` | Modal, bug icon on the Dashboard; every signed-in user |
| 21 | Terms | `app/legal/terms.tsx` | Linked from Register; draft placeholder |
| 22 | Privacy policy | `app/legal/privacy.tsx` | Linked from Register; draft placeholder |
| 23 | People | `app/people/index.tsx` | From the Dashboard's People button; the list with filters, and two buttons: Split a bill, Lent or borrowed |
| 24 | Person | `app/people/[id].tsx` | One person's balance, history and actions (They paid, Lend or borrow, Due date, Write off) |
| 25 | Split a bill | `app/people/split.tsx` | From People; four plain questions and one Save button |

`app/index.tsx` is a redirect (session check → `/login` or `/(tabs)`), not a user-facing page, so it's not counted above.

---

## 6. Testing & quality

**Client** (repo root):
```bash
npm test              # run once — 109 tests (utils/calculations.ts, utils/dates.ts, utils/issues.ts, theme)
npm run test:watch    # watch mode
npm run test:coverage # with coverage report
npm run typecheck     # tsc --noEmit
npm run quality       # typecheck + coverage — the single gate to run before any build
```

Coverage is measured over `utils/calculations.ts`, `utils/dates.ts` and `utils/issues.ts` (100% of lines in all three, 97% of branches overall) and enforced per file by thresholds in `package.json` — `npm run quality` fails if one drops. The root Jest config excludes `server/` (`testPathIgnorePatterns`), since the server has its own Jest config and needs a live Postgres connection.

**Server** (`server/`):
```bash
npm run typecheck     # tsc --noEmit
npm test               # 386 tests in 31 files — one per resource (auth, account,
                        # categories, transactions, recurring, loans, goals,
                        # investments, budgets/accounts, reports, net worth,
                        # admin, issues …), security, DB-integrity, mail and
                        # middleware units, and one full e2e lifecycle test
npm run test:coverage  # same, plus a coverage report + enforced floor (see below)
npm run quality        # typecheck && test
```

The server suite runs against a **real Postgres instance** via Supertest (no mocking) — `docker compose up -d postgres` (or the existing native/Docker Postgres on `DATABASE_URL`) must be reachable first, and migrations/seed data applied (`npm run db:migrate && npm run db:seed`). Every resource file checks cross-user data isolation (a second account can never read/modify/delete the first account's rows) and unauthenticated access (401 without a token); `e2e.test.ts` walks a full lifecycle (register → add data across all resource types → verify server-computed budget class → verify reports/debt-payoff/net-worth/CSV export → tier toggle → logout invalidates the refresh token but not the still-live access token).

**Every route documented in [API_REFERENCE.md](API_REFERENCE.md) has direct test coverage.** `server/jest.config.js` collects coverage over `src/routes/`, `src/middleware/`, `src/lib/` and `src/jobs/` (except the `run-*.ts` CLI wrappers) with a floor of 80% branches and 90% functions/lines/statements; as of 2026-10-06 it measures 88% branches, 98% statements. `npm run test:coverage` fails if the floor isn't met. **Note:** the server's `npm run quality` — what CI and the pre-commit hook run — currently calls `npm test`, not `test:coverage`, so the server floor is *not* enforced automatically yet (see [SECURITY_REVIEW.md](SECURITY_REVIEW.md) open items). The handful of intentionally-uncovered lines are defensive fallbacks that zod validation already makes unreachable (documented inline in the route files) — not gaps.

**Not covered by automated tests:** screen components and `AuthContext` — verified instead by a real click-through in the browser against the live Docker stack (register, login, bulk "Input expenses" entry, add/delete across every tab, Reports charts, CSV export, admin user management). See [architecture-flows.html](architecture-flows.html) for the coverage map and debt-payoff simulation flowchart (client-side testing architecture, still accurate).

### Enforcement — tests run automatically before every commit

A git pre-commit hook (Husky — `.husky/pre-commit`, wired up via the root `package.json`'s `prepare` script, so it's installed automatically on `npm install`) runs the quality gate on every `git commit`:

1. **Client**: `npm run quality` (typecheck + the full client test suite) — always.
2. **Server**: `cd server && npm run quality` (typecheck + the full server test suite) — **only if the commit touches anything under `server/`**, so a client-only commit doesn't require Postgres to be running. If it does run and can't reach Postgres, the hook fails with a reminder to `docker compose up -d postgres` rather than silently skipping.

A commit is blocked if either gate fails. The same gates run again in GitHub Actions (`.github/workflows/ci.yml`) on every push and pull request — there the server job first applies every migration to an empty database — and `deploy.yml` handles production deploys (see [DEPLOYMENT_DIGITALOCEAN.md](DEPLOYMENT_DIGITALOCEAN.md)).

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
| Regular user | `user@mybudget.local` | `User@12345` |

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
