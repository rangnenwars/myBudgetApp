import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import categoriesRoutes from './routes/categories';
import transactionsRoutes from './routes/transactions';
import loansRoutes from './routes/loans';
import investmentsRoutes from './routes/investments';
import goalsRoutes from './routes/goals';
import reportsRoutes from './routes/reports';
import netWorthRoutes from './routes/netWorth';
import adminUsersRoutes from './routes/admin';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Exported separately from index.ts so tests (supertest) can exercise the
// app in-process without binding a port or needing a server running.
export const createApp = () => {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/categories', categoriesRoutes);
  app.use('/api/v1/transactions', transactionsRoutes);
  app.use('/api/v1/loans', loansRoutes);
  app.use('/api/v1/investments', investmentsRoutes);
  app.use('/api/v1/goals', goalsRoutes);
  app.use('/api/v1/reports', reportsRoutes);
  app.use('/api/v1/net-worth', netWorthRoutes);
  app.use('/api/v1/admin/users', adminUsersRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
