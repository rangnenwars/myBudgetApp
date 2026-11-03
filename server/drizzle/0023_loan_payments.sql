CREATE TABLE "loan_payments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"loan_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"date" date NOT NULL,
	"balance_after" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_payments_amount_check" CHECK ("loan_payments"."amount" > 0),
	CONSTRAINT "loan_payments_kind_check" CHECK ("loan_payments"."kind" IN ('part_payment', 'emi'))
);
--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_loan_id_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_loan_payments_loan_date" ON "loan_payments" USING btree ("loan_id","date");--> statement-breakpoint

-- Backfill: part payments recorded before this table existed are only in
-- transactions (category_key loan_part_payment, note "Part payment - <loan name>").
-- Matched by loan name, and only where the user has exactly one loan with that
-- name, so a payment is never filed under the wrong loan. The balance at the
-- time isn't known, so balance_after stays empty. Loans that don't count as an
-- expense never logged a transaction, so there is nothing to recover for them.
INSERT INTO "loan_payments" ("user_id", "loan_id", "kind", "amount", "date", "balance_after", "created_at")
SELECT t."user_id", l."id", 'part_payment', t."amount", t."date", NULL, t."created_at"
FROM "transactions" t
JOIN (
  SELECT "user_id", "name", min("id") AS "id"
  FROM "loans"
  GROUP BY "user_id", "name"
  HAVING count(*) = 1
) l ON l."user_id" = t."user_id" AND t."note" = 'Part payment - ' || l."name"
WHERE t."category_key" = 'loan_part_payment' AND t."amount" > 0;
