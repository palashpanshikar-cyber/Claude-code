/**
 * Ambient ridership model.
 *
 * Booked rides are only part of what is on a shuttle — the network also
 * carries walk-up riders. Modelling them means passenger counts, wait times
 * and the impact dashboard move for real reasons (time of day, stop
 * popularity, headway) instead of drifting randomly.
 */

import { STOPS, STOP_COUNT, stopAt } from './network.js';

/**
 * Relative demand by local hour for downtown Atlanta: a commuter peak either
 * side of the workday, a lunch bump, and a long tail for evening events at
 * the stadium and the arena.
 */
export const HOURLY_DEMAND_CURVE: readonly number[] = [
  0.12, 0.07, 0.05, 0.05, 0.08, 0.2, 0.48, 0.92, 1.35, 1.1, 0.86, 0.95,
  1.18, 1.05, 0.94, 1.02, 1.32, 1.58, 1.3, 1.02, 0.78, 0.55, 0.36, 0.2,
];

/**
 * Riders arriving network-wide per hour at the midday baseline. Sized against
 * what the pilot fleet can actually absorb: six shuttles complete roughly four
 * circuits an hour, so this leaves headroom at the peaks instead of stranding
 * riders every lap.
 */
export const BASELINE_RIDERS_PER_HOUR = 180;

export function demandMultiplier(hour: number): number {
  const index = ((Math.floor(hour) % 24) + 24) % 24;
  return HOURLY_DEMAND_CURVE[index]!;
}

const TOTAL_DEMAND_WEIGHT = STOPS.reduce((sum, s) => sum + s.demandWeight, 0);

/**
 * Expected walk-up boardings at `stopIndex` over `seconds`, given the local
 * hour. Demand accumulates while riders wait, so a longer headway means a
 * fuller shuttle rather than a busier one.
 */
export function expectedBoardings(stopIndex: number, hour: number, seconds: number): number {
  const stop = stopAt(stopIndex);
  const share = stop.demandWeight / TOTAL_DEMAND_WEIGHT;
  const perHour = BASELINE_RIDERS_PER_HOUR * demandMultiplier(hour) * share;
  return (perHour * seconds) / 3600;
}

/**
 * Where a rider boarding at `fromIndex` is headed. Weighted by destination
 * popularity; nobody rides the full loop back to where they started.
 */
export function drawDestination(fromIndex: number, random: number): number {
  const candidates: { index: number; weight: number }[] = [];
  let total = 0;
  for (let hop = 1; hop < STOP_COUNT; hop++) {
    const index = (fromIndex + hop) % STOP_COUNT;
    // Short hops dominate: weight decays with the number of stops travelled.
    const weight = stopAt(index).demandWeight * Math.pow(0.72, hop - 1);
    total += weight;
    candidates.push({ index, weight });
  }
  let threshold = random * total;
  for (const candidate of candidates) {
    threshold -= candidate.weight;
    if (threshold <= 0) return candidate.index;
  }
  return candidates[candidates.length - 1]!.index;
}
