// Deletes every account these tests created (ON DELETE CASCADE takes their
// transactions/loans/investments/goals/tokens with them) so repeated test
// runs don't pile up throwaway data in the dev database.
//
// globalTeardown runs in its own process, separate from jest.config.js's
// `setupFiles` (which only apply inside test-worker processes) — so it
// needs its own dotenv load rather than relying on that.
import 'dotenv/config';

export default async function globalTeardown() {
  // The Docker build's quality stage has no database (server/scripts/docker-quality.sh sets this).
  if (process.env.SKIP_DB_TEARDOWN === '1') return;
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`DELETE FROM users WHERE email LIKE '%@test.local'`);
  await pool.end();
}
