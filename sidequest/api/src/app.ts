import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { config } from './lib/config.js';
import { authRouter } from './routes/auth.js';
import { questsRouter } from './routes/quests.js';
import { completionsRouter } from './routes/completions.js';
import { meRouter } from './routes/me.js';
import { usersRouter } from './routes/users.js';
import { minisRouter } from './routes/minis.js';
import { errorHandler, notFound } from './middleware/error.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { httpLogger, logger } from './lib/logger.js';
import { handle } from './lib/http.js';
import { prisma } from './lib/prisma.js';

export function createApp(): Express {
  const app = express();

  // Railway/Render terminate TLS upstream; without this every request's IP is
  // the load balancer's and the rate limiter keys everyone into one bucket.
  if (config.trustProxy) app.set('trust proxy', 1);

  // nosniff matters most here: an upload that sharp could not decode is stored
  // as-is, and without it a browser could sniff those bytes as something
  // executable. Also removes x-powered-by and sets HSTS/frame options.
  app.use(
    helmet({
      // The API serves JSON and images, never HTML, so a restrictive CSP costs
      // nothing and blocks any accidental HTML response from doing anything.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], imgSrc: ["'self'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(httpLogger);
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '1mb' }));
  app.use(globalLimiter);

  // Liveness only — is the process up and serving?
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Readiness — can it actually do its job? A health check that ignores the
  // database reports green while every real request 500s, which is worse than
  // no check at all because it makes the platform stop asking.
  app.get(
    '/health/ready',
    handle(async (_req, res) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ ok: true, database: 'up' });
      } catch (err) {
        logger.error({ err }, 'readiness check failed');
        res.status(503).json({ ok: false, database: 'down' });
      }
    }),
  );

  app.use('/auth', authRouter);
  app.use('/quests', questsRouter);
  app.use('/completions', completionsRouter);
  app.use('/me', meRouter);
  app.use('/users', usersRouter);
  app.use('/minis', minisRouter);

  // Local-disk photos only; with R2 configured the bucket serves them directly.
  if (config.storage.driver === 'local') {
    app.use('/uploads', express.static(path.resolve(config.storage.localDir)));
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
