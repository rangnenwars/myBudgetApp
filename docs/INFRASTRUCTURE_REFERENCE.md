# Infrastructure Reference — IPs, Ports, Database, Firewall, Network

One page that answers "where does it run, on what address, behind which door, and where are the secrets?" for **production (DigitalOcean)** and **local development**.

> **What is and isn't known from the repo.** Everything below marked ✅ is read straight from files in this repo (compose files, Caddyfile, workflows). Anything marked 📝 **fill in** is a value that only exists in your DigitalOcean / DNS / GitHub accounts (the Droplet's real IP, for example) — it is deliberately **not** invented here. Fill the 📝 cells in once and keep this file current. The rollout checklist in [DEPLOYMENT_DIGITALOCEAN.md](DEPLOYMENT_DIGITALOCEAN.md) §10 still shows the infrastructure phases unticked, so confirm each item against the live account before trusting it.

Related: [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md) (procedures) · [SYSTEM_ARCHITECTURE_GUIDE.md](SYSTEM_ARCHITECTURE_GUIDE.md) (how it works, which file to edit) · [DB_ADMIN_QUERIES.md](DB_ADMIN_QUERIES.md) (SQL) · [DATABASE_DESIGN.md](DATABASE_DESIGN.md) (schema).

---

## 1. Production inventory (DigitalOcean)

| Item | Value | Source |
|---|---|---|
| Public site | `https://prapanji.in` (`www.prapanji.in` 301-redirects to the apex) | ✅ `deploy/Caddyfile` |
| Cloud provider / region | DigitalOcean, **BLR1** (Bangalore) | ✅ DEPLOYMENT_DIGITALOCEAN §1 |
| Droplet name | `mybudget-prod` | ✅ plan §3.1 |
| Droplet image / size | Ubuntu 24.04 LTS, Basic 1 vCPU / 2 GB RAM / 50 GB disk (~US$12/mo), Monitoring + weekly Backups on | ✅ plan §1, §3.1 |
| **Reserved (static) IPv4** | 📝 **fill in**: `___.___.___.___` | DO console → Networking → Reserved IPs |
| Droplet's own public IPv4 | 📝 fill in (only needed if you SSH before attaching the reserved IP) | DO console → Droplet |
| Droplet private (VPC) IP | 📝 fill in (not used by the app; there is a single host) | DO console → Droplet → Networking |
| DO project | `MyBudget` | ✅ plan §3.1 |
| Cloud Firewall | `mybudget-prod-fw` (rules in §4) | ✅ plan §3.1 |
| Off-box backups | Spaces bucket `mybudget-backups` (private, BLR1) — 📝 confirm created | ✅ plan §3.1 |
| Container registry | GHCR: `ghcr.io/rangnenwars/mybudget-web`, `ghcr.io/rangnenwars/mybudget-server` (private packages) | ✅ `deploy.yml` |
| Source repo | `github.com/rangnenwars/myBudgetApp` — deploys run from `main` only | ✅ `deploy.yml`, DEPLOYMENT.md §4 |
| Deploy user on the Droplet | `deploy` (member of the `docker` group, **no sudo**, key-only SSH) | ✅ plan §3.3 |
| App directory on the Droplet | `/opt/mybudget` | ✅ `remote-deploy.sh` |
| Compose project name | `mybudget` (so containers are `mybudget-<service>-1`) | ✅ `docker-compose.prod.yml` `name:` |

### Files that live in `/opt/mybudget` on the Droplet

| File | Created by | Purpose | Secret? |
|---|---|---|---|
| `.env` | **by hand, once** (`chmod 600`, owner `deploy`) | `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, optional `SMTP_*` | **Yes** — never in git, never in GitHub |
| `release.env` | `remote-deploy.sh` | `IMAGE_TAG=<40-char commit SHA>` — what is running now | No |
| `release.env.prev` | `remote-deploy.sh` | Previous `IMAGE_TAG` — used for rollback | No |
| `docker-compose.prod.yml`, `Caddyfile`, `remote-deploy.sh` | copied by `deploy.yml` (scp) on every deploy | The stack definition | No |
| `deploy-history.log` | `remote-deploy.sh` | `<timestamp> <sha>` per deploy | No |
| `backups/` , `backup.log` | backup cron | Nightly `pg_dump` files | Contains all user data — treat as sensitive |

---

## 2. Services, ports and how they talk

Production compose (`deploy/docker-compose.prod.yml`) — **only Caddy publishes host ports.**

| Service | Image | Listens (inside Docker network) | Published on host | Reached by |
|---|---|---|---|---|
| `caddy` | `caddy:2-alpine` | 80, 443, 443/udp | **80, 443, 443/udp** | the internet |
| `web` | `ghcr.io/rangnenwars/mybudget-web:$IMAGE_TAG` (nginx serving the Expo web export) | 80 | none | Caddy (`web:80`) |
| `server` | `ghcr.io/rangnenwars/mybudget-server:$IMAGE_TAG` (Express + `tsx`) | 4000 | none | Caddy (`server:4000`) |
| `postgres` | `postgres:16-alpine` | 5432 | **none** | the `server` container only (`postgres:5432`) |

Routing in `deploy/Caddyfile`:

```
https://prapanji.in/api/*   → server:4000      (API is mounted at /api/v1 in server/src/app.ts — no rewrite)
https://prapanji.in/health  → server:4000      (unauthenticated liveness check; returns {"status":"ok"…})
https://prapanji.in/*       → web:80           (static SPA; nginx does the index.html fallback)
https://www.prapanji.in/*   → 301 https://prapanji.in{uri}
```

Caddy also adds HSTS (1 year, includeSubDomains), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, strips the `Server` header and gzip/zstd-compresses. Docker volumes: `pgdata` (database files), `caddy_data` (issued certificates — **do not delete**, Let's Encrypt rate-limits re-issuance), `caddy_config`.

### Local development (for comparison)

Root `docker-compose.yml`, project name `mybudgetapp`:

| Service | Container | Host port | Notes |
|---|---|---|---|
| `mybudget-web` | `mybudgetapp-mybudget-web-1` | **8080** → 80 | static build, API URL baked as same-origin `/api/v1`; its nginx proxies `/api/` to `server:4000` |
| `server` | `mybudgetapp-server-1` | **4000** → 4000 | |
| `postgres` | `mybudgetapp-postgres-1` | **5433** → 5432 | host 5433 because the dev PC already runs a native Postgres on 5432 |

Dev tooling: `npx expo start --web --port 8090` (hot-reload client).

---

## 3. Database details

| | Production | Local dev |
|---|---|---|
| Engine | PostgreSQL 16 (`postgres:16-alpine`) | same |
| Database name | `mybudget` | `mybudget` |
| User | `mybudget` | `mybudget` |
| Password | `POSTGRES_PASSWORD` in `/opt/mybudget/.env` (📝 generated with `openssl rand -hex 24`; **not stored in the repo**) | `mybudget_dev` (public, dev only) |
| Connection string used by the server | `postgres://mybudget:${POSTGRES_PASSWORD}@postgres:5432/mybudget` (hex password keeps the URL safe) | `postgres://mybudget:mybudget_dev@postgres:5432/mybudget` (in-container) · `…@localhost:5433/mybudget` (from the host) |
| Reachable from outside the host? | **No** — no `ports:` mapping; access via `docker compose exec postgres psql` over SSH | Yes, `localhost:5433` |
| Data volume | Docker named volume `mybudget_pgdata` | `mybudgetapp_pgdata` |
| Schema management | Drizzle migrations in `server/drizzle/*.sql` (0000–0011 at time of writing), applied **automatically** by `docker-entrypoint.sh` on every server start | same |
| Seed data | 45 system categories on every start (idempotent). **Demo accounts are NOT seeded in production** (`NODE_ENV=production`, `SEED_DEMO_ACCOUNTS=false`) | demo accounts seeded: `admin@mybudget.local` / `user@mybudget.local` |
| Pool size | `PG_POOL_MAX` (default 10) | same |
| Backups | nightly `pg_dump` cron → `/opt/mybudget/backups` → Spaces; weekly Droplet snapshot | Windows Scheduled Task "MyBudgetApp DB Backup", Sundays 02:00, 60-day retention → `D:\MyBudgetApp\backups` |

Tables (see [DATABASE_DESIGN.md](DATABASE_DESIGN.md) for DDL): `users`, `categories`, `refresh_tokens`, `user_tokens`, `accounts`, `transactions`, `recurring_transactions`, `loans`, `investments`, `savings_goals`, `goal_contributions`, `net_worth_snapshots`, `budgets`, `admin_audit_log`, `issue_reports`. Every user-owned table is `ON DELETE CASCADE` from `users`.

Open a SQL shell on the Droplet (compose needs both env files because the image tag is interpolated):

```bash
cd /opt/mybudget
alias dc='docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env'
dc exec postgres psql -U mybudget -d mybudget
```

Queries to run in it are in [DB_ADMIN_QUERIES.md](DB_ADMIN_QUERIES.md).

---

## 4. Firewall

### 4.1 DigitalOcean Cloud Firewall `mybudget-prod-fw` (network edge — the one that matters)

Attached to the Droplet `mybudget-prod`.

| Direction | Protocol | Port | Source / destination | Why |
|---|---|---|---|---|
| Inbound | TCP | 22 | All IPv4/IPv6 (see note) | SSH — GitHub-hosted runners have changing IPs, so a fixed allowlist would break deploys. Protected by key-only auth, no root password, fail2ban |
| Inbound | TCP | 80 | All | HTTP → Caddy (ACME HTTP challenge + redirect to HTTPS) |
| Inbound | TCP | 443 | All | HTTPS → Caddy |
| Inbound | UDP | 443 | All | HTTP/3 (QUIC) → Caddy |
| Outbound | All | All | All | OS updates, GHCR pulls, Let's Encrypt, SMTP, Spaces |

**Not open, on purpose:** 5432 (Postgres), 4000 (API), 8080 (web container). They are not published by the prod compose at all.

> Tightening SSH later: install Tailscale on the Droplet and use `tailscale/github-action` in the deploy job, then drop the public 22 rule; or use a self-hosted runner so no inbound SSH is needed (plan §3.1 / §9).

### 4.2 Host-level hardening on the Droplet (plan §3.3)

| Control | Setting |
|---|---|
| SSH | `PasswordAuthentication no`, `PermitRootLogin prohibit-password` |
| Users | `deploy` (docker group, no sudo) used by CI; your personal key for admin access |
| `fail2ban` | installed (default sshd jail) |
| `unattended-upgrades` | installed — automatic security patches; reboot monthly (containers restart themselves) |
| Swap | 2 GB `/swapfile` (safety net for memory spikes) |
| `ufw` | **Not required** on the Droplet — the Cloud Firewall does the job. If you add `ufw` anyway, remember Docker-published ports bypass `ufw` rules (Docker writes its own iptables rules), so ufw cannot protect a mistakenly published port; the DO Cloud Firewall can. |

### 4.3 Application-level protections

| Layer | Setting | File |
|---|---|---|
| Rate limiting | per-IP limits on auth routes; needs `TRUST_PROXY=1` so the real client IP is used behind Caddy | `server/src/middleware/rateLimit.ts` |
| CORS | `CORS_ORIGIN=https://prapanji.in,https://www.prapanji.in` (required in production — server refuses to boot without it) | `deploy/docker-compose.prod.yml` |
| Security headers | Caddy (HSTS etc.) + nginx (CSP, `X-Frame-Options`, `Permissions-Policy`) + `helmet` in Express | `deploy/Caddyfile`, `nginx.conf`, `server/src/app.ts` |
| Startup guard | In production the server refuses to start unless the two JWT secrets differ, are ≥ 32 chars, and `CORS_ORIGIN` is set | `server/src/index.ts` (see `server/.env.example`) |

> The web `Content-Security-Policy` in `nginx.conf` allows only `connect-src 'self'`. The API is same-origin everywhere: Caddy routes `/api/*` to the server in production, and the web container's nginx proxies `/api/` to `server:4000` for local Docker (the server sets `TRUST_PROXY=1` there). If you ever host the API on a different origin (e.g. `api.prapanji.in`), add it to `connect-src` and to `CORS_ORIGIN`.

---

## 5. DNS and TLS

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` (`prapanji.in`) | 📝 reserved IP | 300 |
| A | `www` | 📝 reserved IP | 300 |
| CAA | `@` | `0 issue "letsencrypt.org"` | 3600 |
| *(optional)* A | `staging` | 📝 staging Droplet IP | 300 |

DNS can be hosted at the registrar or delegated to DigitalOcean (`ns1/ns2/ns3.digitalocean.com`). 📝 Record which one is in use: `________`.

TLS: Caddy obtains and auto-renews Let's Encrypt certificates for `prapanji.in` and `www.prapanji.in`. Prerequisites: both A records resolve to the Droplet and ports 80/443 are open. Certificates are stored in the `caddy_data` volume. No contact e-mail is configured in the Caddyfile (Let's Encrypt no longer sends expiry mail); the DO Uptime check alerts on certificate expiry instead.

Verify:

```bash
dig +short prapanji.in
dig +short www.prapanji.in
curl -sI https://prapanji.in | head -5
curl -s https://prapanji.in/health
```

---

## 6. Secrets and configuration — where each value lives

| Secret / setting | Stored in | Read by | Rotation |
|---|---|---|---|
| `POSTGRES_PASSWORD` | `/opt/mybudget/.env` | compose → postgres + server `DATABASE_URL` | `ALTER USER mybudget PASSWORD '…'` in Postgres **first**, then edit `.env`, then `up -d` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `/opt/mybudget/.env` | server | edit `.env` + `up -d`; **logs everyone out** |
| `SMTP_HOST/PORT/USER/PASS/FROM` | `/opt/mybudget/.env` (optional) | server (password-reset, e-mail confirmation, nightly digest) | edit + `up -d`. Without SMTP these e-mails are **not sent** (a warning is logged) |
| `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | GitHub → Settings → Environments → `production` (secrets) | `deploy.yml` | regenerate key pair, update `authorized_keys` on the Droplet + the secret |
| `PUBLIC_API_URL` (optional) | GitHub → repository **variable** (not environment) | `deploy.yml` build job → `EXPO_PUBLIC_API_URL` build arg | default `https://prapanji.in/api/v1` |
| `GITHUB_TOKEN` | automatic per run | pushes images; piped to the Droplet over SSH stdin for `docker login ghcr.io` | n/a |
| Spaces access key (backups) | `rclone` config on the Droplet (📝 confirm) | backup cron | rotate in DO, re-run `rclone config` |

Server environment variables (production compose sets the ✅ ones; the others are available but **not wired into `docker-compose.prod.yml`** — add them under `server.environment` if you want them):

| Variable | Prod value | Meaning |
|---|---|---|
| `NODE_ENV` | ✅ `production` | enables production guards, disables demo seeding and self-service Pro |
| `SEED_DEMO_ACCOUNTS` | ✅ `"false"` | |
| `CORS_ORIGIN` | ✅ `https://prapanji.in,https://www.prapanji.in` | |
| `TRUST_PROXY` | ✅ `"1"` | one reverse-proxy hop (Caddy) |
| `APP_URL` | ✅ `https://prapanji.in` | base of reset/confirmation links in e-mails |
| `PORT` | ✅ `4000` | |
| `DATABASE_URL`, `JWT_*` | ✅ from `.env` | |
| `SMTP_HOST/PORT/USER/PASS/FROM` | ✅ pass-through (empty if unset) | `SMTP_SECURE` is also read by the code but is not passed through |
| `ALLOW_SELF_TIER_CHANGE` | ⚠ not set → **off** in production | the "Try Pro" button returns 403; admins grant Pro (see DB_ADMIN_QUERIES §3) |
| `ISSUE_DIGEST_ENABLED`, `ISSUE_DIGEST_TO/TIME/MAX`, `TZ`, `ANTHROPIC_API_KEY`, `ISSUE_AI_MODEL` | ⚠ not set → nightly issue digest **off** | add to the compose file + `.env` to enable |
| `APP_TIMEZONE` | ⚠ not set → defaults to `Asia/Kolkata` | decides when a new month/day starts for EMIs, repeating entries, budgets |
| `PG_POOL_MAX` | ⚠ not set → 10 | |

Client build-time variable: `EXPO_PUBLIC_API_URL` — inlined into the JS bundle at `expo export` time (Dockerfile build arg). It cannot be changed at runtime; changing it means rebuilding the `web` image (and any mobile build).

---

## 7. Monitoring and alerts (to configure in the DO console)

| Check | Setting |
|---|---|
| Uptime check | `https://prapanji.in/health` from Bangalore + one other region; e-mail alert; also alert on SSL expiry |
| Resource alerts | CPU > 80 % for 10 min · memory > 85 % · disk > 80 % |
| Logs | `dc logs -f server` on the Droplet; every service has `json-file` rotation (10 MB × 5) so logs cannot fill the disk |

📝 Alert e-mail / channel: `________`
