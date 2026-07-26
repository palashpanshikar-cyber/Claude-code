import express, { type Express } from 'express';
import cors from 'cors';
import path from 'node:path';
import { config } from './lib/config.js';
import { authRouter } from './routes/auth.js';
import { questsRouter } from './routes/quests.js';
import { completionsRouter } from './routes/completions.js';
import { meRouter } from './routes/me.js';
import { minisRouter } from './routes/minis.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp(): Express {
  const app = express();

  // Railway/Render terminate TLS upstream; without this every request's IP is
  // the load balancer's and the rate limiter keys everyone into one bucket.
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/auth', authRouter);
  app.use('/quests', questsRouter);
  app.use('/completions', completionsRouter);
  app.use('/me', meRouter);
  app.use('/minis', minisRouter);

  // Local-disk photos only; with R2 configured the bucket serves them directly.
  if (config.storage.driver === 'local') {
    app.use('/uploads', express.static(path.resolve(config.storage.localDir)));
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
