/**
 * Fares, comparison pricing and emissions accounting.
 *
 * Every published figure in the app (fare, "CO2 saved vs. a solo Uber",
 * "money saved") is derived here from a single set of documented constants
 * rather than being invented at the UI layer, so the numbers stay consistent
 * across the booking card, the live ride and the impact dashboard.
 */

import { round, stopsBetween, tripMiles } from './network.js';

// --- Fare rules ----------------------------------------------------------

/** Charged per stop traversed. */
export const FARE_PER_STOP_USD = 0.35;
/** No ride is cheaper than this, however short. */
export const MIN_FARE_USD = 1.5;
/** FlowPass: unlimited rides on the network. */
export const SUBSCRIPTION_PRICE_USD = 119;

// --- Comparison basis ----------------------------------------------------

/**
 * Ride-hail comparison. Roughly matches UberX pricing in Atlanta: a booking
 * fee, a per-mile rate and a per-minute rate, with a trip minimum.
 */
export const RIDEHAIL = {
  bookingFeeUsd: 2.6,
  perMileUsd: 1.75,
  perMinuteUsd: 0.36,
  minimumUsd: 8.25,
  /** Downtown ride-hail averages well under the speed limit. */
  averageSpeedMph: 13,
} as const;

// --- Emissions constants -------------------------------------------------

/**
 * EPA tailpipe average for a US passenger vehicle: ~400 g CO2e per mile,
 * i.e. 0.882 lb/mi.
 */
export const GASOLINE_LB_CO2_PER_MILE = 0.882;

/**
 * Ride-hail trips carry a deadhead penalty: the driver circulates empty
 * between fares. ~40% of ride-hail vehicle miles are passengerless.
 */
export const RIDEHAIL_DEADHEAD_FACTOR = 1.4;

/** Energy draw of a 12-seat autonomous electric shuttle in stop-and-go duty. */
export const SHUTTLE_KWH_PER_MILE = 1.05;

/**
 * Marginal emissions of the Georgia grid, ~0.72 lb CO2e per kWh, including
 * ~5% transmission and charging losses.
 */
export const GRID_LB_CO2_PER_KWH = 0.72;

/**
 * Share of shuttle riders who would otherwise have taken a car. The rest
 * would have walked, biked or taken MARTA, so their trip displaces nothing.
 */
export const CAR_DISPLACEMENT_RATE = 0.62;

export interface FareQuote {
  pickupStopId: string;
  destinationStopId: string;
  stopsTraversed: number;
  miles: number;
  /** What the rider is charged for this trip. */
  fareUsd: number;
  /** The fare before a subscription discount is applied. */
  listFareUsd: number;
  /** True when a FlowPass covered the ride. */
  coveredBySubscription: boolean;
  /** Modelled cost of the same trip by ride-hail. */
  ridehailUsd: number;
  savingsUsd: number;
  co2SavedLbs: number;
  estimatedMinutes: number;
}

/** The list fare for a trip, before any subscription discount. */
export function listFare(pickupStopId: string, destinationStopId: string): number {
  const stops = stopsBetween(pickupStopId, destinationStopId);
  if (stops === 0) return 0;
  return round(Math.max(MIN_FARE_USD, stops * FARE_PER_STOP_USD), 2);
}

/** Modelled cost of the same trip in a solo ride-hail car. */
export function ridehailPrice(miles: number): number {
  const minutes = (miles / RIDEHAIL.averageSpeedMph) * 60;
  const metered =
    RIDEHAIL.bookingFeeUsd + miles * RIDEHAIL.perMileUsd + minutes * RIDEHAIL.perMinuteUsd;
  return round(Math.max(RIDEHAIL.minimumUsd, metered), 2);
}

/**
 * CO2 avoided by riding the shuttle instead of driving solo, in pounds.
 *
 * The shuttle's own emissions are split across everyone aboard, so a fuller
 * shuttle saves more per rider. Only the share of riders who would otherwise
 * have driven (CAR_DISPLACEMENT_RATE) is counted.
 */
export function co2SavedLbs(miles: number, occupancy: number): number {
  const passengers = Math.max(1, occupancy);
  const soloLbs = miles * GASOLINE_LB_CO2_PER_MILE * RIDEHAIL_DEADHEAD_FACTOR;
  const shuttleLbsPerRider =
    (miles * SHUTTLE_KWH_PER_MILE * GRID_LB_CO2_PER_KWH) / passengers;
  return round(Math.max(0, (soloLbs - shuttleLbsPerRider) * CAR_DISPLACEMENT_RATE), 2);
}

/** Energy used by a shuttle over a distance, in kWh. */
export function energyKwh(miles: number): number {
  return round(miles * SHUTTLE_KWH_PER_MILE, 3);
}

export interface QuoteOptions {
  /** Passengers expected aboard for the trip — sharpens the CO2 estimate. */
  occupancy?: number;
  /** A FlowPass holder rides at no marginal cost. */
  hasSubscription?: boolean;
  /** Door-to-door minutes, when the simulator can supply a real estimate. */
  estimatedMinutes?: number;
}

export function quoteRide(
  pickupStopId: string,
  destinationStopId: string,
  options: QuoteOptions = {},
): FareQuote {
  const stops = stopsBetween(pickupStopId, destinationStopId);
  const miles = tripMiles(pickupStopId, destinationStopId);
  const list = listFare(pickupStopId, destinationStopId);
  const covered = options.hasSubscription === true;
  const fare = covered ? 0 : list;
  const ridehail = ridehailPrice(miles);
  const occupancy = options.occupancy ?? 6;
  const estimatedMinutes =
    options.estimatedMinutes ?? Math.round((miles / RIDEHAIL.averageSpeedMph) * 60 + stops * 0.5);

  return {
    pickupStopId,
    destinationStopId,
    stopsTraversed: stops,
    miles: round(miles, 2),
    fareUsd: fare,
    listFareUsd: list,
    coveredBySubscription: covered,
    ridehailUsd: ridehail,
    savingsUsd: round(Math.max(0, ridehail - fare), 2),
    co2SavedLbs: co2SavedLbs(miles, occupancy),
    estimatedMinutes,
  };
}
