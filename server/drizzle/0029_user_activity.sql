CREATE TABLE "activity_daily" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"platform" text DEFAULT '' NOT NULL,
	"events" integer NOT NULL,
	"people" integer NOT NULL,
	CONSTRAINT "activity_daily_day_kind_page_platform_pk" PRIMARY KEY("day","kind","page","platform")
);
--> statement-breakpoint
CREATE TABLE "user_activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"page" text,
	"session_id" text,
	"platform" text,
	"app_version" text,
	"location" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_activity_kind_check" CHECK ("user_activity"."kind" IN ('login', 'logout', 'page')),
	CONSTRAINT "user_activity_page_check" CHECK (("user_activity"."kind" = 'page') = ("user_activity"."page" IS NOT NULL)),
	CONSTRAINT "user_activity_platform_check" CHECK ("user_activity"."platform" IS NULL OR "user_activity"."platform" IN ('web', 'android', 'ios')),
	CONSTRAINT "user_activity_lengths_check" CHECK (length(coalesce("user_activity"."page", '')) <= 80 AND length(coalesce("user_activity"."location", '')) <= 60 AND length(coalesce("user_activity"."app_version", '')) <= 20 AND length(coalesce("user_activity"."session_id", '')) <= 40)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "share_activity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_activity" ADD CONSTRAINT "user_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_activity_user_time" ON "user_activity" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_user_activity_time" ON "user_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_user_activity_kind_time" ON "user_activity" USING btree ("kind","created_at");