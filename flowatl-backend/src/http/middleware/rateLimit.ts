import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../lib/errors.js';
import { now } from '../../lib/clock.js';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Defaults to the caller's IP; override to key on a user or a route. */
  key?: (req: Request) => string;
}

/**
 * Fixed-window limiter kept in memory. Enough to stop a runaway client from
 * hammering the demo; a multi-instance deployment would want a shared store.
 */
export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const keyFor = options.key ?? ((req: Request) => req.ip ?? 'unknown');

  return (req: Request, res: Response, next: NextFunction): void => {
    const at = now();
    const key = keyFor(req);
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= at) {
      bucket = { count: 0, resetAt: at + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    // Opportunistic sweep so the map cannot grow without bound.
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= at) buckets.delete(k);
      }
    }

    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader('RateLimit-Limit', options.max);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', Math.ceil((bucket.resetAt - at) / 1000));

    if (bucket.count > options.max) {
      next(
        ApiError.tooManyRequests('Slow down a moment', {
          retryAfterSeconds: Math.ceil((bucket.resetAt - at) / 1000),
        }),
      );
      return;
    }
    next();
  };
}
