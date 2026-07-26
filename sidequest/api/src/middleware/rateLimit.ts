import rateLimit from 'express-rate-limit';
import { config } from '../lib/config.js';

// Tests fire dozens of registrations in seconds; a limiter would make them
// flaky and would be testing express-rate-limit rather than our code.
const disabled = config.env === 'test';

/**
 * Guards credential endpoints against brute force.
 *
 * Keyed by IP. Behind a proxy (Railway/Render) this needs `app.set('trust proxy')`
 * or every request looks like it comes from the load balancer.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: disabled ? 0 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: { error: 'Too many attempts — try again in a few minutes' },
});

/**
 * Blanket ceiling so a single client cannot flood the API.
 *
 * Generous enough that normal browsing never touches it — a feed scroll is a
 * handful of requests.
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: disabled ? 0 : 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: { error: 'Too many requests — slow down' },
});

/**
 * Uploads decode and re-encode images, which is the only CPU-bound work in the
 * process. Without a cap, one authenticated client can saturate the event loop
 * with 10MB images and take the API down for everyone.
 *
 * Keyed by user rather than IP — a shared campus NAT would otherwise throttle
 * a whole building.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: disabled ? 0 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  keyGenerator: (req) => (req as { user?: { id: string } }).user?.id ?? req.ip ?? 'unknown',
  message: { error: 'Too many uploads — try again later' },
});

/** Quest submissions feed a human review queue; spam costs the operator time. */
export const submissionLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: disabled ? 0 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  keyGenerator: (req) => (req as { user?: { id: string } }).user?.id ?? req.ip ?? 'unknown',
  message: { error: 'Too many quest submissions today' },
});

/** Looser cap for account creation, which is legitimately rarer than login. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: disabled ? 0 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: { error: 'Too many accounts created from this address' },
});
