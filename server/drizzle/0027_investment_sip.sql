ALTER TABLE "investments" ADD COLUMN "sip_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "sip_day" smallint;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "sip_category" text;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "sip_ends_on" date;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "sip_no_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "sip_posted_through" date;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_sip_category_categories_key_fk" FOREIGN KEY ("sip_category") REFERENCES "public"."categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_sip_together_check" CHECK (("investments"."sip_amount" IS NULL) = ("investments"."sip_day" IS NULL) AND ("investments"."sip_amount" IS NULL) = ("investments"."sip_category" IS NULL));--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_sip_amount_check" CHECK ("investments"."sip_amount" IS NULL OR "investments"."sip_amount" > 0);--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_sip_day_check" CHECK ("investments"."sip_day" IS NULL OR "investments"."sip_day" BETWEEN 1 AND 31);--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_sip_end_check" CHECK ("investments"."sip_amount" IS NULL OR (("investments"."sip_ends_on" IS NOT NULL) <> "investments"."sip_no_end"));