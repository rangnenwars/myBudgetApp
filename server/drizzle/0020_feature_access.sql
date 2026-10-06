CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_features" (
	"user_id" bigint NOT NULL,
	"feature_key" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"changed_by" bigint,
	"requested_at" timestamp with time zone,
	"request_issue_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_features_user_id_feature_key_pk" PRIMARY KEY("user_id","feature_key"),
	CONSTRAINT "user_features_key_check" CHECK ("user_features"."feature_key" IN ('goals', 'loans', 'investments')),
	CONSTRAINT "user_features_status_check" CHECK ("user_features"."status" IN ('on', 'off')),
	CONSTRAINT "user_features_source_check" CHECK ("user_features"."source" IN ('default', 'existing_data', 'admin', 'request'))
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_features" ADD CONSTRAINT "user_features_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_features" ADD CONSTRAINT "user_features_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_features" ADD CONSTRAINT "user_features_request_issue_id_issue_reports_id_fk" FOREIGN KEY ("request_issue_id") REFERENCES "public"."issue_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_features_key_status" ON "user_features" USING btree ("feature_key","status");--> statement-breakpoint
CREATE INDEX "idx_user_features_requested" ON "user_features" USING btree ("requested_at") WHERE "user_features"."requested_at" IS NOT NULL;--> statement-breakpoint

-- Existing users keep every feature they already have data in, so nothing
-- they recorded disappears. Features they never used start off.
INSERT INTO "user_features" ("user_id", "feature_key", "status", "source")
SELECT DISTINCT "user_id", 'goals', 'on', 'existing_data' FROM "savings_goals"
UNION
SELECT DISTINCT "user_id", 'loans', 'on', 'existing_data' FROM "loans"
UNION
SELECT DISTINCT "user_id", 'investments', 'on', 'existing_data' FROM "investments"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- What a new account gets at sign-up until an admin changes it (approved wireframe B).
INSERT INTO "app_settings" ("key", "value")
VALUES ('signup_features', '{"goals": true, "loans": false, "investments": false}')
ON CONFLICT DO NOTHING;
