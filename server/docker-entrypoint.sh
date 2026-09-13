#!/bin/sh
set -e

echo "Running migrations..."
npx tsx src/db/migrate.ts

echo "Seeding categories..."
npx tsx src/db/seed-categories.ts

echo "Seeding demo accounts..."
npx tsx src/db/seed-accounts.ts

echo "Starting server..."
exec npx tsx src/index.ts
