# Deploying My Budget to a Cloud Linux Server

Step-by-step guide for taking this repo from a laptop to a running instance on a Linux VPS (DigitalOcean, AWS EC2, Linode, Hetzner, etc.). It expands on [FAQ.md](FAQ.md) question 8 with concrete commands. Everything runs from the single `docker-compose.yml` at the repo root — three containers: `mybudget-web` (static build behind nginx), `server` (Express API), `postgres`.

> This app has not been load-tested. It's sized for personal/small-scale use (see [FAQ.md](FAQ.md) question 7 for hardware guidance). Follow the hardening steps in section 6 before exposing it to real users.

---

## 1. Provision the server

Any Linux VPS with Docker support works. A minimum viable box:

| Tier | vCPU | RAM | Disk |
|---|---|---|---|
| Personal / single household | 1 | 1 GB | 20 GB |
| Small multi-user (a few dozen accounts) | 2 | 2 GB | 40 GB |

Ubuntu 22.04 LTS or 24.04 LTS is assumed below; the steps are the same on Debian.

1. Create the VM with your cloud provider's console/CLI, choosing Ubuntu 22.04/24.04.
2. Point a DNS **A record** at the server's public IP if you have a domain (e.g. `budget.example.com`). Not required if you'll access it by IP.
3. SSH in as the default user (`ubuntu`, `root`, etc. depending on provider).

## 2. Harden basic access

```bash
# create a non-root sudo user (skip if the provider already gave you one)
adduser deploy
usermod -aG sudo deploy

# copy your SSH key across, then disable password + root login
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# firewall: only SSH, HTTP, HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Reconnect as `deploy` before closing the original session, to confirm SSH access still works.

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker          # or log out/in
docker compose version # confirm the Compose plugin is present
```

## 4. Get the code onto the server

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/rangnenwars/myBudgetApp.git
cd myBudgetApp
git checkout MyBudgetApp-B1
```

## 5. Configure environment variables

Two `.env` files, neither committed to git — copy from the checked-in examples and fill in **real, unique** secrets:

```bash
cp .env.example .env
cp server/.env.example server/.env

# generate two long random secrets
openssl rand -hex 32   # → paste as JWT_ACCESS_SECRET
openssl rand -hex 32   # → paste as JWT_REFRESH_SECRET (must differ from the access secret)
```

Edit both files (`nano .env`, `nano server/.env`) and set `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` to the generated values in **both files** (they must match — the server reads its own `server/.env`; the root `.env` is used by `docker-compose.yml`'s variable substitution). Never reuse the placeholder values from local dev.

`server/.env`'s `DATABASE_URL` can stay as the example's Docker-internal value — Compose points the `server` container at the `postgres` service on the internal network regardless of what host port is published.

## 6. Production hardening (do this before opening the firewall to real traffic)

These gaps are called out in [FAQ.md](FAQ.md) question 8 and are **not** optional for anything beyond a private/personal deployment:

1. **TLS.** Neither `nginx.conf` (port 80) nor the API (port 4000) terminates TLS. Put a reverse proxy with a real certificate in front — see section 7 for the two supported paths.
2. **Remove or change the seeded demo accounts.** `admin@mybudget.local` / `Admin@12345` and `user@mybudget.local` / `User@12345` are seeded automatically on first boot and their passwords are public in this repo's docs (see [FAQ.md](FAQ.md) question 10). Log in and change both passwords immediately, or delete the accounts via the Admin screen once you have a real admin account.
3. **Never publish the Postgres port.** The default `docker-compose.yml` maps `5433:5432` for local dev convenience. On a public server, remove that `ports:` mapping from the `postgres` service entirely — only the `server` container needs to reach it, over the internal Docker network at `postgres:5432`.
4. **Don't publish port 4000 either** once the reverse proxy is in place — the client should only ever talk to the proxy (port 80/443), which forwards `/api/` to the `server` container internally. Remove the `server` service's `ports:` mapping the same way.

## 7. Put a reverse proxy with TLS in front

Two options — pick one.

### Option A: Caddy (simplest — automatic Let's Encrypt, one file)

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Replace `/etc/caddy/Caddyfile` with:

```
budget.example.com {
    handle /api/* {
        reverse_proxy localhost:4000
    }
    handle {
        reverse_proxy localhost:8080
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy obtains and renews the certificate automatically the first time it starts, as long as DNS already points at the server and ports 80/443 are open.

### Option B: nginx + certbot (reuses the repo's existing `nginx.conf` pattern)

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Create `/etc/nginx/sites-available/mybudget`:

```nginx
server {
    listen 80;
    server_name budget.example.com;

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/mybudget /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d budget.example.com   # obtains cert, rewrites the block for HTTPS + auto-redirect
```

Certbot installs a systemd timer that renews the certificate automatically; no cron job needed.

With either option, after section 6 step 3–4 you've removed the direct `5433`/`4000`/`8080` host bindings other than what the proxy itself needs (`localhost:8080`, `localhost:4000` stay bound to loopback only — change `docker-compose.yml`'s `ports:` entries from `"8080:80"`/`"4000:4000"` to `"127.0.0.1:8080:80"`/`"127.0.0.1:4000:4000"` so they aren't reachable from outside the host at all).

## 8. Start the stack

```bash
docker compose up --build -d
docker compose ps          # all three should show "healthy"/"running"
curl -s http://localhost:4000/health   # or through the proxy: curl -s https://budget.example.com/api/health
```

First boot runs Postgres migrations, seeds the 61 system categories, and seeds the two demo accounts automatically (`server/docker-entrypoint.sh`) — this is why step 6.2 (changing those passwords) matters immediately after first login.

Open `https://budget.example.com` (or `http://<server-ip>:8080` if you skipped the reverse proxy for a private/internal deployment).

## 9. Ongoing operations

**Logs:**
```bash
docker compose logs -f server      # API logs
docker compose logs -f postgres
```

**Updating to a new commit:**
```bash
git pull
docker compose up --build -d       # rebuilds changed images, restarts affected containers, migrations re-run automatically
```

**Backups:** see [DATABASE_BACKUP.md](DATABASE_BACKUP.md) for the `server/scripts/backup-db.sh` script and restore procedure. Schedule it via cron on the host, e.g. nightly:
```bash
crontab -e
# 0 3 * * * cd /home/deploy/myBudgetApp && ./server/scripts/backup-db.sh
```

**Restart on host reboot:** `restart: unless-stopped` is already set on every service in `docker-compose.yml`, and Docker's own systemd unit is enabled by default after `get.docker.com` install — containers come back up automatically after a server reboot with no extra configuration.

**Splitting the database onto a managed Postgres service instead:** point `DATABASE_URL` in `server/.env` at the managed instance's connection string and delete the `postgres` service from `docker-compose.yml` (see [FAQ.md](FAQ.md) question 8). Everything else is unchanged.
