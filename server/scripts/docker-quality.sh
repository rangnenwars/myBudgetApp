#!/bin/sh
# Runs inside `docker compose build` (the "quality" stage of server/Dockerfile).
# A build has no database, so it runs the server type check and the tests that need no
# database (access rules, clock, mail, issue analysis). The whole suite, including
# the database tests, runs with `npm run check` and before every commit; `npm run check:docker`
# runs that and then this build. (Starting a Postgres inside the build exhausted Docker's
# memory and crashed the build engine, so the build does not do that.)
#
# If anything fails, the build fails and no image is produced.
# Emergency skip only:  RUN_QUALITY=0 docker compose build
set -e

if [ "${RUN_QUALITY:-1}" = "0" ]; then
  echo "Quality checks SKIPPED (RUN_QUALITY=0)."
  touch /tmp/quality-passed
  exit 0
fi

echo "==> Server: type check"
npm run typecheck

echo "==> Server: tests that need no database"
# Any URL will do: these tests never connect. A dead one proves it.
export DATABASE_URL="postgres://nobody@127.0.0.1:1/none"
export JWT_ACCESS_SECRET="build-time-test-secret-access"
export JWT_REFRESH_SECRET="build-time-test-secret-refresh"
export NODE_ENV=test
npm run test:unit

echo "==> Server quality checks passed"
touch /tmp/quality-passed
