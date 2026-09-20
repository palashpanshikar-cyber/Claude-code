import { Router } from 'express';
import type { Services } from '../../services.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

export function impactRouter(services: Services): Router {
  const router = Router();

  /** Network-wide numbers for today, aggregated from real simulation activity. */
  router.get(
    '/network',
    asyncHandler((_req, res) => {
      res.json({ impact: services.impact.network() });
    }),
  );

  router.get(
    '/me',
    requireAuth(services),
    asyncHandler((req, res) => {
      res.json({ impact: services.impact.personal(currentUser(req).id) });
    }),
  );

  return router;
}
