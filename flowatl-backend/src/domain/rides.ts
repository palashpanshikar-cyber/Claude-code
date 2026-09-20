/**
 * Ride booking and the live-tracking state machine.
 *
 * A booked ride is bound to a real shuttle in the simulation: it holds a seat,
 * boards when that shuttle departs the pickup stop and completes when the
 * shuttle reaches the destination. The phases the app displays
 * (Approaching -> Arrived -> Boarding -> En Route -> Arriving at Destination)
 * are derived from where that shuttle actually is.
 */

import { config } from '../config.js';
import { iso, now, serviceDate } from '../lib/clock.js';
import { ApiError } from '../lib/errors.js';
import { newBoardingToken, newId } from '../lib/ids.js';
import { TypedEmitter } from '../lib/events.js';
import {
  nextStopIndex,
  round,
  stopAt,
  stopById,
  stopIndex,
  stopsBetween,
  tripMiles,
} from './network.js';
import { quoteRide, type FareQuote } from './pricing.js';
import type { ImpactService } from './impact.js';
import type { NetworkSimulation, ShuttleSnapshot } from './simulation.js';
import type { SubscriptionService } from './subscriptions.js';
import { toCents, usd, type Db } from '../store/db.js';

export type RideStatus = 'awaiting_pickup' | 'onboard' | 'completed' | 'cancelled';

export type RidePhase =
  | 'Approaching'
  | 'Arrived'
  | 'Boarding'
  | 'En Route'
  | 'Arriving at Destination'
  | 'Completed'
  | 'Cancelled';

/** Ordered phases, so the client can render a progress bar without hardcoding them. */
export const RIDE_PHASES: readonly RidePhase[] = [
  'Approaching',
  'Arrived',
  'Boarding',
  'En Route',
  'Arriving at Destination',
];

interface RideRow {
  id: string;
  user_id: string;
  pickup_stop_id: string;
  destination_stop_id: string;
  shuttle_id: string | null;
  shuttle_label: string | null;
  status: RideStatus;
  stops_traversed: number;
  miles: number;
  fare_cents: number;
  list_fare_cents: number;
  ridehail_cents: number;
  co2_saved_lbs: number;
  covered_by_subscription: number;
  boarding_token: string;
  service_date: string;
  booked_at: number;
  pickup_eta_at: number | null;
  boarded_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
}

export interface RideView {
  id: string;
  status: RideStatus;
  phase: RidePhase;
  phaseIndex: number;
  phases: readonly RidePhase[];
  pickup: { id: string; name: string };
  destination: { id: string; name: string };
  shuttle: ShuttleSnapshot | null;
  shuttleLabel: string | null;
  passengersOnboard: number | null;
  stopsTraversed: number;
  miles: number;
  fareUsd: number;
  listFareUsd: number;
  ridehailUsd: number;
  savingsUsd: number;
  co2SavedLbs: number;
  coveredBySubscription: boolean;
  /** Seconds until the shuttle reaches the pickup stop; 0 once aboard. */
  pickupEtaSeconds: number;
  /** Seconds until the rider reaches their destination. */
  etaSeconds: number;
  etaMinutes: number;
  /** Door-to-door progress, 0-100. */
  progressPct: number;
  boardingPass: { token: string; qrPayload: string } | null;
  bookedAt: string;
  boardedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface RideQuote extends FareQuote {
  pickup: { id: string; name: string };
  destination: { id: string; name: string };
  shuttle: { id: string; label: string; passengers: number; availableSeats: number } | null;
  pickupEtaSeconds: number;
  pickupEtaMinutes: number;
  arrivesAt: string | null;
  serviceAvailable: boolean;
}

export interface RideEvents {
  'ride:updated': { rideId: string; userId: string };
}

export class RideService {
  readonly events = new TypedEmitter<RideEvents>();

  constructor(
    private readonly db: Db,
    private readonly simulation: NetworkSimulation,
    private readonly subscriptions: SubscriptionService,
    private readonly impact: ImpactService,
  ) {}

  /** React to the fleet: board riders on departure, drop them on arrival. */
  attach(): () => void {
    const offArrive = this.simulation.events.on('shuttle:arrive', ({ shuttle, stopIndex: index, at }) => {
      this.completeArrivingRides(shuttle.id, index, at);
    });
    const offDepart = this.simulation.events.on('shuttle:depart', ({ shuttle, stopIndex: index, at }) => {
      this.boardWaitingRides(shuttle.id, index, at);
    });
    return () => {
      offArrive();
      offDepart();
    };
  }

  // --- quoting and booking ----------------------------------------------

  quote(pickupStopId: string, destinationStopId: string, userId?: string): RideQuote {
    if (pickupStopId === destinationStopId) {
      throw ApiError.badRequest('Pickup and destination must be different stops');
    }
    const at = now();
    const hasSubscription = userId ? this.subscriptions.hasActive(userId, at) : false;
    const assignment = this.simulation.assignShuttle(pickupStopId, destinationStopId, at);
    const occupancy = assignment
      ? this.simulation.passengerCount(assignment.shuttle) + 1
      : undefined;

    const base = quoteRide(pickupStopId, destinationStopId, {
      hasSubscription,
      ...(occupancy !== undefined ? { occupancy } : {}),
      ...(assignment ? { estimatedMinutes: Math.round(assignment.tripSeconds / 60) } : {}),
    });

    const pickupEtaSeconds = assignment ? Math.round(assignment.pickupEtaSeconds) : 0;
    return {
      ...base,
      pickup: this.stopRef(pickupStopId),
      destination: this.stopRef(destinationStopId),
      shuttle: assignment
        ? {
            id: assignment.shuttle.id,
            label: assignment.shuttle.label,
            passengers: this.simulation.passengerCount(assignment.shuttle),
            availableSeats: this.simulation.availableSeats(assignment.shuttle),
          }
        : null,
      pickupEtaSeconds,
      pickupEtaMinutes: Math.max(1, Math.round(pickupEtaSeconds / 60)),
      arrivesAt: assignment
        ? iso(at + (assignment.pickupEtaSeconds + assignment.tripSeconds) * 1000)
        : null,
      serviceAvailable: assignment !== null,
    };
  }

  book(userId: string, pickupStopId: string, destinationStopId: string): RideView {
    if (pickupStopId === destinationStopId) {
      throw ApiError.badRequest('Pickup and destination must be different stops');
    }
    const at = now();

    const openRide = this.db
      .prepare(
        `SELECT id FROM rides WHERE user_id = ? AND status IN ('awaiting_pickup','onboard') LIMIT 1`,
      )
      .get(userId) as { id: string } | undefined;
    if (openRide) {
      throw ApiError.conflict('This account already has a ride in progress', {
        rideId: openRide.id,
      });
    }

    const assignment = this.simulation.assignShuttle(pickupStopId, destinationStopId, at);
    if (!assignment) {
      throw new ApiError(
        503,
        'no_capacity',
        'Every shuttle on the loop is full right now — try again in a minute',
      );
    }
    if (!this.simulation.holdSeat(assignment.shuttle.id)) {
      throw new ApiError(503, 'no_capacity', 'That shuttle filled up while you were booking');
    }

    const hasSubscription = this.subscriptions.hasActive(userId, at);
    const occupancy = this.simulation.passengerCount(assignment.shuttle) + 1;
    const quote = quoteRide(pickupStopId, destinationStopId, {
      hasSubscription,
      occupancy,
      estimatedMinutes: Math.round(assignment.tripSeconds / 60),
    });

    const row: RideRow = {
      id: newId('ride'),
      user_id: userId,
      pickup_stop_id: pickupStopId,
      destination_stop_id: destinationStopId,
      shuttle_id: assignment.shuttle.id,
      shuttle_label: assignment.shuttle.label,
      status: 'awaiting_pickup',
      stops_traversed: quote.stopsTraversed,
      miles: quote.miles,
      fare_cents: toCents(quote.fareUsd),
      list_fare_cents: toCents(quote.listFareUsd),
      ridehail_cents: toCents(quote.ridehailUsd),
      co2_saved_lbs: quote.co2SavedLbs,
      covered_by_subscription: hasSubscription ? 1 : 0,
      boarding_token: newBoardingToken(),
      service_date: serviceDate(at),
      booked_at: at,
      pickup_eta_at: at + assignment.pickupEtaSeconds * 1000,
      boarded_at: null,
      completed_at: null,
      cancelled_at: null,
    };

    try {
      this.db
        .prepare(
          `INSERT INTO rides
             (id, user_id, pickup_stop_id, destination_stop_id, shuttle_id, shuttle_label, status,
              stops_traversed, miles, fare_cents, list_fare_cents, ridehail_cents, co2_saved_lbs,
              covered_by_subscription, boarding_token, service_date, booked_at, pickup_eta_at,
              boarded_at, completed_at, cancelled_at)
           VALUES
             (@id, @user_id, @pickup_stop_id, @destination_stop_id, @shuttle_id, @shuttle_label, @status,
              @stops_traversed, @miles, @fare_cents, @list_fare_cents, @ridehail_cents, @co2_saved_lbs,
              @covered_by_subscription, @boarding_token, @service_date, @booked_at, @pickup_eta_at,
              @boarded_at, @completed_at, @cancelled_at)`,
        )
        .run(row);
    } catch (error) {
      // Never strand a held seat if the write fails.
      this.simulation.releaseSeat(assignment.shuttle.id);
      throw error;
    }

    this.events.emit('ride:updated', { rideId: row.id, userId });
    return this.toView(row, at, true);
  }

  cancel(rideId: string, userId: string): RideView {
    const row = this.requireRide(rideId, userId);
    if (row.status === 'completed') throw ApiError.conflict('That ride has already finished');
    if (row.status === 'cancelled') return this.toView(row, now(), false);

    const at = now();
    if (row.shuttle_id) {
      if (row.status === 'awaiting_pickup') this.simulation.releaseSeat(row.shuttle_id);
      else this.simulation.alightRide(row.shuttle_id, row.id);
    }
    this.db
      .prepare(`UPDATE rides SET status = 'cancelled', cancelled_at = ? WHERE id = ?`)
      .run(at, rideId);
    const updated = { ...row, status: 'cancelled' as RideStatus, cancelled_at: at };
    this.events.emit('ride:updated', { rideId, userId });
    return this.toView(updated, at, false);
  }

  // --- reads -------------------------------------------------------------

  get(rideId: string, userId: string): RideView {
    const row = this.requireRide(rideId, userId);
    return this.toView(row, now(), row.status === 'awaiting_pickup' || row.status === 'onboard');
  }

  /** The rider's ride in progress, if any. */
  active(userId: string): RideView | null {
    const row = this.db
      .prepare(
        `SELECT * FROM rides WHERE user_id = ? AND status IN ('awaiting_pickup','onboard')
          ORDER BY booked_at DESC LIMIT 1`,
      )
      .get(userId) as RideRow | undefined;
    return row ? this.toView(row, now(), true) : null;
  }

  history(userId: string, limit = 25): RideView[] {
    const rows = this.db
      .prepare('SELECT * FROM rides WHERE user_id = ? ORDER BY booked_at DESC LIMIT ?')
      .all(userId, Math.min(100, Math.max(1, limit))) as RideRow[];
    const at = now();
    return rows.map((row) => this.toView(row, at, false));
  }

  // --- simulation hooks --------------------------------------------------

  private boardWaitingRides(shuttleId: string, index: number, at: number): void {
    const stopId = stopAt(index).id;
    const rows = this.db
      .prepare(
        `SELECT * FROM rides
          WHERE shuttle_id = ? AND status = 'awaiting_pickup' AND pickup_stop_id = ?`,
      )
      .all(shuttleId, stopId) as RideRow[];
    for (const row of rows) {
      this.simulation.boardRide(shuttleId, row.id);
      this.db
        .prepare(`UPDATE rides SET status = 'onboard', boarded_at = ? WHERE id = ?`)
        .run(at, row.id);
      this.events.emit('ride:updated', { rideId: row.id, userId: row.user_id });
    }
  }

  private completeArrivingRides(shuttleId: string, index: number, at: number): void {
    const stopId = stopAt(index).id;
    const rows = this.db
      .prepare(
        `SELECT * FROM rides
          WHERE shuttle_id = ? AND status = 'onboard' AND destination_stop_id = ?`,
      )
      .all(shuttleId, stopId) as RideRow[];
    for (const row of rows) {
      this.simulation.alightRide(shuttleId, row.id);
      this.db
        .prepare(`UPDATE rides SET status = 'completed', completed_at = ? WHERE id = ?`)
        .run(at, row.id);
      this.impact.recordBookedRide({
        co2SavedLbs: row.co2_saved_lbs,
        savingsCents: Math.max(0, row.ridehail_cents - row.fare_cents),
        at,
      });
      this.events.emit('ride:updated', { rideId: row.id, userId: row.user_id });
    }
  }

  // --- helpers -----------------------------------------------------------

  private stopRef(id: string): { id: string; name: string } {
    const stop = stopById(id);
    return { id: stop.id, name: stop.name };
  }

  private requireRide(rideId: string, userId: string): RideRow {
    const row = this.db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId) as
      | RideRow
      | undefined;
    if (!row) throw ApiError.notFound('Ride not found');
    if (row.user_id !== userId) throw ApiError.forbidden('That ride belongs to another account');
    return row;
  }

  private toView(row: RideRow, at: number, includePass: boolean): RideView {
    const shuttle = row.shuttle_id ? this.simulation.shuttleById(row.shuttle_id) : undefined;
    const pickupIndex = stopIndex(row.pickup_stop_id);
    const destinationIndex = stopIndex(row.destination_stop_id);

    let pickupEtaSeconds = 0;
    let etaSeconds = 0;
    if (shuttle && (row.status === 'awaiting_pickup' || row.status === 'onboard')) {
      etaSeconds = Math.round(this.simulation.estimateArrivalSeconds(shuttle, destinationIndex, at));
      if (row.status === 'awaiting_pickup') {
        pickupEtaSeconds = Math.round(
          this.simulation.estimateArrivalSeconds(shuttle, pickupIndex, at),
        );
      }
    }

    const phase = this.derivePhase(row, at);
    // Door-to-door: waiting for the shuttle, then riding it. Measured against
    // the live ETA rather than the wall clock, so it holds at any TIME_SCALE.
    const plannedSeconds = Math.max(
      1,
      ((row.pickup_eta_at ?? row.booked_at) - row.booked_at) / 1000 +
        this.tripDurationMs(row) / 1000,
    );
    // etaSeconds already spans "wait for the shuttle" plus "ride it".
    const progressPct =
      row.status === 'completed'
        ? 100
        : row.status === 'cancelled'
          ? 0
          : round(Math.max(0, Math.min(99, (1 - etaSeconds / plannedSeconds) * 100)), 0);

    return {
      id: row.id,
      status: row.status,
      phase,
      phaseIndex: RIDE_PHASES.indexOf(phase),
      phases: RIDE_PHASES,
      pickup: this.stopRef(row.pickup_stop_id),
      destination: this.stopRef(row.destination_stop_id),
      shuttle: shuttle ? this.simulation.snapshot(shuttle, at) : null,
      shuttleLabel: row.shuttle_label,
      passengersOnboard: shuttle ? this.simulation.passengerCount(shuttle) : null,
      stopsTraversed: row.stops_traversed,
      miles: row.miles,
      fareUsd: usd(row.fare_cents),
      listFareUsd: usd(row.list_fare_cents),
      ridehailUsd: usd(row.ridehail_cents),
      savingsUsd: usd(Math.max(0, row.ridehail_cents - row.fare_cents)),
      co2SavedLbs: row.co2_saved_lbs,
      coveredBySubscription: row.covered_by_subscription === 1,
      pickupEtaSeconds,
      etaSeconds,
      etaMinutes:
        row.status === 'completed' || row.status === 'cancelled'
          ? 0
          : Math.max(1, Math.round(etaSeconds / 60)),
      progressPct,
      boardingPass: includePass
        ? {
            token: row.boarding_token,
            qrPayload: `flowatl://board?ride=${row.id}&token=${row.boarding_token}`,
          }
        : null,
      bookedAt: iso(row.booked_at),
      boardedAt: row.boarded_at ? iso(row.boarded_at) : null,
      completedAt: row.completed_at ? iso(row.completed_at) : null,
      cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    };
  }

  /** Modelled in-vehicle time for the booked leg, in milliseconds. */
  private tripDurationMs(row: RideRow): number {
    const miles = tripMiles(row.pickup_stop_id, row.destination_stop_id);
    const stops = stopsBetween(row.pickup_stop_id, row.destination_stop_id);
    const driveSeconds = (miles / config.shuttleSpeedMph) * 3600;
    return (driveSeconds + stops * config.stopDwellSeconds) * 1000;
  }

  private derivePhase(row: RideRow, at: number): RidePhase {
    if (row.status === 'cancelled') return 'Cancelled';
    if (row.status === 'completed') return 'Completed';

    const shuttle = row.shuttle_id ? this.simulation.shuttleById(row.shuttle_id) : undefined;
    if (!shuttle) return row.status === 'onboard' ? 'En Route' : 'Approaching';

    if (row.status === 'awaiting_pickup') {
      const atPickup =
        shuttle.atStopIndex !== null && stopAt(shuttle.atStopIndex).id === row.pickup_stop_id;
      if (!atPickup || shuttle.status !== 'dwelling') return 'Approaching';
      // The dwell splits into "we're here" and "doors open, come aboard".
      const remainingMs = (shuttle.dwellEndsAt ?? at) - at;
      return remainingMs > this.simulation.halfDwellMs() ? 'Arrived' : 'Boarding';
    }

    const upcoming = stopAt(
      shuttle.atStopIndex !== null
        ? shuttle.atStopIndex + 1
        : nextStopIndex(shuttle.distanceMiles),
    );
    return upcoming.id === row.destination_stop_id ? 'Arriving at Destination' : 'En Route';
  }
}
