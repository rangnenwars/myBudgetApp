import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Sized for one API process on a small VM; Postgres' default limit is 100.
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30_000,
  // Fail a request quickly instead of queueing forever if the database is down.
  connectionTimeoutMillis: 5_000,
  // Kill runaway queries rather than tying up a connection.
  statement_timeout: 15_000,
});

// An idle pooled connection can be dropped (database restart, network blip).
// Without a listener, pg emits an unhandled 'error' event and the whole
// process crashes; the pool discards that client and reconnects on demand.
pool.on('error', (err: Error & { code?: string }) => {
  console.error('[pg] idle client error', err.code ?? '', err.message);
});

export const db = drizzle(pool, { schema });
