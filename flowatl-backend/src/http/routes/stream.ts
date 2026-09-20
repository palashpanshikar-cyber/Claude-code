/**
 * Server-sent events.
 *
 * Polling works for everything here, but the map and the live-ride screen look
 * much better fed by a push stream. A client subscribes to topics:
 *
 *   GET /api/stream?topics=shuttles,impact,ride&token=<session token>
 *
 * Browsers cannot attach an Authorization header to an EventSource, so the
 * token may be passed as a query parameter on this endpoint.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { iso, now } from '../../lib/clock.js';
import type { Services } from '../../services.js';
import { optionalAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

const TOPICS = ['shuttles', 'impact', 'ride', 'freight'] as const;
type Topic = (typeof TOPICS)[number];

const querySchema = z.object({
  topics: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? 'shuttles,impact')
        .split(',')
        .map((t) => t.trim())
        .filter((t): t is Topic => (TOPICS as readonly string[]).includes(t)),
    ),
});

/** How often each topic is pushed, in milliseconds. */
const INTERVALS: Record<Topic, number> = {
  shuttles: 1500,
  impact: 5000,
  ride: 1500,
  freight: 4000,
};

const HEARTBEAT_MS = 20_000;

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function streamRouter(services: Services): Router {
  const router = Router();

  router.get(
    '/',
    optionalAuth(services),
    asyncHandler((req: Request, res: Response) => {
      const { topics } = querySchema.parse(req.query);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Tell nginx and friends not to buffer the stream.
        'X-Accel-Buffering': 'no',
      });
      // Reconnect delay for the browser's built-in EventSource retry.
      res.write('retry: 3000\n\n');
      send(res, 'ready', { topics, serverTime: iso(), userId: req.user?.id ?? null });

      const timers: ReturnType<typeof setInterval>[] = [];
      const unsubscribes: (() => void)[] = [];

      const every = (ms: number, fn: () => void) => {
        fn();
        timers.push(setInterval(fn, ms));
      };

      if (topics.includes('shuttles')) {
        every(INTERVALS.shuttles, () => {
          const at = now();
          send(res, 'shuttles', {
            generatedAt: iso(at),
            shuttles: services.simulation.snapshotAll(at),
          });
        });
      }

      if (topics.includes('impact')) {
        every(INTERVALS.impact, () => {
          send(res, 'impact', { impact: services.impact.network() });
        });
      }

      if (topics.includes('ride') && req.user) {
        const userId = req.user.id;
        const pushRide = () => {
          send(res, 'ride', { ride: services.rides.active(userId) });
        };
        every(INTERVALS.ride, pushRide);
        // Phase changes should land immediately, not on the next interval.
        unsubscribes.push(
          services.rides.events.on('ride:updated', (payload) => {
            if (payload.userId === userId) pushRide();
          }),
        );
      }

      if (topics.includes('freight') && req.user) {
        const userId = req.user.id;
        every(INTERVALS.freight, () => {
          send(res, 'freight', { shipments: services.freight.listShipmentsForUser(userId, 5) });
        });
      }

      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), HEARTBEAT_MS);
      timers.push(heartbeat);

      const cleanup = () => {
        for (const timer of timers) clearInterval(timer);
        for (const off of unsubscribes) off();
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
    }),
  );

  return router;
}
