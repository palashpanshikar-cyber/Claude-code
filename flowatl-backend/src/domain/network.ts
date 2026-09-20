/**
 * The FlowATL downtown loop: the authoritative description of stops, ordering
 * and geometry. The `x`/`y` values match the SVG viewBox the mobile client
 * draws its map in, so the backend and the map stay in lockstep; `lat`/`lng`
 * drive the real distance, fare and emissions math.
 */

export interface Stop {
  /** Stable id used by the API and the client (e.g. "five-points"). */
  id: string;
  name: string;
  /** Neighbourhood label shown under the stop name. */
  area: string;
  lat: number;
  lng: number;
  /** Map coordinates in the client's 340x560 SVG viewBox. */
  x: number;
  y: number;
  /** Stops with a depot can charge shuttles. */
  depot: boolean;
  /** Relative boarding demand at this stop (1 = network average). */
  demandWeight: number;
}

/** Loop order: Five Points -> Centennial -> Aquarium -> Benz -> State Farm -> Castleberry -> Five Points. */
export const STOPS: readonly Stop[] = [
  {
    id: 'five-points',
    name: 'Five Points',
    area: 'Downtown core · MARTA transfer',
    lat: 33.754,
    lng: -84.3917,
    x: 180,
    y: 482,
    depot: true,
    demandWeight: 1.6,
  },
  {
    id: 'centennial',
    name: 'Centennial Park',
    area: 'Centennial Olympic Park District',
    lat: 33.7605,
    lng: -84.3933,
    x: 168,
    y: 96,
    depot: false,
    demandWeight: 1.3,
  },
  {
    id: 'aquarium',
    name: 'Georgia Aquarium',
    area: 'Pemberton Place',
    lat: 33.7634,
    lng: -84.3951,
    x: 292,
    y: 142,
    depot: false,
    demandWeight: 1.15,
  },
  {
    id: 'benz',
    name: 'Mercedes-Benz Stadium',
    area: 'Vine City edge',
    lat: 33.7554,
    lng: -84.4009,
    x: 52,
    y: 222,
    depot: false,
    demandWeight: 0.9,
  },
  {
    id: 'state-farm',
    name: 'State Farm Arena',
    area: 'Philips Arena block',
    lat: 33.7573,
    lng: -84.3963,
    x: 150,
    y: 300,
    depot: false,
    demandWeight: 0.95,
  },
  {
    id: 'castleberry',
    name: 'Castleberry Hill',
    area: 'Arts district',
    lat: 33.7448,
    lng: -84.399,
    x: 72,
    y: 412,
    depot: false,
    demandWeight: 0.75,
  },
] as const;

export const STOP_COUNT = STOPS.length;

const STOP_INDEX_BY_ID = new Map(STOPS.map((s, i) => [s.id, i]));

export function stopIndex(id: string): number {
  const index = STOP_INDEX_BY_ID.get(id);
  if (index === undefined) throw new Error(`Unknown stop id: ${id}`);
  return index;
}

export function isStopId(id: unknown): id is string {
  return typeof id === 'string' && STOP_INDEX_BY_ID.has(id);
}

export function stopById(id: string): Stop {
  return STOPS[stopIndex(id)]!;
}

export function stopAt(index: number): Stop {
  return STOPS[((index % STOP_COUNT) + STOP_COUNT) % STOP_COUNT]!;
}

const EARTH_RADIUS_MILES = 3958.7613;

/** Great-circle distance in miles. */
export function haversineMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Downtown Atlanta is a grid of one-ways; a shuttle drives noticeably further
 * than the straight line between two stops.
 */
export const STREET_ROUTING_FACTOR = 1.32;

/** Driving miles for each leg i -> i+1 (wrapping at the end of the loop). */
export const SEGMENT_MILES: readonly number[] = STOPS.map(
  (stop, i) => haversineMiles(stop, stopAt(i + 1)) * STREET_ROUTING_FACTOR,
);

/** Total loop length in driving miles. */
export const LOOP_MILES = SEGMENT_MILES.reduce((sum, m) => sum + m, 0);

/** Cumulative distance from the first stop to stop i; last entry is LOOP_MILES. */
export const CUMULATIVE_MILES: readonly number[] = (() => {
  const out = [0];
  for (let i = 0; i < SEGMENT_MILES.length; i++) {
    out.push(out[i]! + SEGMENT_MILES[i]!);
  }
  return out;
})();

/** Distance from the loop origin to a stop, in miles. */
export function stopDistance(index: number): number {
  return CUMULATIVE_MILES[((index % STOP_COUNT) + STOP_COUNT) % STOP_COUNT]!;
}

/** Normalise a distance into [0, LOOP_MILES). */
export function wrapDistance(miles: number): number {
  return ((miles % LOOP_MILES) + LOOP_MILES) % LOOP_MILES;
}

/** Forward-only distance from `from` to `to` along the one-way loop. */
export function forwardMiles(from: number, to: number): number {
  return wrapDistance(to - from);
}

/** Number of stops traversed riding from `pickup` to `destination`. */
export function stopsBetween(pickupId: string, destinationId: string): number {
  const i = stopIndex(pickupId);
  const j = stopIndex(destinationId);
  return (j - i + STOP_COUNT) % STOP_COUNT;
}

/** Driving miles for a trip from `pickup` to `destination` around the loop. */
export function tripMiles(pickupId: string, destinationId: string): number {
  return forwardMiles(stopDistance(stopIndex(pickupId)), stopDistance(stopIndex(destinationId)));
}

export interface LoopPoint {
  x: number;
  y: number;
  /** Heading in radians, for rotating the shuttle icon on the map. */
  bearing: number;
  /** Index of the segment the point sits on. */
  segment: number;
  /** Progress along that segment, 0-1. */
  segmentProgress: number;
}

/** Map a distance along the loop to the client's SVG coordinate space. */
export function pointAtMiles(miles: number): LoopPoint {
  const d = wrapDistance(miles);
  for (let i = 0; i < SEGMENT_MILES.length; i++) {
    const start = CUMULATIVE_MILES[i]!;
    const end = CUMULATIVE_MILES[i + 1]!;
    if (d <= end || i === SEGMENT_MILES.length - 1) {
      const span = end - start;
      const t = span === 0 ? 0 : Math.min(1, (d - start) / span);
      const a = stopAt(i);
      const b = stopAt(i + 1);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        bearing: Math.atan2(b.y - a.y, b.x - a.x),
        segment: i,
        segmentProgress: t,
      };
    }
  }
  const first = STOPS[0]!;
  return { x: first.x, y: first.y, bearing: 0, segment: 0, segmentProgress: 0 };
}

/** Index of the next stop a shuttle at `miles` will reach. */
export function nextStopIndex(miles: number): number {
  const d = wrapDistance(miles);
  for (let i = 0; i < STOP_COUNT; i++) {
    // Strictly greater: a shuttle sitting exactly on a stop is heading for the next one.
    if (CUMULATIVE_MILES[i]! > d + 1e-9) return i;
  }
  return 0;
}

/** SVG path data for the loop, so the client can render it from server data. */
export const LOOP_PATH_D =
  STOPS.map((s, i) => `${i === 0 ? 'M' : 'L'}${s.x},${s.y}`).join(' ') + ' Z';

export interface RouteSummary {
  id: string;
  name: string;
  loopMiles: number;
  stopCount: number;
  pathD: string;
  stops: readonly Stop[];
  segments: { from: string; to: string; miles: number }[];
}

export function routeSummary(): RouteSummary {
  return {
    id: 'downtown-loop',
    name: 'Downtown Loop',
    loopMiles: round(LOOP_MILES, 2),
    stopCount: STOP_COUNT,
    pathD: LOOP_PATH_D,
    stops: STOPS,
    segments: STOPS.map((stop, i) => ({
      from: stop.id,
      to: stopAt(i + 1).id,
      miles: round(SEGMENT_MILES[i]!, 2),
    })),
  };
}

export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
