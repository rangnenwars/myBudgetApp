CREATE TABLE "admin_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" bigint,
	"actor_email" text NOT NULL,
	"target_id" bigint,
	"target_email" text NOT NULL,
	"action" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_admin_audit_actor" ON "admin_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_target" ON "admin_audit_log" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_created" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('user', 'admin', 'support', 'system_manager'));