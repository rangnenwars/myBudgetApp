#!/usr/bin/env bash
# Dumps the mybudget Postgres database to a timestamped, restorable archive.
# Runs against the postgres container in docker-compose.yml, so it works
# unattended on whatever host is running the stack (cron on Linux, Task
# Scheduler + Git Bash/WSL on Windows). Old dumps beyond RETENTION_DAYS are
# pruned automatically.
set -euo pipefail

CONTAINER_NAME="${DB_CONTAINER_NAME:-mybudgetapp-postgres-1}"
DB_USER="${POSTGRES_USER:-mybudget}"
DB_NAME="${POSTGRES_DB:-mybudget}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/../../backups}"
mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

log() { echo "[$(date -Iseconds)] $*"; }

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  log "ERROR: container '$CONTAINER_NAME' is not running. Aborting backup."
  exit 1
fi

timestamp="$(date +%Y-%m-%d_%H%M%S)"
remote_tmp="/tmp/mybudget_backup_${timestamp}.dump"
dump_file="$BACKUP_DIR/mybudget_${timestamp}.dump"

log "Starting backup of '$DB_NAME' from container '$CONTAINER_NAME'..."


# MSYS_NO_PATHCONV avoids Git Bash on Windows rewriting the container-side
# /tmp path into a host Windows path; scoped to these two calls only, since
# it would otherwise break the host-side path in the `docker cp` below.
# Harmless no-op on Linux/macOS.
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --file="$remote_tmp"
docker cp "$CONTAINER_NAME:$remote_tmp" "$dump_file"
MSYS_NO_PATHCONV=1 docker exec "$CONTAINER_NAME" rm -f "$remote_tmp"

if [ ! -s "$dump_file" ]; then
  log "ERROR: backup file is missing or empty: $dump_file"
  exit 1
fi

log "Backup saved: $dump_file ($(du -h "$dump_file" | cut -f1))"

deleted=$(find "$BACKUP_DIR" -name 'mybudget_*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete)
if [ -n "$deleted" ]; then
  log "Pruned backups older than ${RETENTION_DAYS} days:"
  echo "$deleted"
fi

log "Backup complete."
