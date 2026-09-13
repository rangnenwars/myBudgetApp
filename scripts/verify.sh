#!/bin/sh
# One-shot quality gate for both client and server, terse output.
#
# Why this exists: running `npm run typecheck` + `npm run test:coverage`
# separately on both sides prints ~150 lines of coverage tables and test
# names every time — expensive to paste into an LLM's context turn after
# turn when all that's actually needed is "did it pass." This script
# redirects the noisy output to a log file and only surfaces it if
# something actually failed.
#
# Usage: scripts/verify.sh          (from repo root)

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT_LOG="$(mktemp)"
SERVER_LOG="$(mktemp)"

echo "Client: typecheck + tests..."
if ! (cd "$ROOT" && npm run quality) > "$CLIENT_LOG" 2>&1; then
  echo "CLIENT FAILED — last 40 lines:"
  tail -40 "$CLIENT_LOG"
  exit 1
fi
echo "Client: OK"

echo "Server: typecheck + tests..."
if ! (cd "$ROOT/server" && npm run quality) > "$SERVER_LOG" 2>&1; then
  echo "SERVER FAILED — last 40 lines:"
  tail -40 "$SERVER_LOG"
  exit 1
fi
echo "Server: OK"

rm -f "$CLIENT_LOG" "$SERVER_LOG"
echo "ALL CHECKS PASSED"
