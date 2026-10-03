#!/usr/bin/env bash
# Runs on the Droplet as `deploy`, invoked by .github/workflows/deploy.yml:
#   echo "$GHCR_TOKEN" | ssh deploy@<host> bash /opt/mybudget/remote-deploy.sh <image-tag> <ghcr-user>
# The registry token arrives on stdin so it never shows up in `ps` or shell history.
#
# Rollback by hand (no GitHub needed):
#   cd /opt/mybudget && cp release.env.prev release.env && \
#   docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env up -d --wait
set -euo pipefail

IMAGE_TAG="${1:?usage: remote-deploy.sh <image-tag> <ghcr-user>}"
GHCR_USER="${2:?usage: remote-deploy.sh <image-tag> <ghcr-user>}"
cd /opt/mybudget

compose() {
  local release_file="$1"; shift
  docker compose -f docker-compose.prod.yml --env-file .env --env-file "$release_file" "$@"
}

docker login ghcr.io -u "$GHCR_USER" --password-stdin
trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT

# Pull against a candidate file first, so a failed pull leaves release.env
# (what's actually running) untouched.
echo "IMAGE_TAG=$IMAGE_TAG" > release.env.next
compose release.env.next pull

if [ -f release.env ]; then cp release.env release.env.prev; fi
mv release.env.next release.env

# The server entrypoint runs migrations + category seed on start. --wait
# fails the deploy if any service doesn't reach running/healthy in time.
compose release.env up -d --remove-orphans --wait --wait-timeout 180
compose release.env ps

docker image prune -af --filter "until=168h"   # keep a week of old images for fast rollback
echo "$(date -Iseconds) $IMAGE_TAG" >> deploy-history.log
