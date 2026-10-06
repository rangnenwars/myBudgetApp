# Configuration State and Change Log — 2026-10-03

A dated snapshot of what is configured, what was changed on **2026-10-03**, and what still needs a human to confirm in an external account. Add a new dated section (don't rewrite this one) the next time a significant change lands.

> **How to read the status column.**
> ✅ **In repo** — verified by reading the committed files today.
> ✅ **Verified live (local)** — checked against the running local Docker stack today.
> 📝 **Confirm** — lives in DigitalOcean / DNS / GitHub / the Droplet; the repo can't prove it. Tick it off after checking.

---

## 1. Changes made on 2026-10-03

### 1.1 Delivery pipeline and production stack (committed to `main`/branches today)

| Time (IST) | Commit | What changed |
|---|---|---|
| 10:32 | `0f8c492` | Dependabot: `nodemailer` 6.10.1 → 10.0.13 in `server/` (merged as PR #20 at 17:18) |
| 15:06 | `68a3e78` | **Added GitHub Actions CI/CD and DigitalOcean deploy config for prapanji.in**: `.github/workflows/ci.yml`, `deploy.yml`, `dependabot.yml`, `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/remote-deploy.sh`, `docs/DEPLOYMENT_DIGITALOCEAN.md` (merged as PR #2 at 16:01) |
| 16:03 | `adec97a` | Fixed the client CI typecheck; moved `checkout` / `setup-node` actions to Node 24 releases |
| 17:25 | `f864c15` | Dependabot grouped into one PR per ecosystem (minor/patch) |

### 1.2 Documentation work (this working session — **uncommitted**, `git status` shows them)

| File | Change |
|---|---|
| `docs/DEPLOYMENT.md` | Step 6.2 rewritten: demo accounts are seeded **unless** `NODE_ENV=production` or `SEED_DEMO_ACCOUNTS=false`, and the root `docker-compose.yml` sets neither — the step now lists the four env entries to add (`NODE_ENV`, `SEED_DEMO_ACCOUNTS`, `CORS_ORIGIN`, `TRUST_PROXY`), the first-admin command, and clean-up if demo accounts were already seeded. Section 8 first-boot paragraph and the intro (pointer to the DigitalOcean doc) updated to match. |
| `docs/OPERATIONS_RUNBOOK.md` | **New** — manual deployment (registry path, image-transfer path), rollback, backups/restore, troubleshooting |
| `docs/INFRASTRUCTURE_REFERENCE.md` | **New** — IP/port/DB/firewall/DNS/secrets inventory |
| `docs/SYSTEM_ARCHITECTURE_GUIDE.md` | **New** — how it works; "which file changes what" |
| `docs/DB_ADMIN_QUERIES.md` | **New** — SQL cookbook (make admin, reset password, clean up, stats). All statements were executed against the local database inside a rolled-back transaction; no data changed. |
| `docs/USER_MANUAL.md`, `docs/USER_DISTRIBUTION.md` | **New** — end-user manual and distribution plan |
| `docs/CONFIGURATION_STATE.md` | **New** — this file |
| `docs/README.md` | Documentation index extended |

No application code, compose files or workflows were changed by the documentation work itself.

### 1.2a Other uncommitted work in the tree when this snapshot was taken (not part of the documentation work)

`git status` also showed edits to application code, so **the deployed `main` and this working tree differ**:

| File | Change in progress |
|---|---|
| `server/src/routes/loans.ts` (+ `loans.test.ts`) | editing a loan now runs in a transaction and corrects the current month's auto-posted `Loan EMI` expense to the new EMI/name |
| `server/src/routes/transactions.ts` (+ `recurring.test.ts`) | transaction/recurring route changes with new tests |
| `utils/database.ts`, `app/(tabs)/transactions.tsx` | matching client changes |
| `app/login.tsx` | removed the "Your data is securely stored on the server…" footer box |

None of this is deployed until committed, merged to `main`, and approved in the `production` environment. Run `npm run verify` before committing.

### 1.3 Local environment findings (no changes made)

* Local stack up: `mybudgetapp-server-1` (:4000), `mybudgetapp-mybudget-web-1` (:8080), `mybudgetapp-postgres-1` (:5433 → 5432), Postgres healthy. DB `mybudget`, user `mybudget`.
* Local users at the time of checking (7): 1 admin (`admin@mybudget.local`), 6 `user`s — the demo user, plus test leftovers (`verify-…@example.com` ×2, `dockertest@example.com`, `verify-goals-…@example.com` ×2). The Demo User's tier had flipped to `pro` since an earlier check — a test-suite side effect. **None of these exist in production.**
* Login mix-up diagnosed: `user@mybudget.local` password is case-sensitive (capital U, see FAQ.md Q10); it was being typed in lowercase.

---

## 2. Configuration matrix — production

| Area | Setting | Status |
|---|---|---|
| Domain | `prapanji.in` + `www` redirect | ✅ In repo (`deploy/Caddyfile`) · 📝 Confirm DNS A records → reserved IP, CAA record |
| TLS | Caddy + Let's Encrypt, automatic | ✅ In repo · 📝 Confirm a valid certificate is being served |
| Droplet | `mybudget-prod`, Ubuntu 24.04, BLR1, 2 GB, Monitoring + weekly Backups, reserved IP | 📝 Confirm created (plan §10 Phase 1 is still unticked) |
| Cloud Firewall | `mybudget-prod-fw`: in 22/tcp, 80/tcp, 443/tcp, 443/udp; out all | 📝 Confirm created and attached |
| Host hardening | `deploy` user, key-only SSH, no root password, fail2ban, unattended-upgrades, 2 GB swap | 📝 Confirm bootstrap script (runbook §2) was run |
| Compose stack | caddy + web + server + postgres; only Caddy publishes 80/443/443-udp | ✅ In repo (`deploy/docker-compose.prod.yml`) |
| Images | GHCR `mybudget-web`, `mybudget-server`, tagged by commit SHA | ✅ In repo (`deploy.yml`) · 📝 Confirm packages exist and are private |
| Runtime secrets | `/opt/mybudget/.env`: `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (+ `RESEND_API_KEY`, `MAIL_FROM`) | 📝 Confirm file exists, mode 600, values ≥ 32 chars and different |
| Server flags | `NODE_ENV=production`, `SEED_DEMO_ACCOUNTS=false`, `CORS_ORIGIN`, `TRUST_PROXY=1`, `APP_URL` | ✅ In repo |
| Demo accounts | not seeded in production | ✅ In repo (entrypoint + `seed-accounts.ts` guard) · 📝 Confirm with `SELECT email FROM users WHERE email LIKE '%@mybudget.local'` → 0 rows. **Only true if production runs `deploy/docker-compose.prod.yml`**; the root `docker-compose.yml` seeds them. |
| First admin | via `create-admin.ts` after self-registering | 📝 Confirm an admin exists (`SELECT … WHERE role='admin'`) |
| GitHub `production` environment | required reviewer, deployment branch `main`, secrets `DEPLOY_HOST/USER/SSH_KEY/KNOWN_HOSTS` | 📝 Confirm |
| Branch protection on `main` | PR + required checks `client`, `server`, `docker-build` | 📝 Confirm |
| CI on PRs | client quality, server quality (real Postgres), docker build check | ✅ In repo (`ci.yml`) |
| Dependabot | weekly; actions SHA-pinned; minor/patch grouped per ecosystem | ✅ In repo |
| Backups | nightly `pg_dump` cron + `rclone` to Spaces `mybudget-backups`; weekly Droplet snapshots | 📝 Confirm cron, rclone config, bucket lifecycle (90 d); restore drill done once |
| Monitoring | DO Uptime check on `/health` (+ SSL expiry), CPU/mem/disk alerts | 📝 Confirm |
| E-mail (Resend) | `RESEND_API_KEY` + `MAIL_FROM` in `/opt/mybudget/.env`; `prapanji.in` verified in Resend | 📝 Confirm — without it, password-reset and e-mail confirmation mails are **not sent** |
| Web → API URL | `https://prapanji.in/api/v1` baked at build (`PUBLIC_API_URL` variable, default) | ✅ In repo |

---

## 3. Known gaps and recommended settings (decisions for the owner)

| # | Gap | Where | Suggested action |
|---|---|---|---|
| 1 | `eas.json` has **no `EXPO_PUBLIC_API_URL`** in any build profile, so a mobile build would call the `localhost` fallback | `eas.json` | Add `"env": { "EXPO_PUBLIC_API_URL": "https://prapanji.in/api/v1" }` to the `preview` and `production` profiles before building a distributable app ([USER_DISTRIBUTION.md](USER_DISTRIBUTION.md)). Check Expo v57 EAS docs first (`AGENTS.md`). |
| 2 | Nightly issue digest, `TZ`, `ANTHROPIC_API_KEY`, `ISSUE_DIGEST_*`, `APP_TIMEZONE` are not passed through `docker-compose.prod.yml` | `deploy/docker-compose.prod.yml` | Add under `server.environment` if you want the digest (e.g. `ISSUE_DIGEST_ENABLED: ${ISSUE_DIGEST_ENABLED:-false}`, `TZ: ${TZ:-Asia/Kolkata}` like the local compose does). Without `TZ` the container runs in UTC. |
| 3 | "Try Pro" is off in production; there is no billing | `ALLOW_SELF_TIER_CHANGE` | Decide the Pro model: admins grant it (DB_ADMIN_QUERIES §3), or set `ALLOW_SELF_TIER_CHANGE: "true"` for a free-Pro period, or wire a payment processor. |
| 4 | SSH (22) open to the world | Cloud Firewall | Acceptable with key-only + fail2ban; move to Tailscale or a self-hosted runner when convenient (plan §9). |
| 5 | `docs/DEPLOYMENT.md` path still defaults to demo accounts unless the user adds the env entries | root `docker-compose.yml` | Consider adding `NODE_ENV` / `SEED_DEMO_ACCOUNTS` / `CORS_ORIGIN` as `${VAR:-default}` entries to the root compose so the safe setting is one `.env` line away. |
| 6 | Caddy `depends_on` waits for `web`/`server` to *start*, not to be healthy | `deploy/docker-compose.prod.yml` | Low risk (Caddy retries upstreams); add `condition: service_healthy` + a `web` healthcheck if you want strictness. |
| 7 | Rollback restores code, not schema | process | Keep migrations additive; take a pre-release dump when a release adds one (runbook §5.0). |
| 8 | `docs/DEPLOYMENT_DIGITALOCEAN.md` §10 checklist is still unticked | doc | Tick items as they are verified (§2 above). |

---

## 4. Quick verification script (run after any production change)

```bash
curl -fsS https://prapanji.in/health                         # {"status":"ok"}
curl -sI http://prapanji.in | head -2                        # redirect to https
curl -sI https://www.prapanji.in | head -2                   # 301 to apex
nmap -Pn -p 22,80,443,4000,5432,8080 prapanji.in             # only 22/80/443 open
```

```bash
# on the Droplet (alias dc from the runbook)
dc ps && cat release.env
dc exec -T postgres psql -U mybudget -d mybudget -c "SELECT role, count(*) FROM users GROUP BY role;"
dc exec -T postgres psql -U mybudget -d mybudget -c "SELECT count(*) AS demo_accounts FROM users WHERE email LIKE '%@mybudget.local';"
```
