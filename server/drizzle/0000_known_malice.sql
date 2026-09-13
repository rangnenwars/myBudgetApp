CREATE TABLE "budgets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"category_key" text NOT NULL,
	"monthly_limit" numeric(12, 2) NOT NULL,
	CONSTRAINT "budgets_limit_check" CHECK ("budgets"."monthly_limit" > 0)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"icon" text NOT NULL,
	"color" text NOT NULL,
	"group" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "categories_type_check" CHECK ("categories"."type" IN ('income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"current_value" numeric(12, 2),
	"start_date" date,
	"maturity_date" date,
	"returns_percent" numeric(6, 2),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investments_amount_check" CHECK ("investments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"principal" numeric(12, 2) NOT NULL,
	"outstanding" numeric(12, 2) NOT NULL,
	"emi" numeric(12, 2) NOT NULL,
	"interest_rate" numeric(5, 2),
	"tenure_months" smallint,
	"start_date" date,
	"loan_type" text,
	"lender" text,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loans_principal_check" CHECK ("loans"."principal" > 0),
	CONSTRAINT "loans_outstanding_check" CHECK ("loans"."outstanding" >= 0),
	CONSTRAINT "loans_emi_check" CHECK ("loans"."emi" > 0)
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"month" smallint NOT NULL,
	"year" smallint NOT NULL,
	"net_worth" numeric(14, 2) NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_month_check" CHECK ("net_worth_snapshots"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"target_amount" numeric(12, 2) NOT NULL,
	"saved_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"deadline" date,
	"color" text DEFAULT '#10B981' NOT NULL,
	"icon" text DEFAULT 'star' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_target_check" CHECK ("savings_goals"."target_amount" > 0),
	CONSTRAINT "goals_saved_check" CHECK ("savings_goals"."saved_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"category_key" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"type" text NOT NULL,
	"subcategory" text,
	"note" text,
	"date" date NOT NULL,
	"month" smallint NOT NULL,
	"year" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_check" CHECK ("transactions"."amount" > 0),
	CONSTRAINT "transactions_type_check" CHECK ("transactions"."type" IN ('income', 'expense')),
	CONSTRAINT "transactions_month_check" CHECK ("transactions"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"budget_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_tier_check" CHECK ("users"."tier" IN ('standard', 'pro')),
	CONSTRAINT "users_budget_class_check" CHECK ("users"."budget_class" IN ('low', 'middle', 'high', 'ultra_high', 'rich'))
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_key_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "public"."categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_key_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "public"."categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_budgets_user_category" ON "budgets" USING btree ("user_id","category_key");--> statement-breakpoint
CREATE INDEX "idx_investments_user" ON "investments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_loans_user_active" ON "loans" USING btree ("user_id") WHERE "loans"."is_active";--> statement-breakpoint
CREATE UNIQUE INDEX "idx_net_worth_user_month" ON "net_worth_snapshots" USING btree ("user_id","year","month");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_goals_user" ON "savings_goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_user_month" ON "transactions" USING btree ("user_id","year","month");--> statement-breakpoint
CREATE INDEX "idx_transactions_user_type_category" ON "transactions" USING btree ("user_id","type","category_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email_lower" ON "users" USING btree (lower("email"));