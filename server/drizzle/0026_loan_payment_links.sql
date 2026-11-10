ALTER TABLE "loan_payments" ADD COLUMN "transaction_id" bigint;--> statement-breakpoint
ALTER TABLE "loan_payments" ADD COLUMN "emi_before" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "loan_payments" ADD CONSTRAINT "loan_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;