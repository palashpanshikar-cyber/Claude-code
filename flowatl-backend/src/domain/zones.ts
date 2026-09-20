/**
 * Delivery zones.
 *
 * FlowHaul consolidates loads that are going to the same part of town, so it
 * needs to turn a free-text address into something comparable. Rather than
 * pull in a geocoder, addresses are matched against the neighbourhoods,
 * landmarks and corridors a downtown Atlanta courier actually serves.
 */

import { STREET_ROUTING_FACTOR, haversineMiles } from './network.js';

export interface Zone {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Lower-cased substrings that place an address in this zone. */
  keywords: readonly string[];
}

export const ZONES: readonly Zone[] = [
  {
    id: 'downtown',
    name: 'Downtown',
    lat: 33.755,
    lng: -84.39,
    keywords: ['downtown', 'marietta st', 'peachtree center', 'five points', 'auburn ave', 'edgewood ave', 'luckie st', 'centennial', 'mercedes-benz', 'state farm arena'],
  },
  {
    id: 'midtown',
    name: 'Midtown',
    lat: 33.7815,
    lng: -84.383,
    keywords: ['midtown', 'peachtree st ne', '10th st', '14th st', 'juniper', 'crescent ave', 'colony square', 'fox theatre', 'georgia tech', 'north ave'],
  },
  {
    id: 'westside',
    name: 'West Midtown',
    lat: 33.787,
    lng: -84.412,
    keywords: ['westside', 'west midtown', 'howell mill', 'marietta street artery', 'huff rd', 'chattahoochee ave', 'the works', 'star metals'],
  },
  {
    id: 'old-fourth-ward',
    name: 'Old Fourth Ward',
    lat: 33.764,
    lng: -84.367,
    keywords: ['old fourth ward', 'o4w', 'ponce city market', 'ponce de leon', 'beltline', 'krog', 'inman park', 'irwin st'],
  },
  {
    id: 'castleberry',
    name: 'Castleberry Hill',
    lat: 33.7448,
    lng: -84.399,
    keywords: ['castleberry', 'peters st', 'walker st', 'nelson st', 'mcdaniel st'],
  },
  {
    id: 'west-end',
    name: 'West End',
    lat: 33.736,
    lng: -84.418,
    keywords: ['west end', 'ralph david abernathy', 'lee st', 'cascade'],
  },
  {
    id: 'grant-park',
    name: 'Grant Park',
    lat: 33.737,
    lng: -84.369,
    keywords: ['grant park', 'memorial dr', 'cherokee ave', 'boulevard se', 'zoo atlanta'],
  },
  {
    id: 'buckhead',
    name: 'Buckhead',
    lat: 33.848,
    lng: -84.378,
    keywords: ['buckhead', 'lenox', 'phipps', 'piedmont rd', 'roswell rd', 'peachtree rd ne'],
  },
  {
    id: 'east-atlanta',
    name: 'East Atlanta',
    lat: 33.74,
    lng: -84.34,
    keywords: ['east atlanta', 'eav', 'flat shoals', 'glenwood', 'moreland ave'],
  },
  {
    id: 'decatur',
    name: 'Decatur',
    lat: 33.7748,
    lng: -84.2963,
    keywords: ['decatur', 'avondale', 'north decatur', 'clairmont', 'emory'],
  },
  {
    id: 'airport',
    name: 'Airport / South',
    lat: 33.6407,
    lng: -84.4277,
    keywords: ['airport', 'hartsfield', 'college park', 'east point', 'camp creek', 'atl '],
  },
  {
    id: 'perimeter',
    name: 'Perimeter / North',
    lat: 33.924,
    lng: -84.341,
    keywords: ['perimeter', 'dunwoody', 'sandy springs', 'chamblee', 'brookhaven', 'ashford'],
  },
] as const;

const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

export function zoneById(id: string): Zone | undefined {
  return ZONE_BY_ID.get(id);
}

/** Default when an address matches nothing — most FlowHaul runs start downtown. */
export const DEFAULT_ZONE_ID = 'downtown';

/**
 * Place a free-text address in a zone. Longer keyword matches win, so
 * "Peachtree Rd NE, Buckhead" resolves to Buckhead rather than Midtown.
 */
export function resolveZone(address: string): Zone {
  const text = address.toLowerCase();
  let best: { zone: Zone; score: number } | null = null;
  for (const zone of ZONES) {
    for (const keyword of zone.keywords) {
      if (text.includes(keyword) && (best === null || keyword.length > best.score)) {
        best = { zone, score: keyword.length };
      }
    }
  }
  return best?.zone ?? ZONE_BY_ID.get(DEFAULT_ZONE_ID)!;
}

/** Driving miles between two zone centroids, never less than a minimum city hop. */
export function zoneMiles(fromId: string, toId: string): number {
  const from = zoneById(fromId);
  const to = zoneById(toId);
  if (!from || !to) return 3;
  if (fromId === toId) return 1.4; // Intra-zone runs still cross a few blocks.
  return Math.max(1.4, haversineMiles(from, to) * STREET_ROUTING_FACTOR);
}

export interface DeliveryWindow {
  id: string;
  label: string;
  /** Local start/end hours, 24h. */
  startHour: number;
  endHour: number;
}

export const DELIVERY_WINDOWS: readonly DeliveryWindow[] = [
  { id: 'morning', label: 'Morning 8–12', startHour: 8, endHour: 12 },
  { id: 'afternoon', label: 'Afternoon 12–5', startHour: 12, endHour: 17 },
  { id: 'evening', label: 'Evening 5–9', startHour: 17, endHour: 21 },
] as const;

const WINDOW_BY_ID = new Map(DELIVERY_WINDOWS.map((w) => [w.id, w]));

export function windowById(id: string): DeliveryWindow | undefined {
  return WINDOW_BY_ID.get(id);
}

/** Hours of overlap between two delivery windows; 0 means they cannot share a van. */
export function windowOverlapHours(aId: string, bId: string): number {
  const a = windowById(aId);
  const b = windowById(bId);
  if (!a || !b) return 0;
  return Math.max(0, Math.min(a.endHour, b.endHour) - Math.max(a.startHour, b.startHour));
}
