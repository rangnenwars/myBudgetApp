ALTER TABLE "recurring_transactions" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN "no_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_end_check" CHECK (NOT ("recurring_transactions"."no_end" AND "recurring_transactions"."ends_on" IS NOT NULL));