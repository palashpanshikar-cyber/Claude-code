import { Router } from 'express';
import type { Services } from '../../services.js';
import { authRouter } from './auth.js';
import { freightRouter } from './freight.js';
import { impactRouter } from './impact.js';
import { networkRouter } from './network.js';
import { ridesRouter } from './rides.js';
import { streamRouter } from './stream.js';
import { subscriptionsRouter } from './subscriptions.js';

export function apiRouter(services: Services): Router {
  const router = Router();

  router.use('/auth', authRouter(services));
  router.use('/network', networkRouter(services));
  router.use('/rides', ridesRouter(services));
  router.use('/subscriptions', subscriptionsRouter(services));
  router.use('/freight', freightRouter(services));
  router.use('/impact', impactRouter(services));
  router.use('/stream', streamRouter(services));

  return router;
}
