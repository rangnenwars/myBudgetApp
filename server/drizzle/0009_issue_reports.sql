CREATE TABLE "issue_reports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"screen" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"steps_to_reproduce" text,
	"expected_behavior" text,
	"platform" text,
	"app_version" text,
	"device_info" text,
	"screenshot" "bytea",
	"screenshot_mime_type" text,
	"screenshot_size" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"analysis" jsonb,
	"suggestion" text,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_reports_category_check" CHECK ("issue_reports"."category" IN ('bug', 'crash', 'data', 'ui', 'performance', 'other')),
	CONSTRAINT "issue_reports_severity_check" CHECK ("issue_reports"."severity" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "issue_reports_status_check" CHECK ("issue_reports"."status" IN ('new', 'triaged', 'resolved', 'wont_fix')),
	CONSTRAINT "issue_reports_screenshot_check" CHECK (("issue_reports"."screenshot" IS NULL) = ("issue_reports"."screenshot_mime_type" IS NULL)),
	CONSTRAINT "issue_reports_screenshot_size_check" CHECK ("issue_reports"."screenshot_size" IS NULL OR "issue_reports"."screenshot_size" <= 2097152)
);
--> statement-breakpoint
ALTER TABLE "issue_reports" ADD CONSTRAINT "issue_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_issue_reports_user" ON "issue_reports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_issue_reports_created" ON "issue_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_issue_reports_pending" ON "issue_reports" USING btree ("created_at") WHERE "issue_reports"."notified_at" IS NULL;