import { Router } from 'express';
import { z } from 'zod';
import { STOPS, isStopId, routeSummary } from '../../domain/network.js';
import { ApiError } from '../../lib/errors.js';
import { iso, now } from '../../lib/clock.js';
import type { Services } from '../../services.js';
import { pathParam } from '../params.js';
import { asyncHandler } from '../middleware/error.js';

const arrivalsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

export function networkRouter(services: Services): Router {
  const router = Router();

  /** The route the client draws: stops, geometry and segment distances. */
  router.get(
    '/route',
    asyncHandler((_req, res) => {
      res.json({ route: routeSummary() });
    }),
  );

  router.get(
    '/stops',
    asyncHandler((_req, res) => {
      const at = now();
      res.json({
        stops: STOPS.map((stop) => {
          const [next] = services.simulation.arrivalsAtStop(stop.id, 1, at);
          return {
            ...stop,
            nextArrival: next ?? null,
          };
        }),
      });
    }),
  );

  /** Live countdown for a single stop — what the home screen ticks down. */
  router.get(
    '/stops/:stopId/arrivals',
    asyncHandler((req, res) => {
      const stopId = pathParam(req, 'stopId');
      if (!isStopId(stopId)) throw ApiError.notFound(`Unknown stop "${stopId}"`);
      const { limit } = arrivalsQuery.parse(req.query);
      const at = now();
      const arrivals = services.simulation.arrivalsAtStop(stopId, limit, at);
      res.json({
        stopId,
        generatedAt: iso(at),
        arrivals,
        nextArrival: arrivals[0] ?? null,
      });
    }),
  );

  /** Every shuttle's live position, load and battery state. */
  router.get(
    '/shuttles',
    asyncHandler((_req, res) => {
      const at = now();
      res.json({ generatedAt: iso(at), shuttles: services.simulation.snapshotAll(at) });
    }),
  );

  router.get(
    '/shuttles/:shuttleId',
    asyncHandler((req, res) => {
      const shuttle = services.simulation.shuttleById(pathParam(req, 'shuttleId'));
      if (!shuttle) throw ApiError.notFound('Unknown shuttle');
      res.json({ shuttle: services.simulation.snapshot(shuttle) });
    }),
  );

  /** One call for the home screen: route, fleet and headline numbers. */
  router.get(
    '/status',
    asyncHandler((_req, res) => {
      const at = now();
      res.json({
        generatedAt: iso(at),
        route: routeSummary(),
        shuttles: services.simulation.snapshotAll(at),
        fleet: {
          size: services.simulation.fleetSize,
          active: services.simulation.activeShuttleCount(),
          passengersOnboard: services.simulation.totalPassengers(),
          headwaySeconds: Math.round(services.simulation.headwaySeconds()),
          averageWaitMinutes: services.simulation.averageWaitMinutes(),
        },
      });
    }),
  );

  return router;
}
