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

/** Looser cap for account creation, which is legitimately rarer than login. */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: disabled ? 0 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => disabled,
  message: { error: 'Too many accounts created from this address' },
});
