import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import categoriesRoutes from './routes/categories';
import transactionsRoutes from './routes/transactions';
import recurringRoutes from './routes/recurring';
import loansRoutes from './routes/loans';
import investmentsRoutes from './routes/investments';
import goalsRoutes from './routes/goals';
import reportsRoutes from './routes/reports';
import netWorthRoutes from './routes/netWorth';
import adminUsersRoutes from './routes/admin';
import adminAuditLogRoutes from './routes/adminAuditLog';
import systemRoutes from './routes/system';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Exported separately from index.ts so tests (supertest) can exercise the
// app in-process without binding a port or needing a server running.
export const createApp = () => {
  const app = express();
  app.disable('x-powered-by');
  // Number of reverse-proxy hops in front of the API (1 behind Caddy in
  // production). Left at 0 when the API is reached directly, so a client
  // can't spoof X-Forwarded-For to dodge the per-IP rate limits.
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 0);
  // Comma-separated allow-list (e.g. https://prapanji.in,https://www.prapanji.in).
  // Unset = any origin, for local dev. Native apps send no Origin header and
  // are unaffected either way.
  const corsOrigins = process.env.CORS_ORIGIN?.split(',').map((o: string) => o.trim()).filter(Boolean);
  app.use(cors({ origin: corsOrigins?.length ? corsOrigins : true }));
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/categories', categoriesRoutes);
  app.use('/api/v1/transactions', transactionsRoutes);
  app.use('/api/v1/recurring', recurringRoutes);
  app.use('/api/v1/loans', loansRoutes);
  app.use('/api/v1/investments', investmentsRoutes);
  app.use('/api/v1/goals', goalsRoutes);
  app.use('/api/v1/reports', reportsRoutes);
  app.use('/api/v1/net-worth', netWorthRoutes);
  app.use('/api/v1/admin/users', adminUsersRoutes);
  app.use('/api/v1/admin/audit-log', adminAuditLogRoutes);
  app.use('/api/v1/system', systemRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
