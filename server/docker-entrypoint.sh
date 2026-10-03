#!/bin/sh
set -e

echo "Running migrations..."
npx tsx src/db/migrate.ts

echo "Seeding categories..."
npx tsx src/db/seed-categories.ts

# Demo accounts have passwords published in the docs — local only.
# Production sets SEED_DEMO_ACCOUNTS=false (and seed-accounts.ts also refuses
# to run under NODE_ENV=production).
if [ "${SEED_DEMO_ACCOUNTS:-true}" = "true" ] && [ "${NODE_ENV}" != "production" ]; then
  echo "Seeding demo accounts..."
  npx tsx src/db/seed-accounts.ts
else
  echo "Skipping demo accounts."
fi

echo "Starting server..."
exec npx tsx src/index.ts
