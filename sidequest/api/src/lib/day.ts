// Everything streak-related is measured in the user's local calendar day, not UTC.
// A user in Auckland finishing a quest at 11pm must not have it land on "yesterday".

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timezone, fmt);
  }
  return fmt;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar day as YYYY-MM-DD for the given instant in the given zone. */
export function localDay(timezone: string, at: Date = new Date()): string {
  // en-CA already renders as YYYY-MM-DD.
  return formatterFor(timezone).format(at);
}

/** Calendar day N days before/after the given YYYY-MM-DD string. */
export function shiftDay(day: string, deltaDays: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD strings (later - earlier). */
export function daysBetween(earlier: string, later: string): number {
  const [y1, m1, d1] = earlier.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = later.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Day index since epoch — the rotation cursor for daily minis. */
export function dayIndex(day: string): number {
  return daysBetween('1970-01-01', day);
}
