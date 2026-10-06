CREATE TABLE "monthly_budgets" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"include_commitments" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_budgets_amount_check" CHECK ("monthly_budgets"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "monthly_budgets" ADD CONSTRAINT "monthly_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;