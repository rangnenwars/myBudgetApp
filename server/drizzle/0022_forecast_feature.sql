ALTER TABLE "user_features" DROP CONSTRAINT "user_features_key_check";--> statement-breakpoint
ALTER TABLE "user_features" ADD CONSTRAINT "user_features_key_check" CHECK ("user_features"."feature_key" IN ('goals', 'loans', 'investments', 'forecast'));--> statement-breakpoint

-- Existing users who already repeat income or bills get Plan ahead, since it
-- is built from exactly that data. Everyone else starts off until an admin
-- switches it on (sign-up default stays off).
INSERT INTO "user_features" ("user_id", "feature_key", "status", "source")
SELECT DISTINCT "user_id", 'forecast', 'on', 'existing_data' FROM "recurring_transactions"
ON CONFLICT DO NOTHING;
