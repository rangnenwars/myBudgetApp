DROP INDEX "idx_recurring_user";--> statement-breakpoint
DROP INDEX "idx_transactions_user_type_category";--> statement-breakpoint
CREATE INDEX "idx_budgets_category" ON "budgets" USING btree ("category_key");--> statement-breakpoint
CREATE INDEX "idx_goal_contributions_user" ON "goal_contributions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_recurring_user_posted" ON "recurring_transactions" USING btree ("user_id","posted_through");--> statement-breakpoint
CREATE INDEX "idx_recurring_category" ON "recurring_transactions" USING btree ("category_key");--> statement-breakpoint
CREATE INDEX "idx_transactions_user_date" ON "transactions" USING btree ("user_id","date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_transactions_category" ON "transactions" USING btree ("category_key");