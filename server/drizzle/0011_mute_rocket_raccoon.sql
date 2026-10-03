DROP INDEX "idx_transactions_user_month";--> statement-breakpoint
ALTER TABLE "investments" ALTER COLUMN "returns_percent" SET DATA TYPE numeric(12, 2);--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_note_length" CHECK (length("recurring_transactions"."note") <= 500);--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_month_matches_date" CHECK ("transactions"."month" = EXTRACT(MONTH FROM "transactions"."date") AND "transactions"."year" = EXTRACT(YEAR FROM "transactions"."date"));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_note_length" CHECK (length("transactions"."note") <= 500 AND length("transactions"."subcategory") <= 100);