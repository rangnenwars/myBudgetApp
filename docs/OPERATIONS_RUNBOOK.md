# Operations Runbook — Manual Deployment and Day-2 Procedures

Step-by-step procedures for deploying and operating **https://prapanji.in** **by hand**, without relying on GitHub Actions. Use it for the very first deployment, when CI/CD is unavailable, or for emergency fixes.

| If you want… | Read |
|---|---|
| Addresses, ports, firewall, DB details, where secrets live | [INFRASTRUCTURE_REFERENCE.md](INFRASTRUCTURE_REFERENCE.md) |
| How the pieces work and which file to edit for which change | [SYSTEM_ARCHITECTURE_GUIDE.md](SYSTEM_ARCHITECTURE_GUIDE.md) |
| SQL for "make X an admin", reset a password, etc. | [DB_ADMIN_QUERIES.md](DB_ADMIN_QUERIES.md) |
| The automated (GitHub Actions) pipeline design | [DEPLOYMENT_DIGITALOCEAN.md](DEPLOYMENT_DIGITALOCEAN.md) |
| A simple single-box deploy from the root `docker-compose.yml` (no registry, no Caddy) | [DEPLOYMENT.md](DEPLOYMENT.md) |

Conventions: `$` lines run on your laptop, `deploy@droplet$` lines run on the Droplet. `<RESERVED_IP>` is your Droplet's reserved IPv4 (see INFRASTRUCTURE_REFERENCE §1).

---

## 0. Pick the path

| Path | When | Build happens | Registry needed |
|---|---|---|---|
| **A. Registry path** (recommended manual) | Normal manual release; same artifacts CI would produce | on your laptop, pushed to GHCR | yes (GHCR + a read/write token) |
| **B. Image-transfer path** | No registry access / GitHub down | on your laptop, streamed over SSH | no |
| **C. Build-on-server path** | Quick personal box, no TLS proxy/registry | on the server (root `docker-compose.yml`) | no — follow [DEPLOYMENT.md](DEPLOYMENT.md) |

Sections 1–4 (one-time provisioning) are shared by A and B. Section 5 is the release itself.

---

## 1. One-time: create the infrastructure (DigitalOcean console)

1. **Project** — create "MyBudget".
2. **Droplet** — Ubuntu 24.04 LTS · region **BLR1** · Basic 1 vCPU / 2 GB / 50 GB · enable **Monitoring** and **Backups** (weekly) · authentication: your **SSH key** (not a password) · name `mybudget-prod`.
3. **Reserved IP** — Networking → Reserved IPs → assign to `mybudget-prod`. Write it down in INFRASTRUCTURE_REFERENCE §1.
4. **Cloud Firewall** `mybudget-prod-fw` → apply to the Droplet:
   - Inbound: TCP 22, TCP 80, TCP 443, UDP 443 — from all IPv4/IPv6.
   - Outbound: allow all.
5. **Spaces bucket** `mybudget-backups` (BLR1, private) + an access key limited to that bucket.
6. **DNS** — at your DNS host create:

   | Type | Name | Value |
   |---|---|---|
   | A | `@` | `<RESERVED_IP>` |
   | A | `www` | `<RESERVED_IP>` |
   | CAA | `@` | `0 issue "letsencrypt.org"` |

   Check from your laptop before continuing (Caddy can only obtain certificates once these resolve):

   ```bash
   dig +short prapanji.in
   dig +short www.prapanji.in
   ```

---

## 2. One-time: bootstrap the Droplet

SSH in as root with your key: `ssh root@<RESERVED_IP>`.

```bash
# Docker first (creates the 'docker' group)
curl -fsSL https://get.docker.com | sh
docker compose version        # the Compose plugin must be present

# Deployment user: docker group, no sudo, no password
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys     # your personal key
chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

# Hardening
apt-get update && apt-get install -y fail2ban unattended-upgrades
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh

# 2 GB swap
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# App directory
mkdir -p /opt/mybudget/backups && chown -R deploy:deploy /opt/mybudget
```

**Before closing the root session**, open a second terminal and confirm `ssh deploy@<RESERVED_IP>` works and `docker ps` runs without sudo. Then exit root.

(If you also want CI to deploy later: generate a dedicated key `ssh-keygen -t ed25519 -C "github-actions-deploy@prapanji.in" -f mybudget_deploy -N ""`, append `mybudget_deploy.pub` to `/home/deploy/.ssh/authorized_keys`, and store the private key as the `DEPLOY_SSH_KEY` environment secret — see DEPLOYMENT_DIGITALOCEAN §3.4–3.5.)

---

## 3. One-time: create the secrets file

```bash
deploy@droplet$ cd /opt/mybudget
deploy@droplet$ umask 077
deploy@droplet$ cat > .env <<EOF
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_ACCESS_SECRET=$(openssl rand -hex 32)
JWT_REFRESH_SECRET=$(openssl rand -hex 32)
EOF
deploy@droplet$ chmod 600 .env && ls -l .env      # -rw------- deploy deploy
```

Rules the server enforces in production: the two JWT secrets must differ and be ≥ 32 characters (hex of 32 bytes = 64, fine). Use hex for the DB password so it is URL-safe inside `DATABASE_URL`.

Optional — e-mail (password reset, e-mail confirmation, nightly digest). Append to `.env`; without it those e-mails are **not sent**:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char Google app password>
SMTP_FROM="My Budget <you@gmail.com>"
```

Back this file up somewhere safe (password manager). Losing `POSTGRES_PASSWORD` after the volume exists means resetting it inside Postgres; losing the JWT secrets only logs users out.

---

## 4. One-time: get the deployment files onto the Droplet

From a checkout of `main` on your laptop:

```bash
$ scp deploy/docker-compose.prod.yml deploy/Caddyfile deploy/remote-deploy.sh deploy@<RESERVED_IP>:/opt/mybudget/
```

---

## 5. Release procedure

### 5.0 Pre-flight (every release)

```bash
$ git checkout main && git pull
$ git log -1 --format=%H            # the full 40-char SHA = the release tag
$ npm run verify                    # client + server typecheck & tests (needs local Postgres: docker compose up -d postgres)
```

Taking a database backup first is cheap insurance, **mandatory** if the release adds a migration (look at `server/drizzle/` for new `.sql` files since the last release). Skip it on the very first deploy — there is no database yet, and `release.env` doesn't exist:

```bash
deploy@droplet$ cd /opt/mybudget
deploy@droplet$ docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env exec -T postgres \
                  pg_dump -U mybudget -d mybudget --format=custom > backups/pre-release_$(date +%F_%H%M).dump
```

Set a shell variable for the tag (used below):

```bash
$ TAG=$(git rev-parse HEAD)
```

### 5A. Registry path

1. **Build and push** (from the repo root on your laptop; the web image bakes in the API URL):

   ```bash
   $ echo "$GHCR_PAT" | docker login ghcr.io -u rangnenwars --password-stdin     # PAT with write:packages
   $ docker build -t ghcr.io/rangnenwars/mybudget-web:$TAG \
       --build-arg EXPO_PUBLIC_API_URL=https://prapanji.in/api/v1 .
   $ docker build -f server/Dockerfile -t ghcr.io/rangnenwars/mybudget-server:$TAG .
   $ docker push ghcr.io/rangnenwars/mybudget-web:$TAG
   $ docker push ghcr.io/rangnenwars/mybudget-server:$TAG
   ```

2. **Roll out** — `remote-deploy.sh` expects the registry token on stdin (so it never lands in `ps` or shell history). Use a PAT (or the CI token) with `read:packages`:

   ```bash
   $ echo "$GHCR_READ_PAT" | ssh deploy@<RESERVED_IP> "bash /opt/mybudget/remote-deploy.sh $TAG rangnenwars"
   ```

   What the script does, in order: `docker login ghcr.io` → writes `release.env.next` → **pulls first** (a failed pull leaves the running release untouched) → copies the current `release.env` to `release.env.prev` → moves `release.env.next` into place → `docker compose … up -d --remove-orphans --wait --wait-timeout 180` → prunes images older than 7 days → appends to `deploy-history.log`.

### 5B. Image-transfer path (no registry)

```bash
$ docker build -t ghcr.io/rangnenwars/mybudget-web:$TAG --build-arg EXPO_PUBLIC_API_URL=https://prapanji.in/api/v1 .
$ docker build -f server/Dockerfile -t ghcr.io/rangnenwars/mybudget-server:$TAG .
$ docker save ghcr.io/rangnenwars/mybudget-web:$TAG ghcr.io/rangnenwars/mybudget-server:$TAG \
    | gzip | ssh deploy@<RESERVED_IP> "gunzip | docker load"
```

Then on the Droplet (skip `remote-deploy.sh` — it would try to `pull`):

```bash
deploy@droplet$ cd /opt/mybudget
deploy@droplet$ [ -f release.env ] && cp release.env release.env.prev
deploy@droplet$ echo "IMAGE_TAG=<the TAG value>" > release.env
deploy@droplet$ docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env up -d --remove-orphans --wait --wait-timeout 180
deploy@droplet$ echo "$(date -Iseconds) <TAG>" >> deploy-history.log
```

### 5.1 Verify the release

```bash
$ curl -fsS https://prapanji.in/health            # {"status":"ok"} — also proves the API can reach Postgres
$ curl -fsSI https://prapanji.in/ | head -3       # 200, with Strict-Transport-Security
$ curl -sI http://prapanji.in | head -3           # 301/308 → https
$ curl -sI https://www.prapanji.in | head -3      # 301 → https://prapanji.in
```

```bash
deploy@droplet$ alias dc='docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env'
deploy@droplet$ dc ps                  # caddy, web, server, postgres all running; server + postgres "healthy"
deploy@droplet$ dc logs --tail=50 server   # "Running migrations…", "Seeding categories…", "Skipping demo accounts.", then listening
deploy@droplet$ cat release.env deploy-history.log | tail -3
```

Open https://prapanji.in in a browser, register/sign in, add a transaction.

### 5.2 First-ever deployment only: create the first admin

The user table starts empty in production (demo accounts are not seeded).

1. Register your own account in the app at https://prapanji.in/register.
2. Promote it (one of the two — they do the same thing):

   ```bash
   deploy@droplet$ dc exec server npx tsx src/db/create-admin.ts you@example.com
   ```

   or with SQL — see [DB_ADMIN_QUERIES.md §2](DB_ADMIN_QUERIES.md#2-make-a-user-admin-support-or-system-manager).
3. Sign out and back in; the shield icon on the Dashboard opens the Admin screen.
4. Confirm no demo accounts exist (DB_ADMIN_QUERIES §1) and ports 5432/4000/8080 are closed: `nmap -Pn prapanji.in` shows only 80/443 (22 per the firewall).

### 5.3 One-off data migration: private categories (run once per database)

The release that trimmed `constants/categories.ts` removed 21 personal categories from the list every user sees. Existing databases still hold them, and users' transactions point at them, so after deploying that release run `server/scripts/privatize-personal-categories.sql` once. For each user who actually used one of them it creates a **private** copy (same label, icon, colour and group), re-points that user's transactions, repeating entries and budgets, then deletes the shared rows. No amounts or dates change, and a second run does nothing. Take a backup first.

```bash
deploy@droplet$ cd /opt/mybudget && alias dc='docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env'
deploy@droplet$ # copy server/scripts/privatize-personal-categories.sql to the Droplet first (scp), then:
deploy@droplet$ dc exec -T postgres psql -U mybudget -d mybudget -v ON_ERROR_STOP=1 < privatize-personal-categories.sql
```

Run it **after** the new image is live. If you run it before, the next server start re-seeds the old rows. Verify: `SELECT count(*) FROM categories WHERE user_id IS NULL;` returns 45.

---

## 6. Rollback

Rollback restores **code**, not **schema**. Migrations are additive and the previous image must still run against the newer schema; if a release shipped a destructive migration, restore the pre-release dump (§8) instead.

**Fast rollback (the previous release):**

```bash
deploy@droplet$ cd /opt/mybudget
deploy@droplet$ cp release.env.prev release.env
deploy@droplet$ docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env up -d --wait --wait-timeout 180
deploy@droplet$ cat release.env
```

**Rollback to a specific older release:** pick the SHA from `deploy-history.log`, check the images still exist (`docker image ls | grep mybudget` — images are kept 7 days; otherwise they are re-pulled from GHCR), then `echo "IMAGE_TAG=<sha>" > release.env` and run the same `up -d` line. (With CI available you can instead run Actions → *deploy* → *Run workflow* → `image_tag`.)

---

## 7. Everyday operations

All commands from `/opt/mybudget` with `alias dc='docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env'`.

| Task | Command |
|---|---|
| Status | `dc ps` |
| API logs (follow) | `dc logs -f server` |
| Caddy / TLS logs | `dc logs --tail=100 caddy` |
| Restart one service | `dc restart server` |
| Apply changed `.env` | edit `.env` → `dc up -d` (containers with changed variables are recreated) |
| SQL shell | `dc exec postgres psql -U mybudget -d mybudget` |
| Run one SQL statement | `dc exec -T postgres psql -U mybudget -d mybudget -c "SELECT count(*) FROM users;"` |
| Promote an admin | `dc exec server npx tsx src/db/create-admin.ts <email>` |
| Print issue-report analysis | `dc exec server npm run issues:analyze` |
| Dry-run the nightly digest | `dc exec server npm run issues:digest -- --dry-run` |
| Disk / memory | `df -h /` · `free -m` · `docker system df` |
| Reclaim image space | `docker image prune -af --filter "until=168h"` |
| OS patching | automatic (unattended-upgrades); `sudo reboot` monthly — containers have `restart: unless-stopped` (needs a sudo-capable user; `deploy` has none — use your admin login) |

**Rotate secrets:** edit `/opt/mybudget/.env`, then `dc up -d`. Rotating `JWT_*` logs every user out. Rotating `POSTGRES_PASSWORD` requires `ALTER USER mybudget PASSWORD '<new>';` inside Postgres **before** changing `.env`.

**Change a runtime setting** (e.g. enable the nightly digest, allow "Try Pro"): add the variable under `server.environment` in `deploy/docker-compose.prod.yml` (and its value to `.env` if secret), commit, then redeploy (CI copies the file) or `scp` it and run `dc up -d`. See INFRASTRUCTURE_REFERENCE §6 for the list of unwired variables.

---

## 8. Backups and restore

**Nightly dump + off-box copy** (as `deploy`, `crontab -e`; copy `server/scripts/backup-db.sh` to `/opt/mybudget/backup-db.sh` and `chmod +x` it first):

```cron
15 2 * * * DB_CONTAINER_NAME=mybudget-postgres-1 BACKUP_DIR=/opt/mybudget/backups RETENTION_DAYS=14 /opt/mybudget/backup-db.sh && rclone copy /opt/mybudget/backups spaces:mybudget-backups/daily >> /opt/mybudget/backup.log 2>&1
```

Configure `rclone` once with the Spaces key (`rclone config`, provider "DigitalOcean Spaces", region `blr1`) and set a bucket lifecycle rule to expire objects after 90 days.

**On-demand backup:**

```bash
deploy@droplet$ DB_CONTAINER_NAME=mybudget-postgres-1 BACKUP_DIR=/opt/mybudget/backups /opt/mybudget/backup-db.sh
```

**Restore** (this **overwrites** current data — take a fresh backup first, and stop writers):

```bash
deploy@droplet$ dc stop server
deploy@droplet$ docker cp backups/mybudget_<timestamp>.dump mybudget-postgres-1:/tmp/restore.dump
deploy@droplet$ docker exec mybudget-postgres-1 pg_restore -U mybudget -d mybudget --clean --if-exists /tmp/restore.dump
deploy@droplet$ docker exec mybudget-postgres-1 rm -f /tmp/restore.dump
deploy@droplet$ dc start server && curl -fsS https://prapanji.in/health
```

**Drill:** once a quarter restore the latest dump into a throwaway Postgres container ([DATABASE_BACKUP.md](DATABASE_BACKUP.md)) and check `SELECT count(*) FROM users, transactions`. An untested backup is not a backup. The whole Droplet is additionally snapshotted weekly by DigitalOcean (whole-machine restore).

---

## 9. Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Browser shows a certificate error / Caddy keeps retrying | DNS not pointing at the reserved IP yet, or 80/443 blocked. `dig +short prapanji.in`; check the Cloud Firewall; `dc logs caddy`. |
| `502 Bad Gateway` on `/api/*` | `server` is down or still migrating. `dc ps`; `dc logs --tail=100 server`. |
| `server` restarts in a loop with "must be different random values…" or "Set CORS_ORIGIN…" | Production guard in `server/src/index.ts`: fix `JWT_*` in `.env` (≥ 32 chars, different) or `CORS_ORIGIN` in the compose file. |
| `server` logs `password authentication failed` | `POSTGRES_PASSWORD` in `.env` doesn't match the one the data volume was initialised with. Reset it inside Postgres (`ALTER USER`) or fix `.env`. |
| `/health` returns 503 `database unavailable` | Postgres not healthy: `dc logs postgres`; disk full (`df -h`). |
| Deploy fails at `pull` with `unauthorized` | GHCR token lacks `read:packages`, or the package name/owner is wrong. The running release is untouched. |
| `up -d --wait` times out | New image unhealthy → inspect `dc logs server`; roll back (§6). |
| Users can't sign in, "Invalid email or password" | Wrong password (case-sensitive). Reset: DB_ADMIN_QUERIES §5. Deactivated accounts get a 403, not this message. |
| No reset / confirmation e-mails | `SMTP_*` unset or wrong; `dc logs server | grep -i smtp`. |
| "Try Pro" returns 403 | Intended in production (`ALLOW_SELF_TIER_CHANGE` off). Grant Pro from the Admin screen or DB_ADMIN_QUERIES §3. |
| Web app calls `http://localhost:4000` in production | The web image was built without `EXPO_PUBLIC_API_URL`. Rebuild the web image with the build arg (§5A step 1) and redeploy. |
| Out of disk | `docker system df`; prune images; check `backups/` and Docker log rotation. |
