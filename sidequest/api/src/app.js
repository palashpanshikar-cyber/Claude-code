import express from 'express';
import path from 'node:path';
import { config } from './lib/config.js';
import { authRouter } from './routes/auth.js';
import { questsRouter } from './routes/quests.js';
import { completionsRouter } from './routes/completions.js';
import { meRouter } from './routes/me.js';
import { minisRouter } from './routes/minis.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));

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
