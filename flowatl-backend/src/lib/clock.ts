import { config } from '../config.js';

/** Milliseconds since epoch. Indirected so tests can freeze time. */
export function now(): number {
  return Date.now();
}

/** ISO string for a timestamp, defaulting to now. */
export function iso(ms: number = now()): string {
  return new Date(ms).toISOString();
}

/**
 * The network's service date (YYYY-MM-DD) in Atlanta time. Daily impact
 * counters roll over at local midnight, not UTC midnight.
 */
export function serviceDate(ms: number = now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Local hour (0-23) in Atlanta time — drives the demand curve. */
export function serviceHour(ms: number = now()): number {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: '2-digit',
    hour12: false,
  }).format(new Date(ms));
  return Number(hour) % 24;
}

/** Fractional hours elapsed since local midnight. */
export function hoursIntoServiceDay(ms: number = now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour + minute / 60;
}
