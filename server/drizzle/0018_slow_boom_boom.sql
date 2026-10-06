ALTER TABLE "people_ledger" DROP CONSTRAINT "people_ledger_kind_check";--> statement-breakpoint
ALTER TABLE "people_ledger" ADD COLUMN "transaction_id" bigint;--> statement-breakpoint
ALTER TABLE "people_ledger" ADD CONSTRAINT "people_ledger_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_ledger" ADD CONSTRAINT "people_ledger_kind_check" CHECK ("people_ledger"."kind" IN ('lent', 'borrowed', 'received', 'repaid', 'written_off', 'split_share'));