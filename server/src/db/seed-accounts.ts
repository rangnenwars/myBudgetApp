// Seeds one demo user account and one super-admin account for local
// testing/login. Safe to re-run — upserts on email (resets the password
// and role each time, in case either drifted). These are local dev
// credentials only; never reuse them for a real deployment.

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db, pool } from './client';
import { users } from './schema';

const BCRYPT_COST = 12;

const ACCOUNTS = [
  { name: 'Super Admin', email: 'admin@mybudget.local', password: 'Admin@12345', role: 'admin' as const },
  { name: 'Demo User', email: 'user@mybudget.local', password: 'User@12345', role: 'user' as const },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo accounts with published passwords in production. Use src/db/create-admin.ts instead.');
  }
  for (const acc of ACCOUNTS) {
    const passwordHash = await bcrypt.hash(acc.password, BCRYPT_COST);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, acc.email));

    if (existing) {
      await db
        .update(users)
        .set({ passwordHash, role: acc.role, isActive: true, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
      console.log(`Updated ${acc.role} account: ${acc.email}`);
    } else {
      await db.insert(users).values({ name: acc.name, email: acc.email, passwordHash, role: acc.role });
      console.log(`Created ${acc.role} account: ${acc.email}`);
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error('Seeding accounts failed:', err);
  process.exit(1);
});
