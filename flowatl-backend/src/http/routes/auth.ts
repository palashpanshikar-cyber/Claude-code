import { Router } from 'express';
import { toPublicUser } from '../../domain/auth.js';
import type { Services } from '../../services.js';
import { credentialsSchema, guestSchema, registerSchema } from '../schemas.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';

export function authRouter(services: Services): Router {
  const router = Router();

  // Credential endpoints get a tighter limit than the rest of the API.
  const limiter = rateLimit({ windowMs: 60_000, max: 20 });

  router.post(
    '/register',
    limiter,
    asyncHandler((req, res) => {
      const input = registerSchema.parse(req.body);
      res.status(201).json(services.auth.register(input));
    }),
  );

  router.post(
    '/login',
    limiter,
    asyncHandler((req, res) => {
      const { email, password } = credentialsSchema.parse(req.body);
      res.json(services.auth.login(email, password));
    }),
  );

  /** Password-free sign-in so the demo can open straight into a rider session. */
  router.post(
    '/guest',
    limiter,
    asyncHandler((req, res) => {
      const { email } = guestSchema.parse(req.body ?? {});
      res.status(201).json(services.auth.guest(email));
    }),
  );

  router.get(
    '/me',
    requireAuth(services),
    asyncHandler((req, res) => {
      const user = currentUser(req);
      res.json({
        user: toPublicUser(user),
        subscription: services.subscriptions.active(user.id),
      });
    }),
  );

  router.post(
    '/logout',
    requireAuth(services),
    asyncHandler((req, res) => {
      if (req.token) services.auth.logout(req.token);
      res.status(204).end();
    }),
  );

  return router;
}
