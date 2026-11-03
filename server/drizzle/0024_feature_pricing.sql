ALTER TABLE "user_features" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_features" ADD COLUMN "request_paid" boolean DEFAULT false NOT NULL;