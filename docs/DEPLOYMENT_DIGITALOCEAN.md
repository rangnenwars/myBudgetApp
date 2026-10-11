# Hosting My Budget on DigitalOcean (prapanji.in) with GitHub CI/CD

Plan for running the production instance of My Budget at **https://prapanji.in** on DigitalOcean, with every merge to `main` tested, built, and deployed automatically by GitHub Actions.

It builds on [DEPLOYMENT.md](DEPLOYMENT.md) (manual VPS setup). The difference: images are built once in CI and pulled by the server, so the Droplet never runs `git pull` or `docker build`, and a release is just "point the server at a different image tag".

---

## 1. Target architecture

```
                         ┌──────────────── GitHub ────────────────┐
  developer ── PR ─────▶ │ ci.yml: client tests · server tests    │
                         │         · docker build check           │
  merge to main ───────▶ │ deploy.yml: ci → build & push images   │
                         │   → (approval) → ssh deploy → smoke    │
                         └──────┬───────────────────────┬─────────┘
                                │ push                  │ ssh (deploy user)
                                ▼                       ▼
                    ghcr.io/rangnenwars/     ┌──── DigitalOcean Droplet (BLR1) ─────┐
                    mybudget-web:<sha>  ───▶ │  docker compose (project "mybudget")  │
                    mybudget-server:<sha>    │                                       │
                         pull                │  caddy :80/:443 ── TLS (Let's Encrypt)│
                                             │    ├─ /api/*, /health ─▶ server:4000  │
  browser ── https://prapanji.in ──────────▶ │    └─ everything else ─▶ web:80       │
                                             │  postgres:5432 (internal only)        │
                                             │    └─ volume pgdata                   │
                                             └───────────┬───────────────────────────┘
                                                         │ nightly pg_dump
                                                         ▼
                                             DO Spaces bucket (off-box backups)
```

Decisions and why:

| Decision | Choice | Reason |
|---|---|---|
| Compute | One **Droplet**, Ubuntu 24.04, region **BLR1** (Bangalore) | `.in` domain → Indian users; lowest latency. Matches the existing single-host compose design. App Platform was considered but would need the Postgres + migrations story rewritten. |
| Size | Basic, 1 vCPU / 2 GB / 50 GB (~US$12/mo) | The server image runs `tsx` and Postgres on the same box; 1 GB is too tight. Resize in place later. |
| Registry | **GitHub Container Registry (GHCR)** | Free for this use, authenticates with the workflow's own `GITHUB_TOKEN`, no extra cloud credentials. DO Container Registry is a drop-in alternative. |
| TLS / proxy | **Caddy** as a container in the prod compose file | Automatic Let's Encrypt for `prapanji.in` and `www`, renewal included, config lives in git. |
| Routing | Single origin: `https://prapanji.in` for the web app, `https://prapanji.in/api/v1/...` for the API | No CORS needed between web and API; one certificate; the API is never exposed on its own port. |
| Database | Postgres 16 container on the Droplet (phase 1) → optional **DO Managed PostgreSQL** later | Cheapest start; moving out is just a `DATABASE_URL` change (see §9). |
| Deploy mechanism | GitHub Actions SSHes in and runs `docker compose pull && up -d` with the new image tag | Simple, auditable, no agent on the server. Rollback = redeploy an older tag. |
| Secrets | Runtime secrets live **only on the Droplet** (`/opt/mybudget/.env`); GitHub holds only SSH deploy credentials | JWT secrets and DB password never transit CI. |

Estimated monthly cost: Droplet $12 + Droplet weekly backups $2.40 + Spaces $5 ≈ **US$20/mo** (≈ +$15 if you move to Managed Postgres).

---

## 2. Changes needed in the repo

These are the code/config changes the pipeline depends on. §2.1–§2.3 are done (plus per-IP auth rate limiting, which needs `TRUST_PROXY: 1` behind Caddy, and `ALLOW_SELF_TIER_CHANGE`, off by default in production); the rest don't exist yet.

### 2.1 Bake the production API URL into the web build — `Dockerfile`

`utils/api.ts` reads `EXPO_PUBLIC_API_URL` and falls back to `http://localhost:4000/api/v1`. `EXPO_PUBLIC_*` variables are inlined at `expo export` time, so the value must be a build arg, not a runtime env var:

```dockerfile
# in the builder stage, before `npx expo export`
ARG EXPO_PUBLIC_API_URL=/api/v1
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL
```

CI passes `--build-arg EXPO_PUBLIC_API_URL=https://prapanji.in/api/v1`. The default is same-origin `/api/v1`, which local `docker compose up` serves through the web container's nginx (`/api/` → `server:4000`), so the CSP only needs `connect-src 'self'`.

### 2.2 Don't seed demo accounts in production — `server/docker-entrypoint.sh`

The entrypoint always seeds `admin@mybudget.local` / `user@mybudget.local`, whose passwords are published in the docs. Gate it:

```sh
if [ "${SEED_DEMO_ACCOUNTS:-true}" = "true" ]; then
  echo "Seeding demo accounts..."
  npx tsx src/db/seed-accounts.ts
fi
```

Production sets `SEED_DEMO_ACCOUNTS=false` (the entrypoint also skips seeding under `NODE_ENV=production`, and `seed-accounts.ts` refuses to run there). To create the first real admin, register normally in the app, then run once: `docker compose exec server npx tsx src/db/create-admin.ts <email>` — it promotes that existing account; no password is passed on the command line.

### 2.3 Restrict CORS — `server/src/app.ts`

`app.use(cors())` allows any origin. With single-origin hosting the browser doesn't need CORS at all, but the native app and future subdomains might:

```ts
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
```

Production sets `CORS_ORIGIN=https://prapanji.in,https://www.prapanji.in`.

### 2.4 New files

```
.github/
  workflows/
    ci.yml                 # PR + reusable test/build-check workflow
    deploy.yml             # main → build, push, deploy, smoke test; manual rollback
  dependabot.yml           # keeps actions + npm deps patched
deploy/
  docker-compose.prod.yml  # image-based stack incl. Caddy, no host ports except 80/443
  Caddyfile                # TLS + routing for prapanji.in
  remote-deploy.sh         # runs on the Droplet: pull, up, prune, record release
```

They're described in section 4–6.

---

## 3. One-time infrastructure setup

### 3.1 DigitalOcean

1. **Create a project** "MyBudget" in the DO console.
2. **Create the Droplet**: Ubuntu 24.04 LTS, BLR1, Basic 2 GB, enable **Monitoring** and **weekly Backups**, add *your personal* SSH key. Name it `mybudget-prod`.
3. **Reserved IP**: assign one to the Droplet, so DNS doesn't change if you ever rebuild the Droplet.
4. **Cloud Firewall** `mybudget-prod-fw` attached to the Droplet:
   - Inbound: TCP 22 (ideally restricted to your IP — see note below), TCP 80, TCP 443, UDP 443 (HTTP/3).
   - Outbound: all.
5. **Spaces bucket** `mybudget-backups` in BLR1 (private), plus a Spaces access key scoped to that bucket.

> **SSH and GitHub-hosted runners:** runner IPs change constantly, so locking port 22 to a fixed allowlist breaks deploys. Options, in order of preference: (a) keep 22 open but key-only, no root, fail2ban (done in 3.3); (b) install Tailscale on the Droplet and use `tailscale/github-action` in the deploy job so SSH is only reachable over the tailnet; (c) a self-hosted runner on the Droplet (pull-based, no inbound SSH at all). Start with (a), move to (b) when convenient.

### 3.2 DNS for prapanji.in

Either delegate the domain to DigitalOcean DNS (set the registrar's nameservers to `ns1/ns2/ns3.digitalocean.com`) or keep DNS at the registrar. Records:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | Droplet reserved IP | 300 |
| A | `www` | Droplet reserved IP | 300 |
| CAA | `@` | `0 issue "letsencrypt.org"` | 3600 |
| A *(optional, phase 4)* | `staging` | staging Droplet IP | 300 |

Verify before the first deploy — Caddy can only get a certificate once DNS resolves to the Droplet:

```bash
dig +short prapanji.in
dig +short www.prapanji.in
```

### 3.3 Droplet bootstrap (run once, as root, then never again)

```bash
# deploy user that GitHub Actions logs in as — docker group, no sudo
# Docker + compose plugin (first — the docker group must exist before usermod)
curl -fsSL https://get.docker.com | sh

adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy

# basic hardening
apt-get install -y fail2ban unattended-upgrades
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# 2 GB swap as a safety net for npm/tsx memory spikes
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# app directory owned by deploy
mkdir -p /opt/mybudget/backups && chown -R deploy:deploy /opt/mybudget
```

Create the **deploy SSH key** on your laptop (dedicated to CI — not your personal key):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy@prapanji.in" -f mybudget_deploy -N ""
```

Install `mybudget_deploy.pub` into `/home/deploy/.ssh/authorized_keys` on the Droplet. The private key goes into GitHub (3.4) and should then be deleted from the laptop.

### 3.4 Runtime secrets on the Droplet — `/opt/mybudget/.env`

Created by hand once, `chmod 600`, owned by `deploy`. Never committed, never in GitHub:

```bash
POSTGRES_PASSWORD=<openssl rand -hex 24>
JWT_ACCESS_SECRET=<openssl rand -hex 32>
JWT_REFRESH_SECRET=<openssl rand -hex 32, different>
```

(Use hex so the password is safe inside the `DATABASE_URL`.) Rotating a secret = edit this file + `docker compose up -d`.

### 3.5 GitHub repository settings

1. **Environment `production`** (Settings → Environments):
   - Required reviewer: you. Every production deploy pauses for a one-click approval.
   - Deployment branches: `main` only.
   - Environment URL: `https://prapanji.in`.
   - Environment secrets:

     | Secret | Value |
     |---|---|
     | `DEPLOY_HOST` | Droplet reserved IP (or `prapanji.in`) |
     | `DEPLOY_USER` | `deploy` |
     | `DEPLOY_SSH_KEY` | contents of `mybudget_deploy` (private key) |
     | `DEPLOY_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <reserved-ip>` — pins the host key, prevents MITM |

   - Optional *repository* variable (Settings → Secrets and variables → Actions → Variables), not an environment variable: `PUBLIC_API_URL=https://prapanji.in/api/v1`. The workflow defaults to this value if it's unset.
2. **Branch protection on `main`**: require PRs, require the `ci` status checks (`client`, `server`, `docker-build`) to pass, no force-pushes.
3. **Packages**: after the first push, GHCR packages `mybudget-web` and `mybudget-server` appear under your account — keep them **private**; the deploy job logs the Droplet in with a short-lived token each time.
4. **Actions → General**: workflow permissions "Read repository contents" by default (each workflow requests what it needs explicitly).

---

## 4–6. Runtime files and workflows

These are real files in the repo — read them there rather than a copy here:

| File | What it does |
|---|---|
| [deploy/docker-compose.prod.yml](../deploy/docker-compose.prod.yml) | Image-based prod stack: `caddy` (the only service with host ports: 80, 443, 443/udp), `web`, `server`, `postgres`. Images are `ghcr.io/rangnenwars/mybudget-{web,server}:${IMAGE_TAG}`; secrets come from `/opt/mybudget/.env`; sets `NODE_ENV=production`, `SEED_DEMO_ACCOUNTS=false`, `CORS_ORIGIN`, `TRUST_PROXY=1`, `APP_URL`, optional `RESEND_API_KEY` / `MAIL_FROM` (see §8.1). Log rotation on every service. |
| [deploy/Caddyfile](../deploy/Caddyfile) | Automatic HTTPS for `prapanji.in` + `www` (redirects to the apex); `/api/*` and `/health` → `server:4000`, everything else → `web:80`; HSTS and basic security headers. |
| [deploy/remote-deploy.sh](../deploy/remote-deploy.sh) | Runs on the Droplet as `deploy`. Logs in to GHCR with the token piped on stdin, **pulls first** (a failed pull leaves the running release untouched), then saves the old tag to `release.env.prev`, switches `release.env`, runs `up -d --wait` (fails if a service isn't healthy within 180 s), prunes images older than a week, appends to `deploy-history.log`. |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | On PRs and non-`main` pushes, and called by `deploy.yml`. Jobs: `client` (`npm run quality`), `server` (Postgres 16 service container → `db:migrate` → `db:seed` → `npm run quality`), `docker-build` (both images, no push; skipped when called from `deploy`). Superseded PR runs are cancelled; `main` runs never are. |
| [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) | `main` push → `ci` → `build` (pushes both images tagged with the commit SHA + `latest`; web built with `EXPO_PUBLIC_API_URL` = repository variable `PUBLIC_API_URL`, default `https://prapanji.in/api/v1`) → `deploy` (**`production` environment approval**, scp the three `deploy/` files, run `remote-deploy.sh`, smoke-test `/health` and `/`). On failure it rolls back to `release.env.prev`, but only if the server had already switched to the new tag. A manual run with `image_tag` = an older SHA redeploys that image without re-testing (rollback). |
| [.github/dependabot.yml](../.github/dependabot.yml) | Weekly updates for actions (pinned to commit SHAs), both npm trees, the Dockerfiles and the prod compose images. |

Choices made while implementing:
- **Only the `deploy` job uses the `production` environment.** Required reviewers apply to every job that references an environment, so `build` reads `PUBLIC_API_URL` as a *repository* variable (with a built-in default) to avoid a second approval prompt.
- **Secrets reach shell steps through `env:`**, never `${{ }}` inside scripts, and the image tag is checked to be a 40-character SHA before use.
- **No Let's Encrypt email** in the Caddyfile — Let's Encrypt stopped sending expiry emails in 2025; the DO uptime check (§8) alerts on certificate expiry instead.

---

## 7. The delivery story, end to end

1. **Branch** — work on a feature branch (e.g. `MyBudgetApp-B2`). The local Husky hook runs the same checks before each commit.
2. **Pull request → `ci.yml`** — `client`, `server` (against a real Postgres 16 service container, migrations applied from scratch) and `docker-build` must all be green. Branch protection blocks merging otherwise.
3. **Merge to `main` → `deploy.yml`**
   1. re-runs `ci` on the merge commit;
   2. builds both images once, tags them with the commit SHA (+ `latest`), pushes to GHCR, with the production API URL baked into the web bundle;
   3. **waits for approval** on the `production` environment (GitHub notifies you; one click);
   4. copies the compose/Caddy/deploy files to the Droplet and runs `remote-deploy.sh <sha>` — pull, `up -d` (the server container applies new Drizzle migrations on start), prune;
   5. smoke-tests `https://prapanji.in/health` and `/`; on failure, automatically restores the previous tag.
4. **Rollback** — Actions → *deploy* → *Run workflow* → enter a previous SHA (see `/opt/mybudget/deploy-history.log` or the GHCR package page). It skips CI/build and redeploys that exact image. Emergency rollback without GitHub: on the Droplet, `cp release.env.prev release.env` and run the compose `up -d` line from `remote-deploy.sh`.
5. **Audit trail** — every production deploy is a GitHub *Deployment* on the `production` environment, linked to its commit, approver and logs; the Droplet keeps `deploy-history.log`.

**Expected downtime per deploy:** a few seconds while the `server` container restarts and runs migrations. Acceptable for this app; true zero-downtime would need two server replicas behind Caddy and is not worth it at this scale.

**Migration caveat:** rollback restores *code*, not *schema*. Keep Drizzle migrations backward-compatible (add columns/tables first, remove in a later release) so the previous image still runs against a newer schema. A destructive migration should be preceded by a manual backup (§8).

---

## 8. Backups, monitoring, operations

### 8.1 Email (Resend)

DigitalOcean blocks outbound SMTP (ports 25, 465, 587) on every Droplet and has no email service of its own, so the server sends through [Resend](https://resend.com)'s HTTPS API (`lib/mailer.ts`). Free tier: 3,000 emails/month, 100/day, 3 domains. It carries password-reset and email-confirmation links and the admin issue digest.

1. Create a Resend account → **Domains → Add Domain** → `prapanji.in` (region: closest available to India).
2. Resend shows DNS records (an SPF `TXT` + `MX` on a `send` subdomain, and a DKIM `TXT` at `resend._domainkey`). Add each exactly as shown in DigitalOcean → Networking → Domains → `prapanji.in` → **Create a record**. Click **Verify** in Resend until the domain shows *Verified*.
3. **API Keys → Create API Key** → permission *Sending access*, domain `prapanji.in`. Copy the `re_…` key once.
4. On the Droplet, append to `/opt/mybudget/.env` (keeps mode 600):
   ```bash
   ssh prapanji-deploy
   cd /opt/mybudget
   printf 'RESEND_API_KEY=re_xxxxxxxx
MAIL_FROM="Prapanji <no-reply@prapanji.in>"
' >> .env
   docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env up -d
   ```
   The sender address must be on the verified domain.
5. Test: use **Forgot password?** on https://prapanji.in with a registered address; check `docker compose … logs server` if nothing arrives (a failed send logs `Resend rejected the email (HTTP …: reason)`).

Delivery stays within the free tier's 100/day cap — if the app grows past that, move to Resend's $20/month plan (50,000/month) with no code change.

**Backups (three layers):**

1. **Droplet weekly snapshots** — enabled at creation; whole-machine restore.
2. **Nightly logical dump** — reuse `server/scripts/backup-db.sh` (copy it to `/opt/mybudget/`) with the prod container name, then ship to Spaces. `deploy` user crontab:
   ```cron
   15 2 * * * DB_CONTAINER_NAME=mybudget-postgres-1 BACKUP_DIR=/opt/mybudget/backups RETENTION_DAYS=14 /opt/mybudget/backup-db.sh && rclone copy /opt/mybudget/backups spaces:mybudget-backups/daily >> /opt/mybudget/backup.log 2>&1
   ```
   (`rclone` configured once with the Spaces key from §3.1; set a Spaces lifecycle rule to expire objects after 90 days.)
3. **Restore drill** — once a quarter, restore the latest dump into a throwaway Postgres container per [DATABASE_BACKUP.md](DATABASE_BACKUP.md). An untested backup is not a backup.

**Monitoring:**

- DO **Uptime check** on `https://prapanji.in/health` (from Bangalore + one other region) with email alert; it also alerts on SSL certificate expiry.
- DO **Monitoring alerts**: CPU > 80% for 10 min, memory > 85%, disk > 80%.
- Logs: `docker compose -f docker-compose.prod.yml logs -f server` on the Droplet; rotation is set in the compose file so logs can't fill the disk.

**Routine ops:**

| Task | How |
|---|---|
| Deploy | merge to `main`, approve |
| Rollback | run `deploy` workflow with an older SHA |
| Rotate JWT / DB secret | edit `/opt/mybudget/.env`, `docker compose ... up -d` (rotating JWT secrets logs everyone out; rotating `POSTGRES_PASSWORD` also needs `ALTER USER` inside Postgres first) |
| OS patches | `unattended-upgrades` handles security updates; reboot monthly — containers restart automatically |
| Postgres minor upgrades | Dependabot PR bumps `postgres:16-alpine` digest → normal deploy |

---

## 9. Later phases (optional)

- **Staging** — a second small Droplet at `staging.prapanji.in`, GitHub environment `staging` with no approval gate. `deploy.yml` deploys to staging automatically, then promotes the *same image tag* to production after approval.
- **Managed PostgreSQL** — create a DO Managed Postgres cluster in BLR1 (trusted sources: the Droplet only), restore the latest dump into it, set `DATABASE_URL` in `/opt/mybudget/.env` to its `sslmode=require` connection string, remove the `postgres` service and `pgdata` volume from the prod compose file. Gains automated PITR backups and frees Droplet RAM.
- **Mobile builds** — add an EAS workflow (`expo/expo-github-action`) that builds Android/iOS with `EXPO_PUBLIC_API_URL=https://prapanji.in/api/v1` set in `eas.json`'s `production` profile env. Read the Expo v57 EAS docs before setting this up.
- **Leaner server image** — compile TypeScript in a build stage and run `node dist/index.js` with production-only deps instead of `tsx`; cuts image size and memory.
- **Private SSH path** — Tailscale on the Droplet + `tailscale/github-action`, then close port 22 to the public internet in the Cloud Firewall.

---

## 10. Rollout checklist

**Phase 0 — repo prep (one PR)**
- [x] `Dockerfile`: `EXPO_PUBLIC_API_URL` build arg (§2.1)
- [x] `server/docker-entrypoint.sh`: `SEED_DEMO_ACCOUNTS` gate (§2.2) + first-admin path
- [x] `server/src/app.ts`: `CORS_ORIGIN` (§2.3)
- [x] Add `deploy/` and `.github/` files (§4–6), pin actions to SHAs
- [x] Merge `MyBudgetApp-B1` work into `main` (deploys run from `main` only)

**Phase 1 — infrastructure**
- [ ] Droplet (BLR1, 2 GB, Monitoring + Backups), reserved IP, Cloud Firewall, Spaces bucket
- [ ] DNS A records for `@` and `www`, CAA record; `dig` resolves to the reserved IP
- [ ] Droplet bootstrap (§3.3), `/opt/mybudget/.env` (§3.4)
- [ ] GitHub `production` environment, secrets, variable, branch protection (§3.5)

**Phase 2 — first deploy**
- [ ] Merge Phase 0 PR → approve deploy → smoke test green
- [ ] `https://prapanji.in` loads with a valid certificate; `www` redirects; `http` redirects to `https`
- [ ] Create the real admin account; confirm demo accounts do **not** exist
- [ ] Confirm `5432`, `4000`, `8080` are closed from outside (`nmap -Pn prapanji.in`)

**Phase 3 — operations**
- [ ] Nightly backup cron + rclone to Spaces; run one restore drill
- [ ] Uptime check + resource alerts
- [ ] Test a rollback via `workflow_dispatch` with the previous SHA
