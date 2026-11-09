CREATE TABLE "access_grants" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"reason" text,
	"amount_inr" numeric(10, 2),
	"price_inr" numeric(10, 2),
	"txn_id" text,
	"granted_by" bigint,
	"revoked_at" timestamp with time zone,
	"revoked_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_grants_kind_check" CHECK ("access_grants"."kind" IN ('trial', 'paid', 'exception')),
	CONSTRAINT "access_grants_end_check" CHECK ("access_grants"."kind" = 'exception' OR "access_grants"."ends_at" IS NOT NULL),
	CONSTRAINT "access_grants_reason_check" CHECK ("access_grants"."kind" <> 'exception' OR ("access_grants"."reason" IS NOT NULL AND length(btrim("access_grants"."reason")) > 0)),
	CONSTRAINT "access_grants_order_check" CHECK ("access_grants"."ends_at" IS NULL OR "access_grants"."ends_at" > "access_grants"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "access_notices" (
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"access_end" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "access_notices_user_id_kind_access_end_pk" PRIMARY KEY("user_id","kind","access_end"),
	CONSTRAINT "access_notices_kind_check" CHECK ("access_notices"."kind" IN ('welcome', 'existing', 'd30', 'd7', 'd1', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "payment_claims" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"txn_id" text NOT NULL,
	"amount_inr" numeric(10, 2),
	"user_note" text,
	"screenshot" "bytea",
	"screenshot_mime_type" text,
	"screenshot_size" integer,
	"screenshot_hash" text,
	"grace_until" timestamp with time zone,
	"for_access_end" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" bigint,
	"decision_reason" text,
	"asked_to_resend" boolean DEFAULT false NOT NULL,
	"grant_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_claims_status_check" CHECK ("payment_claims"."status" IN ('pending', 'confirmed', 'rejected', 'cancelled')),
	CONSTRAINT "payment_claims_source_check" CHECK ("payment_claims"."source" IN ('user', 'admin')),
	CONSTRAINT "payment_claims_txn_check" CHECK ("payment_claims"."txn_id" ~ '^[A-Z0-9]{8,35}$'),
	CONSTRAINT "payment_claims_screenshot_check" CHECK (("payment_claims"."screenshot" IS NULL) = ("payment_claims"."screenshot_mime_type" IS NULL)),
	CONSTRAINT "payment_claims_screenshot_size_check" CHECK ("payment_claims"."screenshot_size" IS NULL OR "payment_claims"."screenshot_size" <= 3145728)
);
--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"upi_id" text NOT NULL,
	"payee_name" text NOT NULL,
	"qr_image" "bytea" NOT NULL,
	"qr_mime_type" text NOT NULL,
	"qr_size" integer NOT NULL,
	"qr_verified" boolean DEFAULT true NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_settings_single_row" CHECK ("payment_settings"."id" = 1),
	CONSTRAINT "payment_settings_qr_size_check" CHECK ("payment_settings"."qr_size" <= 1048576)
);
--> statement-breakpoint
ALTER TABLE "user_features" ADD COLUMN "denied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_kind" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_notices" ADD CONSTRAINT "access_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_grant_id_access_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."access_grants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_grants_user" ON "access_grants" USING btree ("user_id","ends_at");--> statement-breakpoint
CREATE INDEX "idx_access_grants_kind_end" ON "access_grants" USING btree ("kind","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_payment_claims_txn_live" ON "payment_claims" USING btree ("txn_id") WHERE "payment_claims"."status" IN ('pending', 'confirmed');--> statement-breakpoint
CREATE INDEX "idx_payment_claims_status" ON "payment_claims" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_claims_user" ON "payment_claims" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_kind_check" CHECK ("users"."account_kind" IN ('customer', 'company'));--> statement-breakpoint
-- Data: who is a company account, and a trial for every existing customer.
-- Staff roles and the documented demo accounts are company accounts.
UPDATE "users" SET "account_kind" = 'company'
WHERE "role" IN ('admin', 'support', 'system_manager') OR lower("email") LIKE '%@mybudget.local';--> statement-breakpoint
-- Existing customers get the free period counted from their own sign-up. Their end date is
-- adjusted to at least the notice period when the notice is sent (POST /admin/plan/notify-existing),
-- and nothing is enforced until an admin turns enforcement on.
INSERT INTO "access_grants" ("user_id", "kind", "starts_at", "ends_at")
SELECT u."id", 'trial', u."created_at", u."created_at" + interval '6 months'
FROM "users" u
WHERE u."account_kind" = 'customer';
