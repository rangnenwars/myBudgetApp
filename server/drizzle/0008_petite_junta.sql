CREATE TABLE "accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"balance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" IN ('bank', 'cash', 'wallet', 'credit_card'))
);
--> statement-breakpoint
CREATE TABLE "user_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "user_tokens_purpose_check" CHECK ("user_tokens"."purpose" IN ('password_reset', 'email_verify'))
);
--> statement-breakpoint
DROP INDEX "idx_recurring_user_posted";--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN "frequency" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN "day_of_month" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD COLUMN "next_due" date;--> statement-breakpoint
-- Existing rules are all monthly on the 1st: next due = the month after the last one posted.
UPDATE "recurring_transactions" SET "next_due" = ("posted_through" + interval '1 month')::date;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ALTER COLUMN "next_due" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_accounts_user" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_tokens_user" ON "user_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "idx_recurring_user_due" ON "recurring_transactions" USING btree ("user_id","next_due");--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_frequency_check" CHECK ("recurring_transactions"."frequency" IN ('monthly', 'quarterly', 'yearly'));--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_day_check" CHECK ("recurring_transactions"."day_of_month" BETWEEN 1 AND 31);