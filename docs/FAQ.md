# FAQ

Answers to questions asked about the running system, kept here so they don't have to be re-asked. Add new ones to the bottom in the same Q/A format — don't let this drift from what's actually true; if an answer changes, update it in place rather than leaving a stale one alongside a new one.

---

### 1. How can I access the users list in the system?

Two ways, both admin-only (`role: 'admin'`):

- **In-app**: log in with an admin account → tap the shield icon next to the logout icon on the Dashboard → the **Admin → Users** screen (`app/admin/index.tsx`) lists every account: name, email, role, tier, active status, join date.
- **API**: `GET /api/v1/admin/users` with an admin's Bearer token. A non-admin token gets `403`; no token gets `401`. See [API_REFERENCE.md](API_REFERENCE.md#admin--apiv1adminusers-).

The list never includes anyone's financial data (transactions, loans, etc.) — account fields only.

---

### 2. Are we keeping the calculation at the server end only?

**No — one shared module, used by both sides**, not server-only. `utils/calculations.ts` is a single set of pure functions (money math, dates, debt-payoff simulation, category bucketing). The server doesn't reimplement any of it — `server/src/calculations.ts` is a one-line re-export of the exact same file. Both the client and the server import from it.

What *is* strictly server-computed and never trusted from the client, because it's persisted:
- Investment `returns_percent` (client sends `amount`/`current_value`; server derives the percentage)
- `users.budgetClass` (recomputed server-side on every `POST /transactions`, from the server's own trailing-3-month query)
- Any net worth snapshot (`POST /net-worth/snapshot` recomputes from the server's own current rows, ignoring anything the client might send)

What the client also computes locally, for on-screen display only (never written back as a source of truth): e.g. the Reports screen calls `computeNetWorth` directly on investments/goals/loans it already fetched, using the identical function the server uses. Same math, same module, just run twice for convenience — the server's copy is the one that gets persisted.

---

### 3. Where is the API list documented?

[API_REFERENCE.md](API_REFERENCE.md) — every endpoint across all 9 route files (auth, categories, transactions, loans, investments, goals, reports, net worth, admin): method, auth requirement, request/response shapes, every error case. For the literal wire format (full URL, port, exact headers, a real captured request/response body for each), see [API_REQUESTS.md](API_REQUESTS.md) instead.

---

### 4. Is the test/branch/function/loop coverage documented?

Statement, branch, function, and line coverage — yes, both documented and **enforced** (a build fails if it drops):

| | Threshold (min) | Currently achieving |
|---|---|---|
| **Client** (`utils/calculations.ts`, `package.json`) | 85% branch, 100% function, 90% lines/statements | 100% stmts, 98.41% branch, 100% functions, 100% lines |
| **Server** (`src/routes`, `src/middleware`, `src/lib`, `server/jest.config.js`) | 80% branch, 90% function/lines/statements | 99.41% stmts, 90.27% branch, 100% functions, 99.33% lines |

Documented in [README.md §6](README.md#6-testing--quality), [API_REFERENCE.md](API_REFERENCE.md#keeping-this-honest), and `architecture-flows.html` §C/D.

**"Loop coverage" specifically doesn't exist as a separate metric** in this stack — Jest's coverage is powered by Istanbul, which only tracks statements, branches, functions, and lines; there's no JS/TS tooling that reports loops as their own category. A loop's body is counted under statement/line coverage and its condition under branch coverage, so loops *are* exercised by the numbers above — just not broken out separately, because nothing in the ecosystem does that.

---

### 5. Where can I find the tech stack used?

[README.md §1 "Tech stack"](README.md#1-tech-stack) — full table, client and server layers.

---

### 6. Is this framework scalable?

Reasonably, for a small-to-medium multi-user deployment, without changes. Three things work in its favor already:
- **Stateless API auth** — JWT access tokens, no server-side session store beyond the `refresh_tokens` table, so multiple server instances could sit behind a load balancer with no sticky-session requirement.
- **Real relational schema** — proper foreign keys, and indexes on every hot query path (`(user_id, year, month)` on transactions, etc.), not an afterthought bolted onto free-text data.
- **Clean separation** — client, server, and database are three independent, replaceable pieces (see question 8), not a monolith.

What's *not* in place yet, and would matter before pushing this toward genuinely high concurrency: a connection pooler in front of Postgres (PgBouncer or similar — right now each server instance opens its own `pg.Pool`), a caching layer (Redis or similar — every request hits Postgres directly), rate limiting, and horizontal auto-scaling config. None of that is architecturally blocked — it's just not built, because nothing about this project's actual use so far has needed it. **It has never been load- or stress-tested.** Treat "scalable" here as "the design doesn't fight you if you need to scale it later," not "already proven at scale."

---

### 7. What is the minimum server hardware requirement to deploy this system?

An estimate, not a benchmarked number — this has never been load-tested:

| Use case | CPU | RAM | Disk |
|---|---|---|---|
| Personal / testing (what this was built and verified against) | 1 vCPU | 1–2 GB | ~5–10 GB (mostly Docker images; the actual data is tiny — financial transaction rows are a few hundred bytes each) |
| Small team (a household, a handful to a few dozen concurrent users) | 2 vCPU | 2–4 GB | Same, plus DB growth over time (still modest for years of transaction history) |

All three services (Postgres, the Express API, the static web build behind nginx) run comfortably on a single small VPS or a Raspberry-Pi-class machine at the "personal" tier. Treat these as a floor — see question 6 for what's missing before this should carry real concurrent load.

---

### 8. Steps to deploy this on a Linux system? Do the server and database need separate deployment, or does it run under one Docker setup?

> Full walkthrough with copy-pasteable commands (provisioning, TLS, hardening, backups): [DEPLOYMENT.md](DEPLOYMENT.md). This answer is the short version.

**One Docker Compose stack, three containers, one command** — `postgres`, `server` (Express API), and `mybudget-web` (static build behind nginx) all come up together via `docker-compose.yml`. This works identically on Linux (Docker Engine + Compose are cross-platform); nothing here is Windows-specific.

Steps on a fresh Linux host:
1. Install Docker Engine and the Docker Compose plugin (`docker compose version` should work).
2. Copy the repo to the host (`git clone` or `rsync`).
3. Create `.env` (repo root) and `server/.env` from `.env.example` in each location, with **real, unique** `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` — never reuse the values from local dev.
4. `docker compose up --build -d` from the repo root. This builds all three images and, on first start, automatically runs Postgres migrations, seeds the 45 system categories, and seeds the two demo accounts (`server/docker-entrypoint.sh`).
5. Open the mapped web port (`8080` by default — change the left-hand side of the `mybudget-web` port mapping in `docker-compose.yml` if that's taken or if you want to serve on `80`/`443`).

**Can the database be split onto a separate host?** Yes — point `DATABASE_URL` at any reachable Postgres 16 instance (a managed service, a separate VM) and drop the `postgres` service from `docker-compose.yml`. The app doesn't care where Postgres physically runs, only that `DATABASE_URL` can reach it. The default setup keeps everything on one host under one `docker compose up` because that's sufficient for personal/small-scale use, not because anything requires it.

**Not production-hardened yet — do this before exposing it to the internet:**
- No TLS anywhere (`nginx.conf` serves plain HTTP on :80, the API serves plain HTTP on :4000) — put a reverse proxy (Caddy, nginx, Traefik) with a real certificate in front.
- Change or remove the two seeded demo accounts (question 10) — their passwords are public in this repo's docs.
- Don't publish the Postgres port (`5433:5432` in the default compose file) to anything but `localhost`/the internal network — only the `server` container needs to reach it, on the internal Docker network at `postgres:5432`, regardless of the host-side mapping.

---

### 9. Are admin login and user login separate functions?

No — **one login endpoint, one login screen, same code path for everyone.** `POST /api/v1/auth/login` and `app/login.tsx` don't know or care whether the account is an admin. The only difference is the account's `role` field, checked *after* authentication:
- The client reads `role` from the logged-in user's profile and shows/hides the Admin panel link accordingly (`isAdmin` in `context/AuthContext.tsx`) — a UI convenience, not a security boundary.
- The server's `requireAdmin` middleware independently re-checks `role` from the database (not the JWT) on every request to an admin-only route, so it can't be bypassed by hiding/showing UI elements.

So: authentication is unified; authorization is role-based and enforced server-side.

---

### 10. Test accounts — 1 user, 1 admin

Seeded automatically by `server/src/db/seed-accounts.ts` on every `docker compose up` (also re-runnable manually via `cd server && npm run db:seed:accounts`). Local dev credentials only — see the hardening note in question 8 before any real deployment.

| Role | Email | Password |
|---|---|---|
| Super admin | `admin@mybudget.local` | `Admin@12345` |
| Standard user | `user@mybudget.local` | `User@12345` |
