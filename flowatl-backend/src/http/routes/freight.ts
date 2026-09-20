import { Router } from 'express';
import { CARGO_TYPES, VAN_CAPACITY_LBS } from '../../domain/freight.js';
import { DELIVERY_WINDOWS, ZONES } from '../../domain/zones.js';
import { ApiError } from '../../lib/errors.js';
import type { Services } from '../../services.js';
import { pathParam } from '../params.js';
import { currentUser, optionalAuth, requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { freightConfirmSchema, freightQuoteSchema, paginationSchema } from '../schemas.js';

export function freightRouter(services: Services): Router {
  const router = Router();

  /** Everything the shipment form needs to render its dropdowns. */
  router.get(
    '/options',
    asyncHandler((_req, res) => {
      res.json({
        cargoTypes: CARGO_TYPES,
        deliveryWindows: DELIVERY_WINDOWS,
        vanCapacityLbs: VAN_CAPACITY_LBS,
        zones: ZONES.map(({ id, name }) => ({ id, name })),
      });
    }),
  );

  /** Loads currently looking for a van. */
  router.get(
    '/loads',
    asyncHandler((req, res) => {
      const { limit } = paginationSchema.parse(req.query);
      res.json({ loads: services.freight.listOpenLoads(limit) });
    }),
  );

  /**
   * Match this load against the open pool and price the consolidated run.
   * Signed out is fine — a business should see the saving before signing up.
   */
  router.post(
    '/quote',
    optionalAuth(services),
    asyncHandler((req, res) => {
      const input = freightQuoteSchema.parse(req.body);
      res.json({ quote: services.freight.quote(input) });
    }),
  );

  router.get(
    '/shipments',
    requireAuth(services),
    asyncHandler((req, res) => {
      const { limit } = paginationSchema.parse(req.query);
      res.json({ shipments: services.freight.listShipmentsForUser(currentUser(req).id, limit) });
    }),
  );

  /** Confirm consolidation: claim the matched loads and dispatch a van. */
  router.post(
    '/shipments',
    requireAuth(services),
    asyncHandler((req, res) => {
      const { businessName, notes, ...input } = freightConfirmSchema.parse(req.body);
      const user = currentUser(req);
      const shipment = services.freight.confirm(
        user.id,
        businessName ?? user.business_name ?? user.display_name,
        { ...input, ...(notes === undefined ? {} : { notes }) },
      );
      res.status(201).json({ shipment });
    }),
  );

  router.get(
    '/shipments/:shipmentId',
    requireAuth(services),
    asyncHandler((req, res) => {
      const user = currentUser(req);
      const shipment = services.freight.shipmentView(pathParam(req, 'shipmentId'), user.id);
      // A shipment is visible to the businesses whose cargo is on the van.
      if (!shipment.loads.some((load) => load.isYours)) {
        throw ApiError.forbidden('That shipment belongs to another business');
      }
      res.json({ shipment });
    }),
  );

  return router;
}
