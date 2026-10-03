import 'dotenv/config';
import { createApp } from './app';
import { pool } from './db/client';
import { startIssueDigestSchedule } from './jobs/scheduler';

for (const name of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

// A short or reused signing secret lets anyone who guesses it mint sessions
// for any account. Refuse to start in production rather than run with one.
if (process.env.NODE_ENV === 'production') {
  const access = process.env.JWT_ACCESS_SECRET!;
  const refresh = process.env.JWT_REFRESH_SECRET!;
  if (access.length < 32 || refresh.length < 32 || access === refresh || /replace-with/.test(access + refresh)) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different random values of at least 32 characters (openssl rand -hex 32).');
  }
  // Unset CORS_ORIGIN means "any origin" (fine for local dev only).
  if (!process.env.CORS_ORIGIN) {
    throw new Error('Set CORS_ORIGIN to the web app origin(s) in production, e.g. https://prapanji.in,https://www.prapanji.in');
  }
}

const app = createApp();
const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => {
  console.log(`My Budget API listening on :${port}`);
});

// Graceful shutdown on deploy/restart (Docker sends SIGTERM): stop taking new
// connections, let in-flight requests finish, close the DB pool, then exit.
// Forced exit after 10 s so a stuck request can't block the deploy.
let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down`);
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startIssueDigestSchedule();
