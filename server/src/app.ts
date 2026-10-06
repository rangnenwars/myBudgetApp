import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import accountRoutes from './routes/account';
import categoriesRoutes from './routes/categories';
import transactionsRoutes from './routes/transactions';
import recurringRoutes from './routes/recurring';
import accountsRoutes from './routes/accounts';
import budgetsRoutes from './routes/budgets';
import peopleRoutes from './routes/people';
import loansRoutes from './routes/loans';
import investmentsRoutes from './routes/investments';
import goalsRoutes from './routes/goals';
import reportsRoutes from './routes/reports';
import netWorthRoutes from './routes/netWorth';
import adminUsersRoutes from './routes/admin';
import adminFeaturesRoutes from './routes/adminFeatures';
import featuresRoutes from './routes/features';
import adminAuditLogRoutes from './routes/adminAuditLog';
import systemRoutes from './routes/system';
import issuesRoutes from './routes/issues';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { pool } from './db/client';

// Exported separately from index.ts so tests (supertest) can exercise the
// app in-process without binding a port or needing a server running.
export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  // Standard security headers (nosniff, frame-deny, HSTS, no-referrer, …).
  // same-site CORP so the web app on another localhost port / the same
  // production origin can still load API responses such as issue screenshots.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  // Number of reverse-proxy hops in front of the API (1 behind Caddy in
  // production). Left at 0 when the API is reached directly, so a client
  // can't spoof X-Forwarded-For to dodge the per-IP rate limits.
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);
  // Comma-separated allow-list (e.g. https://prapanji.in,https://www.prapanji.in).
  // Unset = any origin, for local dev. Native apps send no Origin header and
  // are unaffected either way. credentials: true lets the web app send its
  // httpOnly refresh cookie to /auth (SameSite=Strict keeps other sites'
  // requests from carrying it — see routes/auth.ts).
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o: string) => o.trim()).filter(Boolean);
  app.use(cors({ origin: corsOrigins?.length ? corsOrigins : true, credentials: true }));
  // Issue reports carry a base64 screenshot (2 MB decoded ≈ 2.7 MB encoded),
  // so that one route gets a bigger body limit; everything else keeps the
  // 100 kB default. Runs first, and express.json() skips an already-parsed body.
  app.use('/api/v1/issues', express.json({ limit: '3mb' }));
  app.use(express.json());

  // Also pings the database, so the uptime check and the deploy smoke test
  // notice when the API is up but can't reach Postgres.
  app.get('/health', async (_req, res) => {
    try {
      await pool.query('select 1');
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/auth', accountRoutes);
  app.use('/api/v1/categories', categoriesRoutes);
  app.use('/api/v1/transactions', transactionsRoutes);
  app.use('/api/v1/recurring', recurringRoutes);
  app.use('/api/v1/accounts', accountsRoutes);
  app.use('/api/v1/budgets', budgetsRoutes);
  app.use('/api/v1/people', peopleRoutes);
  app.use('/api/v1/loans', loansRoutes);
  app.use('/api/v1/investments', investmentsRoutes);
  app.use('/api/v1/goals', goalsRoutes);
  app.use('/api/v1/reports', reportsRoutes);
  app.use('/api/v1/net-worth', netWorthRoutes);
  app.use('/api/v1/features', featuresRoutes);
  // Ahead of the users router: it serves /admin/users/:id/features too.
  app.use('/api/v1/admin', adminFeaturesRoutes);
  app.use('/api/v1/admin/users', adminUsersRoutes);
  app.use('/api/v1/admin/audit-log', adminAuditLogRoutes);
  app.use('/api/v1/system', systemRoutes);
  app.use('/api/v1/issues', issuesRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
