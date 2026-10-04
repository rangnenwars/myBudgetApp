# System Architecture Guide — How It Works and Which File Changes What

For anyone who has to modify, debug or operate My Budget. The deeper per-topic docs are linked where relevant: [README.md](README.md) (features, screens, testing), [API_REFERENCE.md](API_REFERENCE.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [INFRASTRUCTURE_REFERENCE.md](INFRASTRUCTURE_REFERENCE.md).

---

## 1. The big picture

```
 Browser / phone                    DigitalOcean Droplet (docker compose, project "mybudget")
 ───────────────                    ──────────────────────────────────────────────────────────
 Expo app (React Native             caddy ─ TLS (Let's Encrypt), routing, security headers
 + react-native-web)                 ├─ /api/*, /health ─▶ server (Express, :4000)
   │  https://prapanji.in            │                         │  Drizzle ORM
   └──────────────────────────────▶  └─ everything else ─▶ web (nginx, static SPA, :80)
                                                              ▼
                                     postgres 16 (:5432, internal only) ── volume pgdata
```

* **One origin.** The web app and the API are both served from `https://prapanji.in`; the API lives under `/api/v1`. No CORS dance for the browser, one certificate.
* **Online-only app.** Every screen calls the API. There is no on-device database and no sync engine; the only thing stored on the device is the login token pair.
* **One Docker stack, four containers**, defined in `deploy/docker-compose.prod.yml` (production) or the root `docker-compose.yml` (local; three containers, no Caddy).
* **CI/CD** (GitHub Actions): merge to `main` → tests → build two images tagged with the commit SHA → push to GHCR → approval → SSH to the Droplet → pull + `up -d` → smoke test → auto-rollback on failure. The manual equivalent is in [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md).

---

## 2. Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Client framework | **Expo SDK 57**, React Native 0.86, React 19, TypeScript | Read the versioned docs (docs.expo.dev/versions/v57.0.0) before client changes — `AGENTS.md` makes this a project rule |
| Routing | `expo-router` (file-based) | each file in `app/` is a screen/route |
| Web build | `npx expo export --platform web` → static files → **nginx** | `Dockerfile` (root) |
| HTTP client | axios wrapper in `utils/api.ts` | attaches the JWT, silently refreshes on 401 |
| Shared logic | `utils/calculations.ts` (pure functions) | imported by **both** client and server (server re-exports it) |
| Server | Node 22, **Express 4**, TypeScript run with `tsx` | `server/` |
| Validation | `zod` | request bodies/queries in each route file |
| ORM / migrations | **Drizzle** + drizzle-kit | schema `server/src/db/schema.ts`, SQL in `server/drizzle/` |
| Database | **PostgreSQL 16** | |
| Auth | `bcrypt` (cost 12) · JWT access token (15 min) · rotated refresh token (30 days, stored hashed) | web keeps the refresh token in an httpOnly cookie; native keeps both in the OS keystore |
| E-mail | `nodemailer` over SMTP | password reset, e-mail confirmation, nightly issue digest |
| AI (optional) | `@anthropic-ai/sdk` | fix suggestions in the nightly issue digest only; rule-based fallback if no key |
| Security middleware | `helmet`, `cors`, `express-rate-limit` | `server/src/app.ts` |
| Reverse proxy / TLS | **Caddy 2** | `deploy/Caddyfile` |
| Tests | Jest (+ Supertest against a real Postgres for the server) | pre-commit hook (Husky) and CI run them |
| CI/CD | GitHub Actions, GHCR | `.github/workflows/ci.yml`, `deploy.yml` |

---

## 3. How a request flows

```
Screen (app/*.tsx)
  → utils/database.ts      typed CRUD helpers, one per API call
    → utils/api.ts         axios: base URL = EXPO_PUBLIC_API_URL, Bearer token, refresh-on-401
      → Caddy → server/src/app.ts
          middleware: helmet · cors · rate-limit · JSON body parser
          routes/*.ts            zod-validate the input
            middleware/auth.ts          requireAuth: verify JWT, reject tokens older than users.tokens_valid_after
            middleware/requireAdmin|requireStaff|requireSystemManager   role looked up fresh from the DB each request
            lib/queries.ts, lib/*.ts    Drizzle queries — always `WHERE user_id = req.userId`
            calculations.ts             shared pure math (summaries, net worth, debt payoff, CSV)
          → PostgreSQL
```

Key invariants (don't break them):

1. **Tenant isolation is server-side**: every query on a user-owned table filters by `req.userId`. The client is never trusted for a user id.
2. **Roles are read from the database on every request**, not from the JWT, so a demotion or deactivation takes effect immediately.
3. **Admin routes never touch financial data** — account metadata only; every account change writes `admin_audit_log`.
4. **Persisted derived values are computed on the server** (investment `returns_percent`, `users.budget_class`, net-worth snapshots).
5. **Never use `Alert` from `react-native` directly** — go through `utils/alert` (the native one is a no-op on web).

### Roles

| `users.role` | Can do | Enforced in |
|---|---|---|
| `user` | own data only | `requireAuth` |
| `support` | list accounts; activate/deactivate **regular users** only | `requireStaff` + checks in `routes/admin.ts` |
| `system_manager` | read-only aggregate metrics (`/api/v1/system/metrics`); no per-account access | `requireSystemManager` |
| `admin` | everything above + change role/tier, delete accounts, view audit log | `requireAdmin` |

Nobody can modify or delete **their own** account through the admin API (400), so an admin can never lock themselves out. There is **no API that creates the first admin** — see [DB_ADMIN_QUERIES.md §2](DB_ADMIN_QUERIES.md#2-make-a-user-admin-support-or-system-manager).

Tier (`standard` / `pro`) gates the Reports tab, debt-payoff planner, goal ETA, insights and net-worth trending. There is no payment processor; in production users cannot flip themselves to Pro (`ALLOW_SELF_TIER_CHANGE` off) — an admin sets it.

### Background work

* **Recurring entries and loan EMIs** are posted lazily — a "due" check runs before transactions/reports requests (`server/src/lib/autoPost.ts`, `recurringTransactions.ts`, `loanEmiExpenses.ts`), not by a cron. Which calendar day counts as "today" follows `APP_TIMEZONE` (default `Asia/Kolkata`).
* **Nightly issue digest** — `server/src/jobs/scheduler.ts` (in-process timer) runs `jobs/issueDigest.ts` when `ISSUE_DIGEST_ENABLED=true`: analyse the `issue_reports`, suggest fixes, e-mail admins. A Postgres advisory lock prevents double sends.
* **Server start** (`server/docker-entrypoint.sh`): migrate → seed categories → (demo accounts, local only) → start API.

---

## 4. Repository map

```
app/                  screens (expo-router)             ← client UI
  (tabs)/             Dashboard, Transactions, Loans, Investments, Goals, Reports
  admin/              Users, Audit log, System metrics  ← staff screens
  login · register · forgot-password · reset-password · verify-email
  settings · budgets · accounts · input-expenses · report-issue
components/           shared UI (Card, CategoryPicker, ProGate, BudgetClassBadge, MiniBar, ResponsiveContainer)
constants/            categories.ts (system categories), theme.ts (colours/spacing), issues.ts (report-issue options)
context/              AuthContext (session + role), CategoriesContext
utils/                api.ts · database.ts · calculations.ts · dates.ts · types.ts · alert* · exportFile* · tokenStorage*
server/
  src/app.ts          Express app: middleware order, route mounting, /health
  src/index.ts        process start; production safety checks
  src/routes/         one file per resource (auth, account, admin, adminAuditLog, system, transactions, recurring,
                      loans, investments, goals, accounts, budgets, categories, netWorth, reports, issues)
  src/middleware/     auth, rateLimit, requireAdmin, requireStaff, requireSystemManager, errorHandler
  src/lib/            queries, tokens, session, cookies, errors, auditLog, accountMail + mailer, autoPost / recurringTransactions / loanEmiExpenses, issueAnalysis + issueSuggestions
  src/jobs/           scheduler + nightly issue digest
  src/db/             schema.ts, client.ts, migrate.ts, seed-categories.ts, seed-accounts.ts, create-admin.ts
  drizzle/            generated SQL migrations (0000 … 0011)
  scripts/            backup-db.sh / .bat
  docker-entrypoint.sh, Dockerfile, .env.example
deploy/               docker-compose.prod.yml, Caddyfile, remote-deploy.sh   ← production stack
.github/workflows/    ci.yml, deploy.yml ; dependabot.yml
Dockerfile · nginx.conf · docker-compose.yml   ← web image + nginx + LOCAL stack
app.json · eas.json                              ← Expo app identity and EAS build profiles
docs/                 all documentation
scripts/              verify.sh, docker-verify.sh, get-token.sh
```

---

## 5. "I want to change X" — which file(s)

### Product behaviour

| Change | Edit | Then |
|---|---|---|
| Add/rename a **system category** | `constants/categories.ts` | redeploy — the server re-seeds categories at every start (idempotent) |
| A **screen's layout/text** | the file in `app/` (tabs in `app/(tabs)/`) | `npm run quality`; rebuild web image |
| Colours, spacing, theme | `constants/theme.ts` | |
| Money math, summaries, debt payoff, budget class | `utils/calculations.ts` (shared) + its tests in `utils/__tests__/` | both client and server pick it up; 100 % function coverage is enforced |
| Add a **field to a record** | `server/src/db/schema.ts` → `cd server && npm run db:generate` (creates the SQL in `server/drizzle/`) → route zod schema in `server/src/routes/<resource>.ts` → `utils/types.ts` + `utils/database.ts` → screen → `docs/DATABASE_DESIGN.md` + `docs/API_REFERENCE.md` → tests | migrations are applied automatically on deploy; keep them **backward compatible** (add first, remove in a later release) |
| Add an **API endpoint** | new/changed `server/src/routes/<resource>.ts`, mounted in `server/src/app.ts`; test in `server/src/__tests__/`; document in `docs/API_REFERENCE.md` | coverage floor (80 % branch / 90 % others) fails the build if untested |
| Report-issue options (categories/severities/screens) | `constants/issues.ts` (shared by client and server) | |
| Password rules, token lifetimes | `server/src/routes/auth.ts`, `server/src/lib/tokens.ts` | |
| Rate limits | `server/src/middleware/rateLimit.ts` (applied in `routes/auth.ts` / `routes/account.ts`) | |
| E-mail wording / SMTP handling | `server/src/lib/accountMail.ts` (account e-mails), `server/src/lib/mailer.ts` (transport); SMTP values in `/opt/mybudget/.env` | |
| Nightly digest behaviour | `server/src/jobs/issueDigest.ts`, `server/src/lib/issueAnalysis.ts`, `server/src/lib/issueSuggestions.ts`; enable via env vars | |
| Recurring entries / loan EMI auto-posting | `server/src/lib/recurringTransactions.ts`, `server/src/lib/loanEmiExpenses.ts`, `server/src/lib/autoPost.ts` | |
| Audit-log entries | `server/src/lib/auditLog.ts` | |

### Access and roles

| Change | Edit |
|---|---|
| What each role may do | `server/src/middleware/require*.ts` and the role checks in `server/src/routes/admin.ts`, `system.ts` |
| Add a new role | CHECK constraint in `schema.ts` (`users_role_check`) + a migration, middleware, `AuthContext`, admin screen picker, docs |
| Hide/show admin UI | `app/admin/*.tsx`, dashboard icons in `app/(tabs)/index.tsx`, `context/AuthContext.tsx` (`isAdmin`, etc.) |
| Make someone admin / grant Pro / deactivate | **no code change** — Admin screen, `create-admin.ts`, or SQL ([DB_ADMIN_QUERIES.md](DB_ADMIN_QUERIES.md)) |

### Deployment and infrastructure

| Change | Edit | Takes effect |
|---|---|---|
| Production **env vars** (CORS, TRUST_PROXY, SMTP, digest, timezone…) | `deploy/docker-compose.prod.yml` (`server.environment`) and/or `/opt/mybudget/.env` on the Droplet | CI copies the compose file on deploy; `.env` needs `dc up -d` |
| **Domain name** / TLS / routing / headers | `deploy/Caddyfile`; also `CORS_ORIGIN` + `APP_URL` in the prod compose; `PUBLIC_API_URL` repo variable; DNS records | redeploy; the web image must be rebuilt because the API URL is baked in |
| **API URL baked into the web/mobile bundle** | build arg `EXPO_PUBLIC_API_URL` (`Dockerfile`, `deploy.yml` build job, `eas.json` env for mobile) | rebuild image/app |
| Web **CSP / cache / SPA fallback** | `nginx.conf` | rebuild web image |
| Image tags, pull, health wait, prune, history | `deploy/remote-deploy.sh` | next deploy |
| CI steps, approval gate, smoke test, rollback | `.github/workflows/deploy.yml`, `ci.yml` | on merge to `main` |
| Server image contents / start command | `server/Dockerfile`, `server/docker-entrypoint.sh` | rebuild server image |
| Local dev stack | root `docker-compose.yml` | `docker compose up -d --build mybudget-web server` |
| DB container settings / volume | `deploy/docker-compose.prod.yml` `postgres` service | careful — changing credentials after the volume exists does nothing; use `ALTER USER` |
| Backups | `server/scripts/backup-db.sh` + the Droplet's crontab | |
| Firewall | DigitalOcean console → Networking → Firewalls → `mybudget-prod-fw` (not in git) | immediate |
| Dependency updates | `.github/dependabot.yml` (weekly, grouped minor/patch) | |
| Mobile app name, bundle id, icons, permissions | `app.json`; build profiles `eas.json` | new store/APK build |

### Where to look when something is wrong

| Symptom | First file/command |
|---|---|
| API error text shown in the app | the route in `server/src/routes/`; `dc logs server` |
| Wrong number on a report | `utils/calculations.ts`, `server/src/routes/reports.ts` |
| Login/refresh problems | `server/src/routes/auth.ts`, `middleware/auth.ts`, `users.tokens_valid_after` |
| 403 for staff | role in DB (`SELECT role FROM users …`), the middleware used by that route |
| Migration failed on boot | `dc logs server`; `server/drizzle/*.sql`; `server/src/db/migrate.ts` |
| Page 404 on refresh | `nginx.conf` `try_files` fallback |
