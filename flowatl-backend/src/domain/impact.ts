/**
 * The impact ledger.
 *
 * Everything on the impact dashboard is an aggregate of things that actually
 * happened in the simulation: shuttles moved, riders completed trips, freight
 * was consolidated. Counters roll over at local midnight in Atlanta.
 */

import { hoursIntoServiceDay, now, serviceDate } from '../lib/clock.js';
import { BASELINE_RIDERS_PER_HOUR, HOURLY_DEMAND_CURVE } from './demand.js';
import { LOOP_MILES, STOP_COUNT, round } from './network.js';
import {
  CAR_DISPLACEMENT_RATE,
  SHUTTLE_KWH_PER_MILE,
  co2SavedLbs,
  ridehailPrice,
} from './pricing.js';
import type { NetworkSimulation } from './simulation.js';
import { toCents, usd, type Db } from '../store/db.js';

interface DailyRow {
  service_date: string;
  rides: number;
  booked_rides: number;
  co2_saved_lbs: number;
  fleet_miles: number;
  passenger_miles: number;
  energy_kwh: number;
  savings_cents: number;
  freight_loads: number;
  updated_at: number;
}

export interface NetworkImpact {
  serviceDate: string;
  ridesToday: number;
  bookedRidesToday: number;
  co2SavedLbsToday: number;
  carsRemovedToday: number;
  activeShuttles: number;
  fleetSize: number;
  averageWaitMinutes: number;
  passengersOnboardNow: number;
  fleetMilesToday: number;
  passengerMilesToday: number;
  energyKwhToday: number;
  riderSavingsUsdToday: number;
  freightLoadsToday: number;
  updatedAt: string;
}

export interface PersonalImpact {
  userId: string;
  ridesTaken: number;
  ridesThisMonth: number;
  moneySavedUsd: number;
  totalSpentUsd: number;
  co2SavedLbs: number;
  milesTravelled: number;
  favoriteStopId: string | null;
  rewardTier: { name: string; ridesRequired: number; ridesRemaining: number; progressPct: number };
}

/** Ride milestones the app celebrates. */
const REWARD_TIERS = [
  { name: 'Commuter', ridesRequired: 10 },
  { name: 'Regular', ridesRequired: 25 },
  { name: 'Downtown Local', ridesRequired: 50 },
  { name: 'Flow Champion', ridesRequired: 100 },
  { name: 'Founding Rider', ridesRequired: 250 },
] as const;

export class ImpactService {
  /** Sub-unit movement is buffered in memory and flushed to avoid a write per tick. */
  private pendingFleetMiles = 0;
  private pendingPassengerMiles = 0;
  private pendingCo2 = 0;
  private pendingRides = 0;
  private pendingSavingsCents = 0;
  private lastFlushAt = 0;

  constructor(
    private readonly db: Db,
    private readonly simulation: NetworkSimulation,
  ) {}

  /** Wire the ledger up to the simulation's event stream. */
  attach(): () => void {
    const offMoved = this.simulation.events.on('fleet:moved', ({ miles, passengerMiles }) => {
      this.pendingFleetMiles += miles;
      this.pendingPassengerMiles += passengerMiles;
    });
    const offAmbient = this.simulation.events.on('ambient:complete', ({ miles, occupancy }) => {
      this.pendingRides += 1;
      this.pendingCo2 += co2SavedLbs(miles, occupancy);
      // Walk-up riders save money too; count it toward network savings.
      this.pendingSavingsCents += toCents(Math.max(0, ridehailPrice(miles) - 1.5));
    });
    const offTick = this.simulation.events.on('tick', ({ at }) => {
      if (at - this.lastFlushAt >= 2000) this.flush(at);
    });
    return () => {
      offMoved();
      offAmbient();
      offTick();
    };
  }

  /** Write buffered simulation activity into the daily counters. */
  flush(at: number = now()): void {
    this.lastFlushAt = at;
    if (
      this.pendingFleetMiles === 0 &&
      this.pendingRides === 0 &&
      this.pendingCo2 === 0 &&
      this.pendingSavingsCents === 0
    ) {
      return;
    }
    const date = serviceDate(at);
    this.ensureDay(date, at);
    this.db
      .prepare(
        `UPDATE daily_counters
            SET rides = rides + ?,
                co2_saved_lbs = co2_saved_lbs + ?,
                fleet_miles = fleet_miles + ?,
                passenger_miles = passenger_miles + ?,
                energy_kwh = energy_kwh + ?,
                savings_cents = savings_cents + ?,
                updated_at = ?
          WHERE service_date = ?`,
      )
      .run(
        this.pendingRides,
        this.pendingCo2,
        this.pendingFleetMiles,
        this.pendingPassengerMiles,
        this.pendingFleetMiles * SHUTTLE_KWH_PER_MILE,
        Math.round(this.pendingSavingsCents),
        at,
        date,
      );
    this.pendingFleetMiles = 0;
    this.pendingPassengerMiles = 0;
    this.pendingCo2 = 0;
    this.pendingRides = 0;
    this.pendingSavingsCents = 0;
  }

  /**
   * Create the day's counters if they do not exist, pre-loaded with the
   * ridership the network would already have carried earlier in the day. A
   * dashboard opened at 3pm should not claim the city has taken zero trips.
   */
  ensureDay(date: string = serviceDate(), at: number = now()): DailyRow {
    const existing = this.db
      .prepare('SELECT * FROM daily_counters WHERE service_date = ?')
      .get(date) as DailyRow | undefined;
    if (existing) return existing;

    const hoursElapsed = hoursIntoServiceDay(at);
    let demandHours = 0;
    for (let hour = 0; hour < Math.floor(hoursElapsed); hour++) {
      demandHours += HOURLY_DEMAND_CURVE[hour]!;
    }
    demandHours +=
      (HOURLY_DEMAND_CURVE[Math.floor(hoursElapsed) % 24] ?? 0) * (hoursElapsed % 1);

    const rides = Math.round(BASELINE_RIDERS_PER_HOUR * demandHours);
    const averageTripMiles = (LOOP_MILES / STOP_COUNT) * 1.9;
    const passengerMiles = rides * averageTripMiles;
    const fleetMiles =
      this.simulation.fleetSize * (LOOP_MILES / this.simulation.loopSeconds()) * 3600 * hoursElapsed;
    const seeded: DailyRow = {
      service_date: date,
      rides,
      booked_rides: 0,
      co2_saved_lbs: round(rides * co2SavedLbs(averageTripMiles, 6), 1),
      fleet_miles: round(fleetMiles, 1),
      passenger_miles: round(passengerMiles, 1),
      energy_kwh: round(fleetMiles * SHUTTLE_KWH_PER_MILE, 1),
      savings_cents: toCents(rides * Math.max(0, ridehailPrice(averageTripMiles) - 1.75)),
      freight_loads: 0,
      updated_at: at,
    };
    this.db
      .prepare(
        `INSERT OR IGNORE INTO daily_counters
           (service_date, rides, booked_rides, co2_saved_lbs, fleet_miles, passenger_miles,
            energy_kwh, savings_cents, freight_loads, updated_at)
         VALUES (@service_date, @rides, @booked_rides, @co2_saved_lbs, @fleet_miles,
                 @passenger_miles, @energy_kwh, @savings_cents, @freight_loads, @updated_at)`,
      )
      .run(seeded);
    return seeded;
  }

  /** Record a completed booked ride against the day and the rider. */
  recordBookedRide(input: { co2SavedLbs: number; savingsCents: number; at?: number }): void {
    const at = input.at ?? now();
    const date = serviceDate(at);
    this.ensureDay(date, at);
    this.db
      .prepare(
        `UPDATE daily_counters
            SET rides = rides + 1,
                booked_rides = booked_rides + 1,
                co2_saved_lbs = co2_saved_lbs + ?,
                savings_cents = savings_cents + ?,
                updated_at = ?
          WHERE service_date = ?`,
      )
      .run(input.co2SavedLbs, Math.round(input.savingsCents), at, date);
  }

  recordFreightLoad(input: { co2SavedLbs: number; savingsCents: number; at?: number }): void {
    const at = input.at ?? now();
    const date = serviceDate(at);
    this.ensureDay(date, at);
    this.db
      .prepare(
        `UPDATE daily_counters
            SET freight_loads = freight_loads + 1,
                co2_saved_lbs = co2_saved_lbs + ?,
                savings_cents = savings_cents + ?,
                updated_at = ?
          WHERE service_date = ?`,
      )
      .run(input.co2SavedLbs, Math.round(input.savingsCents), at, date);
  }

  network(at: number = now()): NetworkImpact {
    this.flush(at);
    const date = serviceDate(at);
    const row = this.ensureDay(date, at);
    const current = (this.db
      .prepare('SELECT * FROM daily_counters WHERE service_date = ?')
      .get(date) ?? row) as DailyRow;

    return {
      serviceDate: date,
      ridesToday: current.rides,
      bookedRidesToday: current.booked_rides,
      co2SavedLbsToday: round(current.co2_saved_lbs, 1),
      // Not every rider would otherwise have driven — see CAR_DISPLACEMENT_RATE.
      carsRemovedToday: Math.round(current.rides * CAR_DISPLACEMENT_RATE),
      activeShuttles: this.simulation.activeShuttleCount(),
      fleetSize: this.simulation.fleetSize,
      averageWaitMinutes: this.simulation.averageWaitMinutes(),
      passengersOnboardNow: this.simulation.totalPassengers(),
      fleetMilesToday: round(current.fleet_miles, 1),
      passengerMilesToday: round(current.passenger_miles, 1),
      energyKwhToday: round(current.energy_kwh, 1),
      riderSavingsUsdToday: usd(current.savings_cents),
      freightLoadsToday: current.freight_loads,
      updatedAt: new Date(Math.max(current.updated_at, at)).toISOString(),
    };
  }

  personal(userId: string): PersonalImpact {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS rides,
                COALESCE(SUM(co2_saved_lbs), 0) AS co2,
                COALESCE(SUM(miles), 0) AS miles,
                COALESCE(SUM(ridehail_cents - fare_cents), 0) AS saved_cents,
                COALESCE(SUM(fare_cents), 0) AS spent_cents
           FROM rides
          WHERE user_id = ? AND status = 'completed'`,
      )
      .get(userId) as {
      rides: number;
      co2: number;
      miles: number;
      saved_cents: number;
      spent_cents: number;
    };

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const monthly = this.db
      .prepare(
        `SELECT COUNT(*) AS rides FROM rides
          WHERE user_id = ? AND status = 'completed' AND completed_at >= ?`,
      )
      .get(userId, monthStart.getTime()) as { rides: number };

    const favorite = this.db
      .prepare(
        `SELECT pickup_stop_id AS stop, COUNT(*) AS n FROM rides
          WHERE user_id = ? AND status = 'completed'
          GROUP BY pickup_stop_id ORDER BY n DESC LIMIT 1`,
      )
      .get(userId) as { stop: string; n: number } | undefined;

    const tier =
      REWARD_TIERS.find((t) => totals.rides < t.ridesRequired) ??
      REWARD_TIERS[REWARD_TIERS.length - 1]!;
    const ridesRemaining = Math.max(0, tier.ridesRequired - totals.rides);

    return {
      userId,
      ridesTaken: totals.rides,
      ridesThisMonth: monthly.rides,
      moneySavedUsd: usd(Math.max(0, totals.saved_cents)),
      totalSpentUsd: usd(totals.spent_cents),
      co2SavedLbs: round(totals.co2, 1),
      milesTravelled: round(totals.miles, 1),
      favoriteStopId: favorite?.stop ?? null,
      rewardTier: {
        name: tier.name,
        ridesRequired: tier.ridesRequired,
        ridesRemaining,
        progressPct: round(Math.min(100, (totals.rides / tier.ridesRequired) * 100), 0),
      },
    };
  }
}
