CREATE TABLE "free_money_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"week_start" date NOT NULL,
	"income" numeric(14, 2) NOT NULL,
	"committed" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "split_group" text;--> statement-breakpoint
ALTER TABLE "free_money_snapshots" ADD CONSTRAINT "free_money_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_free_money_user_week" ON "free_money_snapshots" USING btree ("user_id","week_start");