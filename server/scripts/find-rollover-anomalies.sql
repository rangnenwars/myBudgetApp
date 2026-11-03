-- READ-ONLY report: finds transactions that look wrong or repeated around a
-- month rollover (default: October -> November 2026). It changes nothing.
--
--   Production:  dc exec -T postgres psql -U mybudget -d mybudget -v ON_ERROR_STOP=1 \
--                  -v from=2026-10-01 -v to=2026-12-01 < server/scripts/find-rollover-anomalies.sql
--   Local:       docker exec -i mybudgetapp-postgres-1 psql -U mybudget -d mybudget -v ON_ERROR_STOP=1 \
--                  -v from=2026-10-01 -v to=2026-12-01 < server/scripts/find-rollover-anomalies.sql
--
-- `from` is inclusive, `to` is exclusive. The output shows user ids and
-- amounts only (no names or emails): look a person up, and their data, only
-- with their consent (see DB_ADMIN_QUERIES.md, Privacy).
--
-- Every row is a SUSPECT, not a verdict. Two identical entries can be real (two
-- chai at ₹20). Check each against what the user says before deleting.

\set ON_ERROR_STOP on
BEGIN READ ONLY;
\pset null '-'

\echo
\echo '== A1. A loan EMI posted more than once for the same loan and month =='
\echo '   Cause: a repeating Loan EMI rule (before it was blocked) on top of the loan''s own auto-post, or the user added the EMI by hand too.'
SELECT user_id, year, month, note,
       count(*) AS times, sum(amount) AS total,
       array_agg(id ORDER BY id) AS ids, array_agg(amount ORDER BY id) AS amounts,
       array_agg(date ORDER BY id) AS dates, array_agg(created_at::date ORDER BY id) AS created_on
FROM transactions
WHERE category_key = 'loan_emi' AND date >= :'from' AND date < :'to'
GROUP BY user_id, year, month, note
HAVING count(*) > 1
ORDER BY user_id, year, month;

\echo
\echo '== A2. Repeating rules on the Loan EMI category (should not exist any more) =='
SELECT r.id AS rule_id, r.user_id, r.amount, r.frequency, r.day_of_month, r.note, r.posted_through, r.next_due,
       (SELECT string_agg(l.name || ' (EMI ' || l.emi || CASE WHEN l.counts_as_expense THEN ', auto-posted' ELSE ', not auto-posted' END || ')', '; ')
          FROM loans l WHERE l.user_id = r.user_id AND l.is_active) AS users_active_loans
FROM recurring_transactions r
WHERE r.category_key = 'loan_emi'
ORDER BY r.user_id, r.id;

\echo
\echo '== A3. A repeating rule posted AND the user also entered the same bill that month =='
\echo '   Same user, category, type and amount as an active rule, more than once in a month.'
SELECT r.id AS rule_id, r.user_id, r.category_key, r.amount, r.frequency, r.note AS rule_note,
       to_char(t.date, 'YYYY-MM') AS month, count(*) AS entries,
       array_agg(t.id ORDER BY t.id) AS ids, array_agg(t.date ORDER BY t.id) AS dates,
       array_agg(coalesce(t.note, '') ORDER BY t.id) AS notes,
       array_agg(t.created_at::date ORDER BY t.id) AS created_on
FROM recurring_transactions r
JOIN transactions t
  ON t.user_id = r.user_id AND t.category_key = r.category_key AND t.type = r.type AND t.amount = r.amount
WHERE t.date >= :'from' AND t.date < :'to'
GROUP BY r.id, r.user_id, r.category_key, r.amount, r.frequency, r.note, to_char(t.date, 'YYYY-MM')
HAVING count(*) > 1
ORDER BY r.user_id, month;

\echo
\echo '== A4. Identical entries (user, date, category, type, amount, note) more than once =='
\echo '   Broad net: includes real repeats. created_on helps: an auto-posted row is created on the day the user next opened the app, not on its own date.'
SELECT user_id, date, category_key, type, amount, coalesce(note, '') AS note,
       count(*) AS times, array_agg(id ORDER BY id) AS ids, array_agg(created_at::date ORDER BY id) AS created_on
FROM transactions
WHERE date >= :'from' AND date < :'to'
GROUP BY user_id, date, category_key, type, amount, coalesce(note, '')
HAVING count(*) > 1
ORDER BY user_id, date, category_key;

\echo
\echo '== B1. Repeating rules whose schedule is out of step (next_due is not one period after posted_through) =='
SELECT id AS rule_id, user_id, category_key, amount, frequency, day_of_month, posted_through, next_due, ends_on
FROM recurring_transactions
WHERE date_trunc('month', next_due)::date
      <> (posted_through + (CASE frequency WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 ELSE 12 END) * interval '1 month')::date
ORDER BY user_id, id;

\echo
\echo '== B2. Auto-posted loans: posting marker vs the rows that exist for the last month in range =='
\echo '   rows = 0 with a current marker: the entry was deleted (it will not come back). rows > 1: duplicated. marker older than the month: the user has not opened the app since.'
SELECT l.id AS loan_id, l.user_id, l.name, l.emi, l.outstanding, l.emi_expensed_through,
       (SELECT count(*) FROM transactions t
         WHERE t.user_id = l.user_id AND t.category_key = 'loan_emi' AND t.note = 'EMI - ' || l.name
           AND t.date >= (date :'to' - interval '1 month')::date AND t.date < :'to') AS emi_rows_last_month
FROM loans l
WHERE l.counts_as_expense AND l.is_active AND l.outstanding > 0
  AND ( l.emi_expensed_through IS NULL
     OR l.emi_expensed_through < (date :'to' - interval '1 month')::date
     OR (SELECT count(*) FROM transactions t
          WHERE t.user_id = l.user_id AND t.category_key = 'loan_emi' AND t.note = 'EMI - ' || l.name
            AND t.date >= (date :'to' - interval '1 month')::date AND t.date < :'to') <> 1 )
ORDER BY l.user_id, l.id;

\echo
\echo '== C1. Entries dated with the UTC date instead of the India date (filed in the wrong day, maybe month) =='
\echo '   Created between 00:00 and 05:30 IST, when the UTC date is still yesterday. Only entries whose date equals the UTC date and differs from the IST date.'
SELECT id, user_id, date, category_key, type, amount, coalesce(note, '') AS note,
       created_at AT TIME ZONE 'Asia/Kolkata' AS created_ist,
       (created_at AT TIME ZONE 'Asia/Kolkata')::date AS ist_date
FROM transactions
WHERE date >= :'from' AND date < :'to'
  AND date = (created_at AT TIME ZONE 'UTC')::date
  AND date <> (created_at AT TIME ZONE 'Asia/Kolkata')::date
  AND category_key <> 'loan_emi' AND coalesce(note, '') NOT LIKE 'Repeats %'
ORDER BY user_id, created_at;

\echo
\echo '== D1. Entries dated INSIDE the range but created AFTER it ended (late posts, e.g. October rows created in November) =='
\echo '   Auto-posting happens on the first read, so a user who skipped October gets October EMIs/bills dated October when they next open the app. Closed-month totals can change that way.'
SELECT user_id, category_key, type,
       count(*) AS rows, sum(amount) AS total,
       min(date) AS first_date, max(date) AS last_date,
       min(created_at AT TIME ZONE 'Asia/Kolkata') AS first_created_ist
FROM transactions
WHERE date >= :'from' AND date < (date :'to' - interval '1 month')::date
  AND created_at >= (date :'to' - interval '1 month')::date
GROUP BY user_id, category_key, type
ORDER BY user_id, category_key;

\echo
\echo '== Summary: users with at least one finding in A1-A3 =='
SELECT count(DISTINCT user_id) AS users_with_duplicate_loan_emis
FROM (SELECT user_id FROM transactions
       WHERE category_key = 'loan_emi' AND date >= :'from' AND date < :'to'
       GROUP BY user_id, year, month, note HAVING count(*) > 1) s;

ROLLBACK;
