ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_phone" ON "users" USING btree ("phone") WHERE "users"."phone" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_check" CHECK ("users"."phone" ~ '^[+][1-9][0-9]{7,14}$');