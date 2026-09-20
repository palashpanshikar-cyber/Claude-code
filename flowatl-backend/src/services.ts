/**
 * Composition root: builds the simulation and the domain services, wires their
 * event subscriptions and hands back a container the HTTP layer can use.
 */

import { AuthService } from './domain/auth.js';
import { FreightService } from './domain/freight.js';
import { ImpactService } from './domain/impact.js';
import { RideService } from './domain/rides.js';
import { NetworkSimulation, type SimulationOptions } from './domain/simulation.js';
import { SubscriptionService } from './domain/subscriptions.js';
import { getDb, openDatabase, type Db } from './store/db.js';

export interface Services {
  db: Db;
  simulation: NetworkSimulation;
  auth: AuthService;
  subscriptions: SubscriptionService;
  impact: ImpactService;
  rides: RideService;
  freight: FreightService;
  /** Begin ticking the network. */
  start(): void;
  /** Stop ticking and detach every subscription. */
  dispose(): void;
}

export interface CreateServicesOptions {
  db?: Db;
  databasePath?: string;
  simulation?: SimulationOptions;
}

export function createServices(options: CreateServicesOptions = {}): Services {
  const db =
    options.db ?? (options.databasePath ? openDatabase(options.databasePath) : getDb());

  const simulation = new NetworkSimulation(options.simulation ?? {});
  const auth = new AuthService(db);
  const subscriptions = new SubscriptionService(db);
  const impact = new ImpactService(db, simulation);
  const rides = new RideService(db, simulation, subscriptions, impact);
  const freight = new FreightService(db, impact);

  const detach: (() => void)[] = [impact.attach(), rides.attach()];

  // Freight runs progress on the same clock as the shuttle network, but
  // checking every tick would be wasteful — once every 5s is plenty.
  let lastFreightSweep = 0;
  detach.push(
    simulation.events.on('tick', ({ at }) => {
      if (at - lastFreightSweep < 5000) return;
      lastFreightSweep = at;
      freight.advanceShipments(at);
    }),
  );

  impact.ensureDay();
  freight.seedOpenLoads();

  return {
    db,
    simulation,
    auth,
    subscriptions,
    impact,
    rides,
    freight,
    start() {
      simulation.start();
    },
    dispose() {
      simulation.stop();
      for (const off of detach) off();
      impact.flush();
    },
  };
}
