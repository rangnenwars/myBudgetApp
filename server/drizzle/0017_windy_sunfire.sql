CREATE TABLE "people" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"name" text NOT NULL,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_name_length" CHECK (length("people"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "people_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"person_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_ledger_amount_nonzero" CHECK ("people_ledger"."amount" <> 0),
	CONSTRAINT "people_ledger_kind_check" CHECK ("people_ledger"."kind" IN ('lent', 'borrowed', 'received', 'repaid', 'written_off')),
	CONSTRAINT "people_ledger_note_length" CHECK (length("people_ledger"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_ledger" ADD CONSTRAINT "people_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people_ledger" ADD CONSTRAINT "people_ledger_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_people_user_name" ON "people" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "idx_people_ledger_person" ON "people_ledger" USING btree ("person_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_people_ledger_user" ON "people_ledger" USING btree ("user_id");