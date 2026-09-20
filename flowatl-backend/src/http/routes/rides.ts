import { Router } from 'express';
import type { Services } from '../../services.js';
import { pathParam } from '../params.js';
import { currentUser, optionalAuth, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { paginationSchema, tripSchema } from '../schemas.js';

export function ridesRouter(services: Services): Router {
  const router = Router();

  /**
   * Price and plan a trip without committing to it. Works signed out, so the
   * booking card can be shown before the rider has an account; a signed-in
   * FlowPass holder sees a $0 fare.
   */
  router.post(
    '/quote',
    optionalAuth(services),
    asyncHandler((req, res) => {
      const { pickupStopId, destinationStopId } = tripSchema.parse(req.body);
      res.json({ quote: services.rides.quote(pickupStopId, destinationStopId, req.user?.id) });
    }),
  );

  router.get(
    '/',
    requireAuth(services),
    asyncHandler((req, res) => {
      const { limit } = paginationSchema.parse(req.query);
      res.json({ rides: services.rides.history(currentUser(req).id, limit) });
    }),
  );

  /** The rider's trip in progress — what the live-tracking screen polls. */
  router.get(
    '/active',
    requireAuth(services),
    asyncHandler((req, res) => {
      res.json({ ride: services.rides.active(currentUser(req).id) });
    }),
  );

  router.post(
    '/',
    requireAuth(services),
    asyncHandler((req, res) => {
      const { pickupStopId, destinationStopId } = tripSchema.parse(req.body);
      const ride = services.rides.book(currentUser(req).id, pickupStopId, destinationStopId);
      res.status(201).json({ ride });
    }),
  );

  router.get(
    '/:rideId',
    requireAuth(services),
    asyncHandler((req, res) => {
      res.json({ ride: services.rides.get(pathParam(req, 'rideId'), currentUser(req).id) });
    }),
  );

  router.post(
    '/:rideId/cancel',
    requireAuth(services),
    asyncHandler((req, res) => {
      res.json({ ride: services.rides.cancel(pathParam(req, 'rideId'), currentUser(req).id) });
    }),
  );

  return router;
}
