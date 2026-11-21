CREATE TABLE "tour_outcomes" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"step" smallint NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tour_outcomes_outcome_check" CHECK ("tour_outcomes"."outcome" IN ('finished', 'skipped')),
	CONSTRAINT "tour_outcomes_step_check" CHECK ("tour_outcomes"."step" BETWEEN 1 AND 20),
	CONSTRAINT "tour_outcomes_language_check" CHECK ("tour_outcomes"."language" IN ('en', 'hi'))
);
--> statement-breakpoint
ALTER TABLE "tour_outcomes" ADD CONSTRAINT "tour_outcomes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;