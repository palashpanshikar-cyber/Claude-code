import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import { iso } from './lib/clock.js';
import { apiRouter } from './http/routes/index.js';
import { errorHandler, notFoundHandler } from './http/middleware/error.js';
import { rateLimit } from './http/middleware/rateLimit.js';
import type { Services } from './services.js';

export interface CreateAppOptions {
  /** Disable request logging (tests). */
  quiet?: boolean;
}

export function createApp(services: Services, options: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // Correct client IPs behind a single proxy, which the rate limiter keys on.
  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '64kb' }));

  if (!options.quiet && !config.isTest) {
    app.use((req, res, next) => {
      const startedAt = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        // The SSE stream never "finishes" until the client leaves; that is fine.
        console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
      next();
    });
  }

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      serverTime: iso(),
      // Echo the settings actually in force. Environment variables are easy to
      // set in a shell that the server never sees; this makes that visible
      // instead of leaving it to be inferred from how fast the map moves.
      simulation: {
        ...services.simulation.settings,
        loopMinutes: Math.round(services.simulation.loopSeconds() / 60),
      },
      fleet: {
        size: services.simulation.fleetSize,
        active: services.simulation.activeShuttleCount(),
        passengersOnboard: services.simulation.totalPassengers(),
      },
    });
  });

  // A generous ceiling: the live screens poll, and one demo device can
  // legitimately make a few requests a second.
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600 }));
  app.use('/api', apiRouter(services));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
