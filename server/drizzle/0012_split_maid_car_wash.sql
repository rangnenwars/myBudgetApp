-- Split the combined "Maid & car wash" category into two. Existing rows can't
-- be divided between the two, so they move to "Maid"; the old category is then
-- removed for everyone. 'maid' takes over the old row's position (id) so it keeps
-- its place in the list.
INSERT INTO "categories" ("id", "key", "label", "icon", "color", "group", "type")
SELECT "id" + 1000000, 'maid', 'Maid', '🧹', '#34D399', 'Household', 'expense'
FROM "categories" WHERE "key" = 'maid_car_wash'
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "categories" ("key", "label", "icon", "color", "group", "type")
SELECT 'car_wash', 'Car wash', '🚗', '#38BDF8', 'Household', 'expense'
WHERE EXISTS (SELECT 1 FROM "categories" WHERE "key" = 'maid_car_wash')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "transactions" SET "category_key" = 'maid' WHERE "category_key" = 'maid_car_wash';--> statement-breakpoint
UPDATE "recurring_transactions" SET "category_key" = 'maid' WHERE "category_key" = 'maid_car_wash';--> statement-breakpoint
-- A user could already hold a 'maid' budget only if they made one after this ran, so no clash is possible here.
UPDATE "budgets" SET "category_key" = 'maid' WHERE "category_key" = 'maid_car_wash';--> statement-breakpoint
DELETE FROM "categories" WHERE "key" = 'maid_car_wash';--> statement-breakpoint
UPDATE "categories" SET "id" = "id" - 1000000 WHERE "key" = 'maid' AND "id" >= 1000000;
