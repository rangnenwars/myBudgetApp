// Promotes an already-registered account to admin — how the first real
// admin is created in production, where demo accounts are never seeded.
// Register normally through the app first, then run (on the server host):
//   docker compose exec server npx tsx src/db/create-admin.ts you@example.com
// No password is ever passed on the command line or stored here.

import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from './client';
import { users } from './schema';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npx tsx src/db/create-admin.ts <email>');

  const [user] = await db
    .update(users)
    .set({ role: 'admin', isActive: true, deactivatedAt: null, updatedAt: new Date() })
    .where(eq(sql`lower(${users.email})`, email))
    .returning({ id: users.id, email: users.email });
  if (!user) throw new Error(`No account registered with ${email} — sign up in the app first.`);

  console.log(`Promoted ${user.email} (id ${user.id}) to admin.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
