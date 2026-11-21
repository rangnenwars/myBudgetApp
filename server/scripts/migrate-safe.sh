#!/usr/bin/env bash
# One command for a release's database changes: back up, apply any pending migrations, then check that every
# result is really in place. Stops at the first problem and says how to go back.
#
#   server/scripts/migrate-safe.sh            run inside the running server container (after the new image is up)
#   server/scripts/migrate-safe.sh --local    run from a checkout, using DATABASE_URL in server/.env
#   server/scripts/migrate-safe.sh --dry-run  only show what is pending; changes nothing, no backup
#
# On the production Droplet, from /opt/mybudget, name the compose command (the runbook's `dc` alias):
#   COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env --env-file release.env" \n#     bash server/scripts/migrate-safe.sh
# (Run it after the new image is up: the old image does not have the db:plan command.)
# The backup then comes from `pg_dump` inside that stack's postgres, into ./backups/.
#
# Applying is idempotent: the server container does the same at every start, so running this again is harmless.
set -euo pipefail

MODE=docker
DRY=0
for arg in "$@"; do
  case "$arg" in
    --local) MODE=local ;;
    --dry-run) DRY=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log() { echo "[$(date +%H:%M:%S)] $*"; }

COMPOSE="${COMPOSE:-docker compose}"

run() {  # run an npm script of the server, wherever it lives
  if [ "$MODE" = docker ]; then $COMPOSE exec -T server npm run --silent "$@"; else (cd "$SCRIPT_DIR/.." && npm run --silent "$@"); fi
}

log "Where things stand:"
run db:plan -- status

if [ "$DRY" = 1 ]; then
  log "Dry run: nothing changed."
  exit 0
fi

log "Backing up first..."
if [ "$MODE" = docker ] && [ "$COMPOSE" != "docker compose" ]; then
  mkdir -p backups
  DUMP="backups/pre-migrate_$(date +%F_%H%M).dump"
  $COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER:-mybudget}" -d "${POSTGRES_DB:-mybudget}" --format=custom > "$DUMP"
  [ -s "$DUMP" ] || { log "Backup is empty. Stopping."; rm -f "$DUMP"; exit 1; }
  log "Backup written to $DUMP"
else
  "$SCRIPT_DIR/backup-db.sh"
fi

log "Applying pending migrations..."
if ! run db:migrate; then
  log "FAILED. Drizzle applies all pending migrations in one transaction, so the database is as it was."
  log "Read the error above. To go back to the backup: docs/DATABASE_BACKUP.md."
  exit 1
fi

log "Checking every result is in place..."
if ! run db:plan -- verify; then
  log "VERIFY FAILED. Do not carry on. To undo one migration and the newer ones:"
  log "  npm run db:plan -- rollback <migration tag> --yes     (see docs/MIGRATION_STEPS.md, section 7)"
  log "or restore the backup just taken (docs/DATABASE_BACKUP.md)."
  exit 1
fi

log "Done. Database is up to date and verified."
