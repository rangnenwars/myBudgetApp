-- One-off data migration for the free-money day fixes.
--
-- Until this release the client saved a repeating Quarterly/Yearly bill at its
-- monthly equivalent (÷3 / ÷12), and the server then posted that divided
-- amount only once a quarter/year — so a ₹30,000 quarterly bill went in as
-- ₹10,000 every 3 months. The client now saves the full amount. This script
-- repairs the rules saved the old way, and the entries they already posted.
--
-- It only touches rows it can PROVE were divided: the note the app wrote
-- itself ("quarterly entry — original ₹30,000"), with the stored amount
-- matching that original ÷3 / ÷12 to within ₹1. Rules whose note the user
-- typed can't be told apart from correctly entered ones; they are listed at
-- the end (section 3) for a person to check, and are not changed.
--
-- Run ONCE per database, AFTER deploying the release (otherwise a not-yet-
-- updated client could keep creating divided rules). Safe to re-run: a fixed
-- rule's amount no longer matches its note ÷3 / ÷12, so it is skipped.
--
--   Production:  dc exec -T postgres psql -U mybudget -d mybudget -v ON_ERROR_STOP=1 < server/scripts/fix-repeating-bill-amounts.sql
--   Local:       docker exec -i mybudgetapp-postgres-1 psql -U mybudget -d mybudget -v ON_ERROR_STOP=1 < server/scripts/fix-repeating-bill-amounts.sql
--
-- Take a backup first. To rehearse, change the final COMMIT to ROLLBACK.

BEGIN;

-- 1. The rules to repair, with the full amount read back from the app's own note.
CREATE TEMP TABLE divided_rules ON COMMIT DROP AS
SELECT r.id, r.user_id, r.category_key, r.type, r.note,
       r.amount AS old_amount,
       regexp_replace(substring(r.note FROM 'original ₹([0-9,.]+)'), ',', '', 'g')::numeric AS full_amount,
       CASE r.frequency WHEN 'quarterly' THEN 3 ELSE 12 END AS months
FROM recurring_transactions r
WHERE r.frequency IN ('quarterly', 'yearly')
  AND r.note ~ ('^' || r.frequency || ' entry — original ₹[0-9,.]+$');

DELETE FROM divided_rules WHERE abs(full_amount - old_amount * months) > 1;

SELECT id AS rule_id, user_id, category_key, old_amount, full_amount FROM divided_rules ORDER BY user_id, id;

-- 2. Entries already posted by those rules (and the original entry the rule was
--    made from): same user, category, type, note and divided amount.
UPDATE transactions t
SET amount = d.full_amount
FROM divided_rules d
WHERE t.user_id = d.user_id
  AND t.category_key = d.category_key
  AND t.type = d.type
  AND t.note = d.note
  AND t.amount = d.old_amount;

UPDATE recurring_transactions r
SET amount = d.full_amount, updated_at = now()
FROM divided_rules d
WHERE r.id = d.id;

-- 3. For a person to check (not changed): other Quarterly/Yearly rules. If the
--    amount is a third / twelfth of the real bill, fix it in the app
--    (Transactions → Repeating → edit the amount).
SELECT r.id AS rule_id, r.user_id, u.email, r.frequency, r.amount, r.note
FROM recurring_transactions r
JOIN users u ON u.id = r.user_id
WHERE r.frequency IN ('quarterly', 'yearly')
  AND r.id NOT IN (SELECT id FROM divided_rules)
ORDER BY r.user_id, r.id;

-- 4. For a person to check (not changed): repeating Loan EMI entries, which
--    can no longer be created. If the same user also has the loan under Loans
--    with "Add monthly EMI to expenses" on, the EMI is being posted twice —
--    stop the repeating one in the app (Transactions → Repeating → Stop).
SELECT r.id AS rule_id, r.user_id, u.email, r.amount, r.note,
       (SELECT string_agg(l.name || ' (EMI ' || l.emi || CASE WHEN l.counts_as_expense THEN ', auto-posted' ELSE '' END || ')', '; ')
          FROM loans l WHERE l.user_id = r.user_id AND l.is_active) AS active_loans
FROM recurring_transactions r
JOIN users u ON u.id = r.user_id
WHERE r.category_key = 'loan_emi'
ORDER BY r.user_id, r.id;

COMMIT;
