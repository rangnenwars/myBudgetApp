-- Pro insights are enabled for everyone: upgrade existing accounts and make
-- Pro the default for new ones.
ALTER TABLE "users" ALTER COLUMN "tier" SET DEFAULT 'pro';--> statement-breakpoint
UPDATE "users" SET "tier" = 'pro' WHERE "tier" <> 'pro';
