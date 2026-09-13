#!/bin/sh
# Prints a fresh access token for the given account — the login+parse
# boilerplate that got retyped as a multi-line curl-then-node-one-liner
# combo half a dozen times this session for ad-hoc API testing.
#
# Usage:
#   TOKEN=$(scripts/get-token.sh user@mybudget.local User@12345)
#   curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/transactions
#
# Defaults to the seeded demo user if no args given.

EMAIL="${1:-user@mybudget.local}"
PASSWORD="${2:-User@12345}"
BASE_URL="${MYBUDGET_API_URL:-http://localhost:4000/api/v1}"

curl -sf -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);if(!r.accessToken){console.error(JSON.stringify(r));process.exit(1);}console.log(r.accessToken);})"
