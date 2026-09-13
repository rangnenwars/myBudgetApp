# Database Backup & Restore

## Manual backup (run any time)

```bash
server/scripts/backup-db.sh
```

Run it from the project root (or with the full path) in Git Bash / any bash shell.
It dumps the `mybudget` Postgres database out of the running `mybudgetapp-postgres-1`
Docker container into `backups/mybudget_<timestamp>.dump`, using `pg_dump`'s custom
format (compressed, restorable with `pg_restore`).

Requirements: the `mybudgetapp-postgres-1` container must be running (`docker compose up`).

### Options (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DB_CONTAINER_NAME` | `mybudgetapp-postgres-1` | Container to dump from |
| `POSTGRES_USER` | `mybudget` | DB user |
| `POSTGRES_DB` | `mybudget` | DB name |
| `BACKUP_DIR` | `<repo>/backups` | Where dumps are written |
| `RETENTION_DAYS` | `30` | Dumps older than this are deleted after each run |

Example — one-off backup kept for a year, saved elsewhere:

```bash
RETENTION_DAYS=365 BACKUP_DIR=/d/other-location server/scripts/backup-db.sh
```

## Scheduled backup

A Windows Scheduled Task, **"MyBudgetApp DB Backup"**, runs this same script every
Sunday at 2:00 AM (`RETENTION_DAYS=60`) via `server/scripts/backup-db.bat`, logging to
`backups/backup.log`. Check/edit it with:

```bash
schtasks /Query /TN "MyBudgetApp DB Backup" /V /FO LIST
```

If the app moves to a Linux host, replace the Scheduled Task with a cron entry running
the same script, e.g.:

```
0 2 * * 0 RETENTION_DAYS=60 /path/to/MyBudgetApp/server/scripts/backup-db.sh >> /path/to/MyBudgetApp/backups/backup.log 2>&1
```

## Restore from a dump

```bash
docker exec -i mybudgetapp-postgres-1 pg_restore -U mybudget -d mybudget --clean --if-exists /path/to/mybudget_<timestamp>.dump
```

`--clean --if-exists` drops existing objects first, so this is safe to run against a
database that already has data in it (it will be overwritten). To restore into a
fresh/empty database instead, drop `--clean --if-exists`.

Note: `/path/to/...` above must be a path inside the container. If the dump file is
only on the host, copy it in first:

```bash
docker cp /path/to/mybudget_<timestamp>.dump mybudgetapp-postgres-1:/tmp/restore.dump
docker exec -i mybudgetapp-postgres-1 pg_restore -U mybudget -d mybudget --clean --if-exists /tmp/restore.dump
docker exec mybudgetapp-postgres-1 rm -f /tmp/restore.dump
```
