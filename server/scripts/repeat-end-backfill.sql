-- One-off helper for repeating entries created BEFORE the "Ends on" feature
-- (migration 0021). Those rules keep posting exactly as before, and the app
-- shows "needs an end date" on them until the user chooses. The migration itself
-- changes no old data. Run this only if you'd rather settle them in bulk.
--
-- Run on the database host (see docs/OPERATIONS_RUNBOOK.md for `dc`), and take a
-- backup first (server/scripts/backup-db.sh):
--
--   1) Preview (changes nothing):
--      dc exec -T postgres psql -U mybudget -d mybudget -f - < server/scripts/repeat-end-backfill.sql
--
--   2) Apply one of the options by editing MODE below, then run again.
--
-- MODE:
--   'preview'   list the old rules that still need an end date (default)
--   'open'      keep every old rule running: mark it "No end date"
--   'months'    end every old rule MONTHS months from today
--
-- Only rules with no end choice yet are touched (ends_on IS NULL AND NOT no_end),
-- so it is safe to run twice and never overwrites a choice a user made in the app.

\set MODE 'preview'
\set MONTHS 12

BEGIN;

SELECT r.id, r.user_id, r.type, r.category_key, r.amount, r.frequency, r.day_of_month, r.next_due
FROM recurring_transactions r
WHERE r.ends_on IS NULL AND NOT r.no_end
ORDER BY r.user_id, r.id;

UPDATE recurring_transactions
SET no_end = true, updated_at = now()
WHERE :'MODE' = 'open' AND ends_on IS NULL AND NOT no_end;

UPDATE recurring_transactions
SET ends_on = (current_date + make_interval(months => :MONTHS))::date, updated_at = now()
WHERE :'MODE' = 'months' AND ends_on IS NULL AND NOT no_end;

SELECT count(*) FILTER (WHERE ends_on IS NULL AND NOT no_end) AS still_need_end_date,
       count(*) FILTER (WHERE no_end)                          AS open_ended,
       count(*) FILTER (WHERE ends_on IS NOT NULL)             AS with_end_date
FROM recurring_transactions;

-- In 'preview' mode neither UPDATE matches a row, so committing changes nothing.
COMMIT;
