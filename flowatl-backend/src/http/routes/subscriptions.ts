import { Router } from 'express';
import { FLOWPASS_PLAN } from '../../domain/subscriptions.js';
import { SUBSCRIPTION_PRICE_USD } from '../../domain/pricing.js';
import type { Services } from '../../services.js';
import { currentUser, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';

export function subscriptionsRouter(services: Services): Router {
  const router = Router();

  router.get(
    '/plans',
    asyncHandler((_req, res) => {
      res.json({
        plans: [
          {
            id: FLOWPASS_PLAN,
            name: 'FlowPass',
            priceUsd: SUBSCRIPTION_PRICE_USD,
            interval: 'month',
            benefits: [
              'Unlimited rides on the downtown loop',
              'Priority seat holds at peak hours',
              'Fares waived automatically at booking',
            ],
          },
        ],
      });
    }),
  );

  router.get(
    '/me',
    requireAuth(services),
    asyncHandler((req, res) => {
      const userId = currentUser(req).id;
      res.json({
        subscription: services.subscriptions.active(userId),
        history: services.subscriptions.history(userId),
      });
    }),
  );

  router.post(
    '/',
    requireAuth(services),
    asyncHandler((req, res) => {
      res.status(201).json({ subscription: services.subscriptions.subscribe(currentUser(req).id) });
    }),
  );

  router.post(
    '/cancel',
    requireAuth(services),
    asyncHandler((req, res) => {
      res.json({ subscription: services.subscriptions.cancel(currentUser(req).id) });
    }),
  );

  return router;
}
