// Seeds the categories table from constants/categories.ts — generated from
// the same source the client uses, not hand-typed twice. Safe to re-run
// (upserts on the primary key).

import 'dotenv/config';
import { ALL_CATEGORIES } from '../../../constants/categories';
import { db, pool } from './client';
import { categories } from './schema';
import { sql } from 'drizzle-orm';

async function main() {
  console.log(`Seeding ${ALL_CATEGORIES.length} categories...`);

  for (const c of ALL_CATEGORIES) {
    await db
      .insert(categories)
      .values({ key: c.key, label: c.label, icon: c.icon, color: c.color, group: c.group, type: c.type })
      .onConflictDoUpdate({
        target: categories.key,
        set: { label: c.label, icon: c.icon, color: c.color, group: c.group, type: c.type },
      });
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(categories);
  console.log(`Done. ${count} categories in the table.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
