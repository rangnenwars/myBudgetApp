#!/bin/sh
# One command for every check, with short output. Details are printed only when something fails.
#
#   npm run check          everything: types, app tests, server tests (starts Postgres if needed)
#   npm run check:fast     types and app tests only. No database needed. About 30 seconds.
#   npm run check:docker   everything, then a Docker build (which runs the checks again inside it)
#
# The same checks run automatically before every commit (.husky/pre-commit)
# and inside every `docker compose build` (see Dockerfile and server/Dockerfile).

MODE="${1:-full}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$(mktemp)"
START=$(date +%s)
FAILED=0

step() {
  # step "label" "directory" command...
  label="$1"; dir="$2"; shift 2
  printf '%-34s' "$label"
  s=$(date +%s)
  if (cd "$dir" && "$@") > "$LOG" 2>&1; then
    printf 'ok   (%ss)' $(( $(date +%s) - s ))
    # Show the one line that matters from a test run, e.g. "Tests: 655 passed, 655 total".
    summary=$(grep -E '^Tests:' "$LOG" | tail -1)
    [ -n "$summary" ] && printf '   %s' "$summary"
    printf '\n'
  else
    printf 'FAILED\n\n'
    echo "---- what failed (more in the full log: $LOG) ----"
    grep -E '●|error TS|FAIL |Expected|Received|threshold|Tests:' "$LOG" | sed 's/\x1b\[[0-9;]*m//g' | head -40
    echo "-----------------------------------------------"
    FAILED=1
  fi
}

case "$MODE" in
  fast|full|docker) ;;
  *) echo "Usage: scripts/check.sh [fast|full|docker]"; exit 2 ;;
esac

echo "Prapanji checks ($MODE)"
echo "----------------------------------------"
step "App: type check"           "$ROOT"        npm run --silent typecheck
step "App: tests and coverage"   "$ROOT"        npx jest --coverage --coverageReporters=text-summary

if [ "$MODE" != "fast" ]; then
  step "Server: type check"      "$ROOT/server" npm run --silent typecheck

  if ! (cd "$ROOT/server" && node -e "require('pg')" >/dev/null 2>&1); then
    echo "Server dependencies are missing. Run: (cd server && npm ci)"; exit 1
  fi
  # The server tests use a real Postgres. If the database in server/.env answers, use it;
  # otherwise start the one from docker-compose.
  db_up() { (cd "$ROOT/server" && node -e "require('dotenv/config');const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:3000});c.connect().then(()=>c.end()).then(()=>process.exit(0),()=>process.exit(1))") >/dev/null 2>&1; }
  if ! db_up; then
    printf '%-34s' "Database: starting Postgres"
    if (cd "$ROOT" && docker compose up -d --wait postgres) > "$LOG" 2>&1 && db_up; then echo "ok"; else echo "FAILED"; tail -15 "$LOG"; echo "Start it with: docker compose up -d postgres"; exit 1; fi
  fi
  step "Server: tests and coverage" "$ROOT/server" npx jest --coverage --coverageReporters=text-summary --ci
fi

if [ "$MODE" = "docker" ] && [ "$FAILED" = "0" ]; then
  step "Docker: build (runs checks)" "$ROOT"     docker compose build
fi

echo "----------------------------------------"
if [ "$FAILED" = "0" ]; then
  echo "ALL CHECKS PASSED in $(( $(date +%s) - START ))s"
  rm -f "$LOG"
  exit 0
fi
echo "CHECKS FAILED in $(( $(date +%s) - START ))s"
exit 1
