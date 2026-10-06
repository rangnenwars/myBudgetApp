-- Ownership integrity enforced by the database, not only by the routes.
--
-- 1. A goal contribution must belong to the same user as its goal.
--    The unique index must exist before the foreign key that references it.
--    NOT VALID: every new or changed row is checked from now on, but existing
--    rows aren't scanned, so a database holding an old inconsistent row still
--    migrates. To check existing rows too, run (docs/OPERATIONS_RUNBOOK.md):
--      ALTER TABLE goal_contributions VALIDATE CONSTRAINT goal_contributions_goal_owner_fk;
CREATE UNIQUE INDEX "idx_goals_id_user" ON "savings_goals" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_owner_fk" FOREIGN KEY ("goal_id","user_id") REFERENCES "public"."savings_goals"("id","user_id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint

-- 2. A transaction, repeating entry or budget may only use a system category
--    (user_id NULL) or one of the same user's own custom categories. A plain
--    foreign key can't say "system OR mine", so a trigger checks it. Not in
--    schema.ts (drizzle has no trigger support) — documented in
--    docs/DATABASE_DESIGN.md.
CREATE OR REPLACE FUNCTION enforce_category_owner() RETURNS trigger AS $$
DECLARE
  owner bigint;
BEGIN
  SELECT user_id INTO owner FROM categories WHERE key = NEW.category_key;
  IF owner IS NOT NULL AND owner <> NEW.user_id THEN
    RAISE EXCEPTION 'category "%" belongs to another user', NEW.category_key USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "transactions_category_owner" BEFORE INSERT OR UPDATE OF "category_key", "user_id" ON "transactions" FOR EACH ROW EXECUTE FUNCTION enforce_category_owner();--> statement-breakpoint
CREATE TRIGGER "recurring_category_owner" BEFORE INSERT OR UPDATE OF "category_key", "user_id" ON "recurring_transactions" FOR EACH ROW EXECUTE FUNCTION enforce_category_owner();--> statement-breakpoint
CREATE TRIGGER "budgets_category_owner" BEFORE INSERT OR UPDATE OF "category_key", "user_id" ON "budgets" FOR EACH ROW EXECUTE FUNCTION enforce_category_owner();
