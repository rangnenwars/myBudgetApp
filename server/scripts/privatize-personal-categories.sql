-- One-off data migration: turn the personal categories that used to be seeded for
-- everyone into PRIVATE custom categories owned by each user who actually used
-- them, then delete the shared rows. Nothing a user recorded is lost or changed:
-- same label, icon, colour and group (so loan / investment buckets still work),
-- same transactions, repeating entries and budgets, just re-pointed to the copy.
--
-- Run ONCE per database, AFTER deploying the release that trimmed
-- constants/categories.ts (otherwise the next server start re-seeds the old rows
-- as soon as they are deleted). Safe to re-run: a second run finds nothing to do.
--
--   Production:  dc exec -T postgres psql -U mybudget -d mybudget -v ON_ERROR_STOP=1 < server/scripts/privatize-personal-categories.sql
--   Local:       docker exec -i mybudgetapp-postgres-1 psql -U mybudget -d mybudget -v ON_ERROR_STOP=1 < server/scripts/privatize-personal-categories.sql
--
-- Take a backup first. To rehearse, change the final COMMIT to ROLLBACK.

BEGIN;

CREATE TEMP TABLE personal_keys (key text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO personal_keys (key) VALUES
  ('rashmi_darsh'), ('rashmi_contribution_exp'), ('rashmi_contribution_inc'),
  ('kunal'), ('gajanan_b'), ('thotawar_inc'), ('gaju_sasur'),
  ('home_loan_1'), ('home_loan_2'), ('home_loan_3_4'), ('personal_car_loan'),
  ('hdfc_cc'), ('sbi_cc'), ('kotak_cc'), ('icici_cc'),
  ('mandawa_kinwat_maintenance'), ('rs605_expenses'),
  ('hyd_bc'), ('self_bc'), ('kinwat_bc'), ('dalappu');

-- (user, personal category) pairs that are actually in use
CREATE TEMP TABLE used_pairs ON COMMIT DROP AS
  SELECT user_id, category_key AS old_key FROM transactions
  UNION SELECT user_id, category_key FROM recurring_transactions
  UNION SELECT user_id, category_key FROM budgets;
DELETE FROM used_pairs WHERE old_key NOT IN (SELECT key FROM personal_keys);

-- 1. private copy per pair; key has the same custom_xxxxxxxx shape the app generates
CREATE TEMP TABLE key_map ON COMMIT DROP AS
  SELECT p.user_id, p.old_key,
         'custom_' || substr(md5(p.user_id::text || ':' || p.old_key), 1, 8) AS new_key
  FROM used_pairs p;

INSERT INTO categories (key, label, icon, color, "group", type, user_id)
SELECT m.new_key, c.label, c.icon, c.color, c."group", c.type, m.user_id
FROM key_map m JOIN categories c ON c.key = m.old_key AND c.user_id IS NULL
ON CONFLICT (key) DO NOTHING;

-- 2. re-point the user's own rows
UPDATE transactions t SET category_key = m.new_key
FROM key_map m WHERE t.user_id = m.user_id AND t.category_key = m.old_key;

UPDATE recurring_transactions r SET category_key = m.new_key
FROM key_map m WHERE r.user_id = m.user_id AND r.category_key = m.old_key;

UPDATE budgets b SET category_key = m.new_key
FROM key_map m WHERE b.user_id = m.user_id AND b.category_key = m.old_key;

-- 3. remove the shared rows (fails loudly on a foreign key if anything was missed)
DELETE FROM categories WHERE user_id IS NULL AND key IN (SELECT key FROM personal_keys);

-- 4. generic wording for the two lending categories that stay (old label listed real names)
UPDATE categories SET label = 'Money lent'          WHERE key = 'lending_given'    AND user_id IS NULL;
UPDATE categories SET label = 'Money received back' WHERE key = 'lending_received' AND user_id IS NULL;

-- report
SELECT (SELECT count(*) FROM key_map)                                  AS private_copies_made,
       (SELECT count(*) FROM categories WHERE user_id IS NULL)         AS system_categories_left,
       (SELECT count(*) FROM categories WHERE user_id IS NOT NULL)     AS custom_categories_total;

COMMIT;
