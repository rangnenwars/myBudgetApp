@echo off
REM Wrapper so Windows Task Scheduler can invoke the bash backup script
REM without dealing with nested-quote escaping in schtasks /TR.
"C:\Program Files\Git\bin\bash.exe" -lc "RETENTION_DAYS=60 D:/MyBudgetApp/server/scripts/backup-db.sh >> D:/MyBudgetApp/backups/backup.log 2>&1"
