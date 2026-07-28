import pino from 'pino';
import { pinoHttp } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from './config.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.env === 'test' ? 'silent' : 'info'),
  // Pretty output is a dev nicety; production logs go to a log aggregator that
  // wants one JSON object per line.
  ...(config.env === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      }
    : {}),
});

/**
 * Logs one line per request: method, path, status, duration.
 *
 * Without this there is no record a request ever happened, so the first
 * "it didn't work" from a tester is unanswerable.
 */
export const httpLogger = pinoHttp({
  logger,
  // 4xx are the client's problem and shouldn't read as server alarms.
  customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps: (req: IncomingMessage) => ({
    // Which account, not which person — enough to trace a report back to a
    // session without putting emails in the logs.
    userId: (req as { user?: { id: string } }).user?.id,
  }),
  // Health checks run every few seconds on a platform; logging them buries
  // everything real.
  autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
  // Default serializers dump every header on every request, which buries the
  // signal. Method, path, status and duration is what you actually read.
  serializers: {
    req: (req: IncomingMessage & { url?: string; method?: string }) => ({
      method: req.method,
      url: req.url,
    }),
    res: (res: ServerResponse) => ({ status: res.statusCode }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'res.headers["set-cookie"]',
    ],
    remove: true,
  },
});
