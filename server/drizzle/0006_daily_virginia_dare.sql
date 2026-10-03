CREATE TABLE "recurring_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"category_key" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text,
	"posted_through" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_amount_check" CHECK ("recurring_transactions"."amount" > 0),
	CONSTRAINT "recurring_type_check" CHECK ("recurring_transactions"."type" IN ('income', 'expense'))
);
--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_transactions" ADD CONSTRAINT "recurring_transactions_category_key_categories_key_fk" FOREIGN KEY ("category_key") REFERENCES "public"."categories"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_recurring_user" ON "recurring_transactions" USING btree ("user_id");