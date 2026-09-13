#!/bin/sh
# Rebuild the Docker stack and confirm it's healthy, terse output.
#
# Why this exists: `docker compose up --build` prints the full npm install +
# Metro bundler + image-layer log every time (100+ lines), most of which is
# irrelevant unless the build actually fails. This keeps that noise out of
# the caller's context and just reports pass/fail + final container status.
#
# Usage: scripts/docker-verify.sh   (from repo root)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_LOG="$(mktemp)"

echo "Rebuilding stack..."
if ! (cd "$ROOT" && docker compose up --build -d) > "$BUILD_LOG" 2>&1; then
  echo "BUILD FAILED — last 60 lines:"
  tail -60 "$BUILD_LOG"
  exit 1
fi
rm -f "$BUILD_LOG"

echo "Waiting for the server to finish migrating/seeding and come up..."
READY=0
for i in $(seq 1 15); do
  if curl -sf http://localhost:4000/health > /dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done

echo "--- Container status ---"
docker ps --format "{{.Names}}: {{.Status}}"

if [ "$READY" != "1" ]; then
  echo "HEALTH CHECK FAILED — server not responding on :4000 after 30s. Recent server logs:"
  docker logs mybudgetapp-server-1 --tail 20
  exit 1
fi

echo "--- Health check ---"
curl -sf http://localhost:4000/health
echo ""
echo "DOCKER STACK READY"
