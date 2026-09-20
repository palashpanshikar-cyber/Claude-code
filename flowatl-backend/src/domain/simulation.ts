/**
 * The live network simulation.
 *
 * A fleet of autonomous electric shuttles runs the downtown loop on a fixed
 * tick. Positions, dwell times, passenger loads, battery state and every
 * arrival estimate the API serves come from this one engine, so the map, the
 * countdown, the booking card and the impact dashboard can never disagree.
 */

import { config } from '../config.js';
import { hoursIntoServiceDay, now as currentTime } from '../lib/clock.js';
import { TypedEmitter } from '../lib/events.js';
import { Rng } from '../lib/rng.js';
import { drawDestination, expectedBoardings } from './demand.js';
import {
  LOOP_MILES,
  STOP_COUNT,
  forwardMiles,
  nextStopIndex,
  pointAtMiles,
  round,
  stopAt,
  stopDistance,
  stopIndex,
  wrapDistance,
} from './network.js';
import { SHUTTLE_KWH_PER_MILE } from './pricing.js';

export type ShuttleStatus = 'in_service' | 'dwelling' | 'charging';

/** Usable battery capacity of a shuttle pack, in kWh. */
export const BATTERY_PACK_KWH = 64;
/** Below this state of charge a shuttle pulls into the depot to top up. */
export const CHARGE_THRESHOLD_PCT = 22;
/** Opportunity charging rate at the depot, in percentage points per minute. */
export const CHARGE_RATE_PCT_PER_MINUTE = 28;
/** Charging stops when the pack reaches this level. */
export const CHARGE_TARGET_PCT = 92;

export interface Shuttle {
  id: string;
  /** Fleet number shown to riders, e.g. "FLO-03". */
  label: string;
  routeId: string;
  /** Position as miles travelled along the loop from Five Points. */
  distanceMiles: number;
  status: ShuttleStatus;
  /** Stop the shuttle is sitting at, or null while moving. */
  atStopIndex: number | null;
  dwellEndsAt: number | null;
  chargeEndsAt: number | null;
  capacity: number;
  /** Walk-up riders aboard, indexed by destination stop. */
  ambientByDestination: number[];
  /** Ids of booked rides currently aboard. */
  onboardRideIds: Set<string>;
  /** Seats held for booked riders who have not boarded yet. */
  heldSeats: number;
  batteryPct: number;
  /**
   * Set when the pack drops below the charge threshold: the shuttle stops
   * taking new riders and runs to the depot to top up. Without this a busy
   * shuttle never empties at the depot and would drive on a flat battery.
   */
  outOfService: boolean;
  speedMph: number;
  odometerMiles: number;
  /** Total boardings since the service day began. */
  boardingsToday: number;
}

export interface ShuttleSnapshot {
  id: string;
  label: string;
  routeId: string;
  status: ShuttleStatus;
  distanceMiles: number;
  /** Position along the loop as a 0-1 fraction — convenient for animation. */
  loopProgress: number;
  position: { x: number; y: number; bearing: number };
  atStopId: string | null;
  nextStopId: string;
  nextStopEtaSeconds: number;
  passengers: number;
  capacity: number;
  availableSeats: number;
  occupancyPct: number;
  batteryPct: number;
  /** False while the shuttle is running empty to the depot, or charging. */
  acceptingRiders: boolean;
  speedMph: number;
  odometerMiles: number;
}

export interface StopArrival {
  shuttleId: string;
  shuttleLabel: string;
  etaSeconds: number;
  etaMinutes: number;
  passengers: number;
  availableSeats: number;
  status: ShuttleStatus;
}

export interface SimulationEvents {
  tick: { at: number; elapsedSeconds: number };
  'shuttle:arrive': { shuttle: Shuttle; stopIndex: number; at: number };
  'shuttle:depart': { shuttle: Shuttle; stopIndex: number; at: number };
  /** A walk-up rider completed a trip — feeds the impact ledger. */
  'ambient:complete': { shuttleId: string; miles: number; occupancy: number; at: number };
  'fleet:moved': { at: number; miles: number; passengerMiles: number };
}

export interface SimulationOptions {
  fleetSize?: number;
  capacity?: number;
  speedMph?: number;
  dwellSeconds?: number;
  seed?: number;
  timeScale?: number;
  /** Source of wall-clock time; overridable in tests. */
  clock?: () => number;
}

export class NetworkSimulation {
  readonly events = new TypedEmitter<SimulationEvents>();

  private readonly shuttles: Shuttle[] = [];
  private readonly rng: Rng;
  private readonly dwellSeconds: number;
  private readonly cruiseSpeedMph: number;
  private readonly timeScale: number;
  private readonly clock: () => number;
  private lastTickAt: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SimulationOptions = {}) {
    const fleetSize = Math.max(1, Math.floor(options.fleetSize ?? config.fleetSize));
    const capacity = Math.max(1, Math.floor(options.capacity ?? config.shuttleCapacity));
    const speedMph = options.speedMph ?? config.shuttleSpeedMph;
    this.cruiseSpeedMph = speedMph;
    this.dwellSeconds = options.dwellSeconds ?? config.stopDwellSeconds;
    this.timeScale = Math.max(0.1, options.timeScale ?? config.timeScale);
    this.clock = options.clock ?? currentTime;
    this.rng = new Rng(options.seed ?? config.simSeed);
    this.lastTickAt = this.clock();

    // Space the fleet evenly around the loop so headways start out uniform.
    for (let i = 0; i < fleetSize; i++) {
      const label = `FLO-${String(i + 1).padStart(2, '0')}`;
      this.shuttles.push({
        id: `shuttle_${label.toLowerCase().replace('-', '')}`,
        label,
        routeId: 'downtown-loop',
        distanceMiles: wrapDistance((LOOP_MILES / fleetSize) * i),
        status: 'in_service',
        atStopIndex: null,
        dwellEndsAt: null,
        chargeEndsAt: null,
        capacity,
        ambientByDestination: new Array(STOP_COUNT).fill(0),
        onboardRideIds: new Set(),
        heldSeats: 0,
        // Stagger the starting charge so the fleet does not all need the depot at once.
        batteryPct: round(this.rng.float(46, 96), 1),
        outOfService: false,
        speedMph,
        odometerMiles: 0,
        boardingsToday: 0,
      });
    }

    // Warm the fleet up so the first API response already looks like a
    // network mid-service rather than an empty one.
    this.warmUp();
  }

  // --- lifecycle ---------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.lastTickAt = this.clock();
    this.timer = setInterval(() => this.tick(), config.tickMs);
    // Never hold the process open just for the simulation loop.
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Advance the world. Called on a timer, or directly from tests. */
  tick(at: number = this.clock()): void {
    const elapsedMs = Math.max(0, at - this.lastTickAt);
    this.lastTickAt = at;
    // Skip absurd jumps (laptop sleep, debugger pause) rather than teleporting.
    const elapsedSeconds = Math.min(120, (elapsedMs / 1000) * this.timeScale);
    if (elapsedSeconds <= 0) return;

    let fleetMiles = 0;
    let passengerMiles = 0;
    for (const shuttle of this.shuttles) {
      const moved = this.advanceShuttle(shuttle, elapsedSeconds, at);
      fleetMiles += moved;
      passengerMiles += moved * this.passengerCount(shuttle);
    }

    if (fleetMiles > 0) {
      this.events.emit('fleet:moved', { at, miles: fleetMiles, passengerMiles });
    }
    this.events.emit('tick', { at, elapsedSeconds });
  }

  /**
   * Run the network forward before serving the first request, so the API
   * opens on a fleet that is already spread out and carrying riders rather
   * than a line of empty shuttles at Five Points. Nothing is listening to
   * events yet, so the warm-up leaves no trace in the impact ledger.
   */
  private warmUp(): void {
    const end = this.clock();
    const stepSeconds = 4;
    let at = end - this.loopSeconds() * 1.5 * 1000;
    while (at < end) {
      for (const shuttle of this.shuttles) {
        this.advanceShuttle(shuttle, stepSeconds, at);
      }
      at += stepSeconds * 1000;
    }
    for (const shuttle of this.shuttles) {
      shuttle.odometerMiles = 0;
      shuttle.boardingsToday = 0;
    }
    this.lastTickAt = end;
  }

  /**
   * TIME_SCALE compresses the whole world, not just driving: a dwell that
   * lasts 30 simulated seconds takes 30/scale seconds on the wall clock.
   */
  private wallClockMsFor(simSeconds: number): number {
    return (simSeconds / this.timeScale) * 1000;
  }

  private simSecondsFor(wallClockMs: number): number {
    return (wallClockMs / 1000) * this.timeScale;
  }

  // --- movement ----------------------------------------------------------

  /** Advance one shuttle, returning the miles it covered. */
  private advanceShuttle(shuttle: Shuttle, elapsedSeconds: number, at: number): number {
    if (shuttle.status === 'charging') {
      shuttle.batteryPct = Math.min(
        CHARGE_TARGET_PCT,
        shuttle.batteryPct + (CHARGE_RATE_PCT_PER_MINUTE * elapsedSeconds) / 60,
      );
      if (shuttle.batteryPct >= CHARGE_TARGET_PCT || (shuttle.chargeEndsAt ?? 0) <= at) {
        shuttle.status = 'in_service';
        shuttle.chargeEndsAt = null;
        shuttle.atStopIndex = null;
        shuttle.outOfService = false;
      }
      return 0;
    }

    if (shuttle.status === 'dwelling') {
      if ((shuttle.dwellEndsAt ?? 0) > at) return 0;
      this.departStop(shuttle, at);
      return 0;
    }

    // Traffic is not uniform: vary speed a little around the cruising figure.
    const speed = Math.max(3, shuttle.speedMph * this.rng.float(0.88, 1.12));
    let remaining = (speed * elapsedSeconds) / 3600;
    let travelled = 0;
    let guard = 0;

    while (remaining > 0 && guard++ <= STOP_COUNT + 1) {
      const next = nextStopIndex(shuttle.distanceMiles);
      const toStop = forwardMiles(shuttle.distanceMiles, stopDistance(next));
      if (remaining < toStop) {
        shuttle.distanceMiles = wrapDistance(shuttle.distanceMiles + remaining);
        travelled += remaining;
        remaining = 0;
        break;
      }
      shuttle.distanceMiles = stopDistance(next);
      travelled += toStop;
      remaining -= toStop;
      this.arriveAtStop(shuttle, next, at);
      if (shuttle.status !== 'in_service') break;
    }

    shuttle.odometerMiles = round(shuttle.odometerMiles + travelled, 4);
    shuttle.batteryPct = Math.max(
      0,
      shuttle.batteryPct - ((travelled * SHUTTLE_KWH_PER_MILE) / BATTERY_PACK_KWH) * 100,
    );
    if (shuttle.batteryPct <= CHARGE_THRESHOLD_PCT) {
      shuttle.outOfService = true;
    }
    return travelled;
  }

  private arriveAtStop(shuttle: Shuttle, index: number, at: number): void {
    shuttle.atStopIndex = index;
    shuttle.status = 'dwelling';
    shuttle.dwellEndsAt = at + this.wallClockMsFor(this.dwellSeconds);

    // Walk-up riders bound for this stop get off first, freeing seats.
    const alighting = shuttle.ambientByDestination[index] ?? 0;
    if (alighting > 0) {
      shuttle.ambientByDestination[index] = 0;
      const occupancy = Math.max(1, this.passengerCount(shuttle) + alighting);
      for (let i = 0; i < alighting; i++) {
        this.events.emit('ambient:complete', {
          shuttleId: shuttle.id,
          // Attribute an average trip length; exact origins are not tracked
          // for walk-up riders.
          miles: LOOP_MILES / STOP_COUNT,
          occupancy,
          at,
        });
      }
    }

    this.events.emit('shuttle:arrive', { shuttle, stopIndex: index, at });
    this.boardAmbientRiders(shuttle, index, at);
  }

  private boardAmbientRiders(shuttle: Shuttle, index: number, at: number): void {
    // A shuttle heading for the depot runs empty; riders take the next one.
    if (shuttle.outOfService) return;
    const hour = hoursIntoServiceDay(at);
    const expected = expectedBoardings(index, hour, this.headwaySeconds());
    let waiting = this.rng.poisson(expected);
    while (waiting-- > 0) {
      if (this.availableSeats(shuttle) <= 0) break; // Riders left behind wait for the next shuttle.
      const destination = drawDestination(index, this.rng.next());
      shuttle.ambientByDestination[destination] =
        (shuttle.ambientByDestination[destination] ?? 0) + 1;
      shuttle.boardingsToday += 1;
    }
  }

  private departStop(shuttle: Shuttle, at: number): void {
    const index = shuttle.atStopIndex;
    shuttle.status = 'in_service';
    shuttle.dwellEndsAt = null;
    shuttle.atStopIndex = null;
    if (index !== null) {
      this.events.emit('shuttle:depart', { shuttle, stopIndex: index, at });
      // Top up once the shuttle has emptied out and reached the depot. Booked
      // riders are still carried to their stop, so this lands within a lap.
      if (stopAt(index).depot && shuttle.outOfService && this.passengerCount(shuttle) === 0) {
        const minutesNeeded =
          (CHARGE_TARGET_PCT - shuttle.batteryPct) / CHARGE_RATE_PCT_PER_MINUTE;
        shuttle.status = 'charging';
        shuttle.atStopIndex = index;
        shuttle.chargeEndsAt = at + this.wallClockMsFor(minutesNeeded * 60);
      }
    }
  }

  // --- passengers --------------------------------------------------------

  passengerCount(shuttle: Shuttle): number {
    const ambient = shuttle.ambientByDestination.reduce((sum, n) => sum + n, 0);
    return ambient + shuttle.onboardRideIds.size;
  }

  availableSeats(shuttle: Shuttle): number {
    if (shuttle.outOfService) return 0;
    return Math.max(0, shuttle.capacity - this.passengerCount(shuttle) - shuttle.heldSeats);
  }

  /** Hold a seat for a booked rider. Returns false when the shuttle is full. */
  holdSeat(shuttleId: string): boolean {
    const shuttle = this.requireShuttle(shuttleId);
    if (this.availableSeats(shuttle) <= 0) return false;
    shuttle.heldSeats += 1;
    return true;
  }

  releaseSeat(shuttleId: string): void {
    const shuttle = this.shuttleById(shuttleId);
    if (shuttle) shuttle.heldSeats = Math.max(0, shuttle.heldSeats - 1);
  }

  /** Convert a held seat into an occupied one when the rider boards. */
  boardRide(shuttleId: string, rideId: string): void {
    const shuttle = this.requireShuttle(shuttleId);
    shuttle.heldSeats = Math.max(0, shuttle.heldSeats - 1);
    shuttle.onboardRideIds.add(rideId);
    shuttle.boardingsToday += 1;
  }

  alightRide(shuttleId: string, rideId: string): void {
    const shuttle = this.shuttleById(shuttleId);
    shuttle?.onboardRideIds.delete(rideId);
  }

  // --- queries -----------------------------------------------------------

  shuttleById(id: string): Shuttle | undefined {
    return this.shuttles.find((s) => s.id === id);
  }

  private requireShuttle(id: string): Shuttle {
    const shuttle = this.shuttleById(id);
    if (!shuttle) throw new Error(`Unknown shuttle: ${id}`);
    return shuttle;
  }

  get fleetSize(): number {
    return this.shuttles.length;
  }

  /** Simulated seconds per wall-clock second. */
  get scale(): number {
    return this.timeScale;
  }

  /** The settings this simulation is actually running with. */
  get settings(): {
    timeScale: number;
    fleetSize: number;
    capacity: number;
    shuttleSpeedMph: number;
    stopDwellSeconds: number;
  } {
    return {
      timeScale: this.timeScale,
      fleetSize: this.shuttles.length,
      capacity: this.shuttles[0]?.capacity ?? config.shuttleCapacity,
      shuttleSpeedMph: this.cruiseSpeedMph,
      stopDwellSeconds: this.dwellSeconds,
    };
  }

  /** Half a dwell on the wall clock — the Arrived/Boarding split point. */
  halfDwellMs(): number {
    return this.wallClockMsFor(this.dwellSeconds) / 2;
  }

  /** Shuttles picking riders up right now — charging and depot-bound ones are not. */
  activeShuttleCount(): number {
    return this.shuttles.filter((s) => s.status !== 'charging' && !s.outOfService).length;
  }

  /** Mean time between shuttles at any given stop, in seconds. */
  headwaySeconds(): number {
    const active = Math.max(1, this.activeShuttleCount());
    const driveSeconds = (LOOP_MILES / config.shuttleSpeedMph) * 3600;
    const dwellTotal = this.dwellSeconds * STOP_COUNT;
    return (driveSeconds + dwellTotal) / active;
  }

  /** Average rider wait, which for a uniform arrival process is half the headway. */
  averageWaitMinutes(): number {
    return round(this.headwaySeconds() / 120, 1);
  }

  /** Seconds until `shuttle` reaches the stop at `targetIndex`. */
  estimateArrivalSeconds(shuttle: Shuttle, targetIndex: number, at: number = this.clock()): number {
    if (shuttle.atStopIndex === targetIndex && shuttle.status === 'dwelling') return 0;

    const miles = forwardMiles(shuttle.distanceMiles, stopDistance(targetIndex));
    let seconds = (miles / Math.max(1, shuttle.speedMph)) * 3600;

    // Add the dwell at every stop between here and there.
    let index = nextStopIndex(shuttle.distanceMiles);
    let intervening = 0;
    let guard = 0;
    while (index !== targetIndex && guard++ <= STOP_COUNT) {
      intervening += 1;
      index = (index + 1) % STOP_COUNT;
    }
    seconds += intervening * this.dwellSeconds;

    // Remaining dwell/charge is stored on the wall clock; the ETA is in
    // simulated seconds, which is what riders are shown.
    if (shuttle.status === 'dwelling' && shuttle.dwellEndsAt) {
      seconds += Math.max(0, this.simSecondsFor(shuttle.dwellEndsAt - at));
    }
    if (shuttle.status === 'charging' && shuttle.chargeEndsAt) {
      seconds += Math.max(0, this.simSecondsFor(shuttle.chargeEndsAt - at));
    }
    return Math.max(0, seconds);
  }

  /** Upcoming arrivals at a stop, soonest first. */
  arrivalsAtStop(stopId: string, limit = 3, at: number = this.clock()): StopArrival[] {
    const target = stopIndex(stopId);
    return this.shuttles
      .map((shuttle) => {
        const etaSeconds = this.estimateArrivalSeconds(shuttle, target, at);
        return {
          shuttleId: shuttle.id,
          shuttleLabel: shuttle.label,
          etaSeconds: Math.round(etaSeconds),
          etaMinutes: round(etaSeconds / 60, 1),
          passengers: this.passengerCount(shuttle),
          availableSeats: this.availableSeats(shuttle),
          status: shuttle.status,
        };
      })
      .sort((a, b) => a.etaSeconds - b.etaSeconds)
      .slice(0, limit);
  }

  /**
   * Pick the shuttle that gets a rider from `pickup` to `destination` soonest
   * while still having a seat free for the whole journey.
   */
  assignShuttle(
    pickupStopId: string,
    destinationStopId: string,
    at: number = this.clock(),
  ): { shuttle: Shuttle; pickupEtaSeconds: number; tripSeconds: number } | null {
    const pickup = stopIndex(pickupStopId);
    const destination = stopIndex(destinationStopId);

    const candidates = this.shuttles
      .filter((shuttle) => this.availableSeats(shuttle) > 0)
      .map((shuttle) => {
        const pickupEtaSeconds = this.estimateArrivalSeconds(shuttle, pickup, at);
        const dropoffEtaSeconds = this.estimateArrivalSeconds(shuttle, destination, at);
        // A shuttle that reaches the destination before the pickup is heading
        // there on its next lap; add a full loop so the ordering is honest.
        const tripSeconds =
          dropoffEtaSeconds >= pickupEtaSeconds
            ? dropoffEtaSeconds - pickupEtaSeconds
            : dropoffEtaSeconds + this.loopSeconds() - pickupEtaSeconds;
        return { shuttle, pickupEtaSeconds, tripSeconds };
      })
      .sort((a, b) => a.pickupEtaSeconds - b.pickupEtaSeconds);

    return candidates[0] ?? null;
  }

  /** Time for one full circuit including dwells, in seconds. */
  loopSeconds(): number {
    return (LOOP_MILES / config.shuttleSpeedMph) * 3600 + this.dwellSeconds * STOP_COUNT;
  }

  snapshot(shuttle: Shuttle, at: number = this.clock()): ShuttleSnapshot {
    const point = pointAtMiles(shuttle.distanceMiles);
    const next = nextStopIndex(shuttle.distanceMiles);
    const passengers = this.passengerCount(shuttle);
    return {
      id: shuttle.id,
      label: shuttle.label,
      routeId: shuttle.routeId,
      status: shuttle.status,
      distanceMiles: round(shuttle.distanceMiles, 3),
      loopProgress: round(shuttle.distanceMiles / LOOP_MILES, 4),
      position: { x: round(point.x, 1), y: round(point.y, 1), bearing: round(point.bearing, 3) },
      atStopId: shuttle.atStopIndex === null ? null : stopAt(shuttle.atStopIndex).id,
      nextStopId: stopAt(next).id,
      nextStopEtaSeconds: Math.round(this.estimateArrivalSeconds(shuttle, next, at)),
      passengers,
      capacity: shuttle.capacity,
      availableSeats: this.availableSeats(shuttle),
      occupancyPct: round((passengers / shuttle.capacity) * 100, 0),
      batteryPct: round(shuttle.batteryPct, 1),
      acceptingRiders: !shuttle.outOfService && shuttle.status !== 'charging',
      speedMph: shuttle.status === 'in_service' ? shuttle.speedMph : 0,
      odometerMiles: round(shuttle.odometerMiles, 2),
    };
  }

  snapshotAll(at: number = this.clock()): ShuttleSnapshot[] {
    return this.shuttles.map((shuttle) => this.snapshot(shuttle, at));
  }

  /** Total riders aboard the fleet right now. */
  totalPassengers(): number {
    return this.shuttles.reduce((sum, s) => sum + this.passengerCount(s), 0);
  }

  totalBoardingsToday(): number {
    return this.shuttles.reduce((sum, s) => sum + s.boardingsToday, 0);
  }
}
