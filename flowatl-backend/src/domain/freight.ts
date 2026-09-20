/**
 * FlowHaul — consolidated business freight.
 *
 * A business posts a load; FlowHaul finds other loads heading for the same
 * part of town in an overlapping delivery window, packs them onto one electric
 * van and splits the run cost between the shippers. The matches a business
 * sees are real rows in the open-load pool, not fixtures, and the price is
 * that van run's cost allocated across whoever is actually on it.
 */

import { config } from '../config.js';
import { iso, now, serviceDate } from '../lib/clock.js';
import { ApiError } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { Rng } from '../lib/rng.js';
import { TypedEmitter } from '../lib/events.js';
import { round } from './network.js';
import { GRID_LB_CO2_PER_KWH } from './pricing.js';
import type { ImpactService } from './impact.js';
import {
  DELIVERY_WINDOWS,
  resolveZone,
  windowById,
  windowOverlapHours,
  zoneById,
  zoneMiles,
} from './zones.js';
import { toCents, usd, type Db } from '../store/db.js';

export const CARGO_TYPES = [
  'Restaurant Supplies',
  'Retail Inventory',
  'Event Equipment',
  'Film Production Equipment',
  'Other',
] as const;
export type CargoType = (typeof CARGO_TYPES)[number];

/** Payload of a FlowHaul electric cargo van. */
export const VAN_CAPACITY_LBS = 2000;
/** A van run is not worth consolidating beyond this many shippers. */
export const MAX_SHIPPERS_PER_VAN = 5;

// --- Pricing -------------------------------------------------------------

/** Dedicated courier: one van, one customer. The status quo FlowHaul undercuts. */
const DEDICATED_BASE_USD = 48;
const DEDICATED_PER_MILE_USD = 8.5;
const DEDICATED_PER_HUNDRED_LBS_USD = 18;
const DEDICATED_MINIMUM_USD = 85;

/** What it costs FlowHaul to run one consolidated van. */
const VAN_DISPATCH_USD = 58;
const VAN_PER_MILE_USD = 4.1;
const VAN_PER_STOP_USD = 6.5;

/** How the van run is split: partly by weight, partly evenly across shippers. */
const WEIGHT_ALLOCATION_SHARE = 0.55;
const FLOWHAUL_MARGIN = 0.45;
const MIN_FREIGHT_PRICE_USD = 22;

// --- Emissions -----------------------------------------------------------

/** A gas/diesel courier van: roughly 600 g CO2e per mile. */
const COURIER_VAN_LB_CO2_PER_MILE = 1.32;
/** FlowHaul's electric cargo van draws more than a shuttle. */
const EV_VAN_KWH_PER_MILE = 1.4;
const EV_VAN_LB_CO2_PER_MILE = EV_VAN_KWH_PER_MILE * GRID_LB_CO2_PER_KWH;

export function dedicatedPrice(miles: number, weightLbs: number): number {
  const metered =
    DEDICATED_BASE_USD +
    miles * DEDICATED_PER_MILE_USD +
    (weightLbs / 100) * DEDICATED_PER_HUNDRED_LBS_USD;
  return round(Math.max(DEDICATED_MINIMUM_USD, metered), 2);
}

export function vanRunCost(miles: number, shipperCount: number): number {
  return VAN_DISPATCH_USD + miles * VAN_PER_MILE_USD + shipperCount * VAN_PER_STOP_USD;
}

/**
 * A shipper's share of the van run: part proportional to weight (they take up
 * the space) and part split evenly (everyone benefits from the same trip).
 */
export function allocationShare(
  weightLbs: number,
  totalWeightLbs: number,
  shipperCount: number,
): number {
  if (shipperCount <= 0 || totalWeightLbs <= 0) return 1;
  const byWeight = weightLbs / totalWeightLbs;
  const evenly = 1 / shipperCount;
  return WEIGHT_ALLOCATION_SHARE * byWeight + (1 - WEIGHT_ALLOCATION_SHARE) * evenly;
}

export function consolidatedPrice(
  miles: number,
  weightLbs: number,
  totalWeightLbs: number,
  shipperCount: number,
): number {
  const share = allocationShare(weightLbs, totalWeightLbs, shipperCount);
  const price = vanRunCost(miles, shipperCount) * share * (1 + FLOWHAUL_MARGIN);
  return round(Math.max(MIN_FREIGHT_PRICE_USD, price), 2);
}

/**
 * CO2 avoided by this shipper. Consolidation removes the separate courier
 * runs the other shippers would have made, and the van that does make the trip
 * is electric. The total saving is attributed by cost share.
 */
export function freightCo2SavedLbs(
  miles: number,
  shipperCount: number,
  share: number,
): number {
  const avoidedTrips = Math.max(0, shipperCount - 1) * miles * COURIER_VAN_LB_CO2_PER_MILE;
  const cleanerVan = miles * (COURIER_VAN_LB_CO2_PER_MILE - EV_VAN_LB_CO2_PER_MILE);
  return round(Math.max(0, (avoidedTrips + cleanerVan) * share), 2);
}

// --- Persistence shapes --------------------------------------------------

export type LoadStatus = 'open' | 'matched' | 'in_transit' | 'delivered' | 'cancelled';

interface LoadRow {
  id: string;
  user_id: string | null;
  shipment_id: string | null;
  business_name: string;
  pickup_address: string;
  delivery_address: string;
  pickup_zone: string;
  delivery_zone: string;
  cargo_type: string;
  weight_lbs: number;
  window_id: string;
  status: LoadStatus;
  price_cents: number | null;
  dedicated_cents: number | null;
  co2_saved_lbs: number | null;
  notes: string | null;
  service_date: string;
  created_at: number;
  confirmed_at: number | null;
  cancelled_at: number | null;
}

interface ShipmentRow {
  id: string;
  van_label: string;
  delivery_zone: string;
  window_id: string;
  status: string;
  miles: number;
  co2_saved_lbs: number;
  service_date: string;
  created_at: number;
  dispatched_at: number | null;
  delivered_at: number | null;
}

export interface MatchedLoad {
  id: string;
  businessName: string;
  cargoType: string;
  weightLbs: number;
  deliveryZone: string;
  deliveryZoneName: string;
  windowId: string;
  windowLabel: string;
  /** This load's share of the consolidated van, as a percentage. */
  sharePct: number;
}

export interface FreightQuote {
  quoteId: string;
  pickupZone: { id: string; name: string };
  deliveryZone: { id: string; name: string };
  windowId: string;
  windowLabel: string;
  cargoType: string;
  weightLbs: number;
  miles: number;
  matchedLoads: MatchedLoad[];
  shipperCount: number;
  totalWeightLbs: number;
  vanCapacityLbs: number;
  capacityUsedPct: number;
  priceUsd: number;
  dedicatedUsd: number;
  savingsUsd: number;
  savingsPct: number;
  co2SavedLbs: number;
  yourSharePct: number;
  /** False when nothing else is heading that way — the run goes out dedicated. */
  consolidated: boolean;
}

export const FREIGHT_PHASES = [
  'Dispatched',
  'Picked Up',
  'Consolidated',
  'In Transit',
  'Out for Delivery',
  'Delivered',
] as const;
export type FreightPhase = (typeof FREIGHT_PHASES)[number];

export interface ShipmentView {
  id: string;
  vanLabel: string;
  status: string;
  phase: FreightPhase;
  phaseIndex: number;
  phases: readonly FreightPhase[];
  deliveryZone: { id: string; name: string };
  windowId: string;
  windowLabel: string;
  miles: number;
  co2SavedLbs: number;
  etaSeconds: number;
  etaMinutes: number;
  progressPct: number;
  loads: {
    id: string;
    businessName: string;
    cargoType: string;
    weightLbs: number;
    priceUsd: number | null;
    isYours: boolean;
  }[];
  totalWeightLbs: number;
  createdAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
}

export interface FreightEvents {
  'shipment:updated': { shipmentId: string };
}

/** Seed businesses that keep the open-load pool populated for a demo. */
const SEED_BUSINESSES: readonly {
  name: string;
  pickup: string;
  delivery: string;
  cargo: CargoType;
  weight: number;
  window: string;
}[] = [
  { name: 'Ponce City Bakery', pickup: '675 Ponce De Leon Ave NE', delivery: '1075 Peachtree St NE, Midtown', cargo: 'Restaurant Supplies', weight: 120, window: 'morning' },
  { name: 'Westside Retail Co.', pickup: '1100 Howell Mill Rd NW', delivery: '999 Peachtree St NE, Midtown', cargo: 'Retail Inventory', weight: 85, window: 'morning' },
  { name: 'Atlanta Event Rentals', pickup: '260 Peters St SW, Castleberry', delivery: '1180 Peachtree St NE, Midtown', cargo: 'Event Equipment', weight: 210, window: 'afternoon' },
  { name: 'Auburn Ave Outfitters', pickup: '175 Auburn Ave NE, Downtown', delivery: '1100 Peachtree St NE, Midtown', cargo: 'Retail Inventory', weight: 145, window: 'morning' },
  { name: 'Peachtree Provisions', pickup: '191 Peachtree St NE, Downtown', delivery: '14th St NW, Midtown', cargo: 'Restaurant Supplies', weight: 340, window: 'afternoon' },
  { name: 'Marietta St Studios', pickup: '887 Marietta St NW, Westside', delivery: '75 Hurt Plaza SE, Downtown', cargo: 'Film Production Equipment', weight: 480, window: 'evening' },
  { name: 'Grant Park Grocers', pickup: '600 Memorial Dr SE, Grant Park', delivery: '210 Peters St SW, Castleberry', cargo: 'Restaurant Supplies', weight: 160, window: 'morning' },
  { name: 'Krog Street Outfitters', pickup: '99 Krog St NE, Old Fourth Ward', delivery: '3393 Peachtree Rd NE, Buckhead', cargo: 'Retail Inventory', weight: 240, window: 'afternoon' },
  { name: 'Castleberry Coffee Roasters', pickup: '320 Walker St SW, Castleberry', delivery: '675 Ponce De Leon Ave NE', cargo: 'Restaurant Supplies', weight: 95, window: 'morning' },
  { name: 'Centennial AV Supply', pickup: '265 Park Ave W NW, Downtown', delivery: '1055 Howell Mill Rd NW, Westside', cargo: 'Event Equipment', weight: 300, window: 'evening' },
  { name: 'Southside Set Logistics', pickup: '1000 Camp Creek Pkwy, College Park', delivery: '887 Marietta St NW, Westside', cargo: 'Film Production Equipment', weight: 620, window: 'afternoon' },
];

export class FreightService {
  readonly events = new TypedEmitter<FreightEvents>();
  private readonly rng: Rng;

  constructor(
    private readonly db: Db,
    private readonly impact: ImpactService,
  ) {
    this.rng = new Rng(config.simSeed ^ 0x5eed);
  }

  /** Keep the open-load pool stocked for the current service day. */
  seedOpenLoads(at: number = now()): number {
    const date = serviceDate(at);
    const existing = this.db
      .prepare(`SELECT COUNT(*) AS n FROM freight_loads WHERE status = 'open' AND service_date = ?`)
      .get(date) as { n: number };
    if (existing.n >= SEED_BUSINESSES.length) return 0;

    const insert = this.db.prepare(
      `INSERT INTO freight_loads
         (id, user_id, shipment_id, business_name, pickup_address, delivery_address,
          pickup_zone, delivery_zone, cargo_type, weight_lbs, window_id, status,
          price_cents, dedicated_cents, co2_saved_lbs, notes, service_date, created_at,
          confirmed_at, cancelled_at)
       VALUES (@id, NULL, NULL, @business_name, @pickup_address, @delivery_address,
               @pickup_zone, @delivery_zone, @cargo_type, @weight_lbs, @window_id, 'open',
               NULL, NULL, NULL, NULL, @service_date, @created_at, NULL, NULL)`,
    );
    const seedAll = this.db.transaction((rows: unknown[]) => {
      for (const row of rows) insert.run(row);
    });

    const rows = SEED_BUSINESSES.map((seed) => ({
      id: newId('load'),
      business_name: seed.name,
      pickup_address: seed.pickup,
      delivery_address: seed.delivery,
      pickup_zone: resolveZone(seed.pickup).id,
      delivery_zone: resolveZone(seed.delivery).id,
      cargo_type: seed.cargo,
      // Vary weights a little day to day so the pool is not identical each run.
      weight_lbs: round(seed.weight * this.rng.float(0.85, 1.15), 0),
      window_id: seed.window,
      service_date: date,
      created_at: at - this.rng.int(5, 240) * 60 * 1000,
    }));
    seedAll(rows);
    return rows.length;
  }

  // --- matching and quoting ---------------------------------------------

  /**
   * Find loads that can share a van with this one: same destination zone,
   * an overlapping delivery window, and enough payload left over.
   */
  findMatches(input: {
    deliveryZoneId: string;
    windowId: string;
    weightLbs: number;
    excludeLoadId?: string;
  }): LoadRow[] {
    const candidates = this.db
      .prepare(
        `SELECT * FROM freight_loads
          WHERE status = 'open' AND delivery_zone = ? AND id IS NOT ?
          ORDER BY created_at ASC`,
      )
      .all(input.deliveryZoneId, input.excludeLoadId ?? null) as LoadRow[];

    const scored = candidates
      .map((load) => ({ load, overlap: windowOverlapHours(load.window_id, input.windowId) }))
      .filter((c) => c.overlap > 0)
      // Exact window match first, then the heaviest loads, which fill the van
      // most efficiently per stop.
      .sort((a, b) => b.overlap - a.overlap || b.load.weight_lbs - a.load.weight_lbs);

    const picked: LoadRow[] = [];
    let weight = input.weightLbs;
    for (const { load } of scored) {
      if (picked.length >= MAX_SHIPPERS_PER_VAN - 1) break;
      if (weight + load.weight_lbs > VAN_CAPACITY_LBS) continue;
      weight += load.weight_lbs;
      picked.push(load);
    }
    return picked;
  }

  quote(input: {
    pickupAddress: string;
    deliveryAddress: string;
    cargoType: string;
    weightLbs: number;
    windowId: string;
  }): FreightQuote {
    if (input.weightLbs <= 0 || input.weightLbs > VAN_CAPACITY_LBS) {
      throw ApiError.badRequest(
        `Cargo weight must be between 1 and ${VAN_CAPACITY_LBS} lbs for a FlowHaul van`,
      );
    }
    const deliveryWindow = windowById(input.windowId);
    if (!deliveryWindow) {
      throw ApiError.badRequest(
        `Unknown delivery window. Expected one of: ${DELIVERY_WINDOWS.map((w) => w.id).join(', ')}`,
      );
    }

    const pickupZone = resolveZone(input.pickupAddress);
    const deliveryZone = resolveZone(input.deliveryAddress);
    const miles = round(zoneMiles(pickupZone.id, deliveryZone.id), 2);

    const matches = this.findMatches({
      deliveryZoneId: deliveryZone.id,
      windowId: input.windowId,
      weightLbs: input.weightLbs,
    });

    const shipperCount = matches.length + 1;
    const totalWeight = matches.reduce((sum, m) => sum + m.weight_lbs, input.weightLbs);
    const share = allocationShare(input.weightLbs, totalWeight, shipperCount);
    const dedicated = dedicatedPrice(miles, input.weightLbs);
    const price =
      shipperCount > 1
        ? consolidatedPrice(miles, input.weightLbs, totalWeight, shipperCount)
        : dedicated;
    const co2 = shipperCount > 1 ? freightCo2SavedLbs(miles, shipperCount, share) : 0;

    return {
      quoteId: newId('fq'),
      pickupZone: { id: pickupZone.id, name: pickupZone.name },
      deliveryZone: { id: deliveryZone.id, name: deliveryZone.name },
      windowId: deliveryWindow.id,
      windowLabel: deliveryWindow.label,
      cargoType: input.cargoType,
      weightLbs: input.weightLbs,
      miles,
      matchedLoads: matches.map((load) => ({
        id: load.id,
        businessName: load.business_name,
        cargoType: load.cargo_type,
        weightLbs: load.weight_lbs,
        deliveryZone: load.delivery_zone,
        deliveryZoneName: zoneById(load.delivery_zone)?.name ?? load.delivery_zone,
        windowId: load.window_id,
        windowLabel: windowById(load.window_id)?.label ?? load.window_id,
        sharePct: round(
          allocationShare(load.weight_lbs, totalWeight, shipperCount) * 100,
          0,
        ),
      })),
      shipperCount,
      totalWeightLbs: round(totalWeight, 0),
      vanCapacityLbs: VAN_CAPACITY_LBS,
      capacityUsedPct: round((totalWeight / VAN_CAPACITY_LBS) * 100, 0),
      priceUsd: price,
      dedicatedUsd: dedicated,
      savingsUsd: round(Math.max(0, dedicated - price), 2),
      savingsPct: round(Math.max(0, ((dedicated - price) / dedicated) * 100), 0),
      co2SavedLbs: co2,
      yourSharePct: round(share * 100, 0),
      consolidated: shipperCount > 1,
    };
  }

  // --- booking -----------------------------------------------------------

  /**
   * Confirm consolidation: the requesting business's load and its matches are
   * pulled out of the open pool and put on one van.
   */
  confirm(
    userId: string,
    businessName: string,
    input: {
      pickupAddress: string;
      deliveryAddress: string;
      cargoType: string;
      weightLbs: number;
      windowId: string;
      notes?: string;
    },
    at: number = now(),
  ): ShipmentView {
    const quote = this.quote(input);
    const date = serviceDate(at);

    const run = this.db.transaction(() => {
      const shipment: ShipmentRow = {
        id: newId('ship'),
        van_label: this.nextVanLabel(),
        delivery_zone: quote.deliveryZone.id,
        window_id: quote.windowId,
        status: 'in_transit',
        miles: quote.miles,
        co2_saved_lbs: quote.co2SavedLbs,
        service_date: date,
        created_at: at,
        dispatched_at: at,
        delivered_at: null,
      };
      this.db
        .prepare(
          `INSERT INTO freight_shipments
             (id, van_label, delivery_zone, window_id, status, miles, co2_saved_lbs,
              service_date, created_at, dispatched_at, delivered_at)
           VALUES (@id, @van_label, @delivery_zone, @window_id, @status, @miles, @co2_saved_lbs,
                   @service_date, @created_at, @dispatched_at, @delivered_at)`,
        )
        .run(shipment);

      const ownLoad: LoadRow = {
        id: newId('load'),
        user_id: userId,
        shipment_id: shipment.id,
        business_name: businessName,
        pickup_address: input.pickupAddress,
        delivery_address: input.deliveryAddress,
        pickup_zone: quote.pickupZone.id,
        delivery_zone: quote.deliveryZone.id,
        cargo_type: input.cargoType,
        weight_lbs: input.weightLbs,
        window_id: quote.windowId,
        status: 'in_transit',
        price_cents: toCents(quote.priceUsd),
        dedicated_cents: toCents(quote.dedicatedUsd),
        co2_saved_lbs: quote.co2SavedLbs,
        notes: input.notes ?? null,
        service_date: date,
        created_at: at,
        confirmed_at: at,
        cancelled_at: null,
      };
      this.db
        .prepare(
          `INSERT INTO freight_loads
             (id, user_id, shipment_id, business_name, pickup_address, delivery_address,
              pickup_zone, delivery_zone, cargo_type, weight_lbs, window_id, status,
              price_cents, dedicated_cents, co2_saved_lbs, notes, service_date, created_at,
              confirmed_at, cancelled_at)
           VALUES (@id, @user_id, @shipment_id, @business_name, @pickup_address, @delivery_address,
                   @pickup_zone, @delivery_zone, @cargo_type, @weight_lbs, @window_id, @status,
                   @price_cents, @dedicated_cents, @co2_saved_lbs, @notes, @service_date,
                   @created_at, @confirmed_at, @cancelled_at)`,
        )
        .run(ownLoad);

      // Claim the matched loads. The status guard means a load already taken by
      // a concurrent request is skipped rather than double-booked.
      const claim = this.db.prepare(
        `UPDATE freight_loads
            SET status = 'in_transit', shipment_id = ?, confirmed_at = ?
          WHERE id = ? AND status = 'open'`,
      );
      for (const match of quote.matchedLoads) {
        claim.run(shipment.id, at, match.id);
      }

      // Price against the van that actually went out, not the one the quote
      // predicted: a load claimed by someone else in between would otherwise
      // leave everyone paying a share of a fuller van than they got.
      const onboard = this.db
        .prepare('SELECT id, weight_lbs FROM freight_loads WHERE shipment_id = ?')
        .all(shipment.id) as { id: string; weight_lbs: number }[];
      const shipperCount = onboard.length;
      const totalWeight = onboard.reduce((sum, load) => sum + load.weight_lbs, 0);

      const setPrice = this.db.prepare(
        'UPDATE freight_loads SET price_cents = ?, co2_saved_lbs = ? WHERE id = ?',
      );
      let ownPriceUsd = quote.dedicatedUsd;
      let ownCo2 = 0;
      for (const load of onboard) {
        const share = allocationShare(load.weight_lbs, totalWeight, shipperCount);
        const price =
          shipperCount > 1
            ? consolidatedPrice(quote.miles, load.weight_lbs, totalWeight, shipperCount)
            : dedicatedPrice(quote.miles, load.weight_lbs);
        const co2 = shipperCount > 1 ? freightCo2SavedLbs(quote.miles, shipperCount, share) : 0;
        setPrice.run(toCents(price), co2, load.id);
        if (load.id === ownLoad.id) {
          ownPriceUsd = price;
          ownCo2 = co2;
        }
      }

      this.db
        .prepare('UPDATE freight_shipments SET co2_saved_lbs = ? WHERE id = ?')
        .run(
          shipperCount > 1 ? freightCo2SavedLbs(quote.miles, shipperCount, 1) : 0,
          shipment.id,
        );

      return { shipment, ownPriceUsd, ownCo2 };
    });

    const { shipment, ownPriceUsd, ownCo2 } = run();
    this.impact.recordFreightLoad({
      co2SavedLbs: ownCo2,
      savingsCents: toCents(Math.max(0, quote.dedicatedUsd - ownPriceUsd)),
      at,
    });
    this.events.emit('shipment:updated', { shipmentId: shipment.id });
    return this.shipmentView(shipment.id, userId, at);
  }

  // --- tracking ----------------------------------------------------------

  /**
   * Total time a consolidated run takes: pickups, consolidation, then
   * delivery. Divided by TIME_SCALE so freight moves on the same compressed
   * clock as the shuttle network.
   */
  private runDurationMs(miles: number, shipperCount: number): number {
    const driveMinutes = (miles / 18) * 60; // Vans move faster than the loop shuttles.
    const handlingMinutes = 4 * shipperCount + 6;
    const simulatedMs = (driveMinutes + handlingMinutes) * 60 * 1000;
    return simulatedMs / Math.max(0.1, config.timeScale);
  }

  /** Simulated minutes remaining, which is what the tracking screen shows. */
  private simulatedMinutesFor(wallClockMs: number): number {
    return (wallClockMs * Math.max(0.1, config.timeScale)) / 60000;
  }

  shipmentView(shipmentId: string, userId: string | null, at: number = now()): ShipmentView {
    const shipment = this.db
      .prepare('SELECT * FROM freight_shipments WHERE id = ?')
      .get(shipmentId) as ShipmentRow | undefined;
    if (!shipment) throw ApiError.notFound('Shipment not found');

    const loads = this.db
      .prepare('SELECT * FROM freight_loads WHERE shipment_id = ? ORDER BY created_at ASC')
      .all(shipmentId) as LoadRow[];

    const totalWeight = loads.reduce((sum, l) => sum + l.weight_lbs, 0);
    const durationMs = this.runDurationMs(shipment.miles, Math.max(1, loads.length));
    const elapsed = at - (shipment.dispatched_at ?? shipment.created_at);
    const progress = Math.max(0, Math.min(1, elapsed / durationMs));
    // The in-transit phases spread across the run; "Delivered" is reserved for
    // a van that has actually finished, never shown just because time is up.
    const enRoutePhases = FREIGHT_PHASES.length - 1;
    const phaseIndex =
      shipment.status === 'delivered'
        ? FREIGHT_PHASES.length - 1
        : Math.min(enRoutePhases - 1, Math.floor(progress * enRoutePhases));
    const remainingMs = Math.max(0, durationMs - elapsed);

    return {
      id: shipment.id,
      vanLabel: shipment.van_label,
      status: shipment.status,
      phase: FREIGHT_PHASES[phaseIndex]!,
      phaseIndex,
      phases: FREIGHT_PHASES,
      deliveryZone: {
        id: shipment.delivery_zone,
        name: zoneById(shipment.delivery_zone)?.name ?? shipment.delivery_zone,
      },
      windowId: shipment.window_id,
      windowLabel: windowById(shipment.window_id)?.label ?? shipment.window_id,
      miles: shipment.miles,
      co2SavedLbs: shipment.co2_saved_lbs,
      etaSeconds: Math.round(this.simulatedMinutesFor(remainingMs) * 60),
      etaMinutes:
        shipment.status === 'delivered'
          ? 0
          : Math.max(1, Math.round(this.simulatedMinutesFor(remainingMs))),
      progressPct: round(progress * 100, 0),
      loads: loads.map((load) => ({
        id: load.id,
        businessName: load.business_name,
        cargoType: load.cargo_type,
        weightLbs: load.weight_lbs,
        priceUsd: load.price_cents === null ? null : usd(load.price_cents),
        isYours: userId !== null && load.user_id === userId,
      })),
      totalWeightLbs: round(totalWeight, 0),
      createdAt: iso(shipment.created_at),
      dispatchedAt: shipment.dispatched_at ? iso(shipment.dispatched_at) : null,
      deliveredAt: shipment.delivered_at ? iso(shipment.delivered_at) : null,
    };
  }

  /** Move finished runs to "delivered". Called on the simulation tick. */
  advanceShipments(at: number = now()): string[] {
    const active = this.db
      .prepare(`SELECT * FROM freight_shipments WHERE status = 'in_transit'`)
      .all() as ShipmentRow[];
    const delivered: string[] = [];

    for (const shipment of active) {
      const loadCount = (
        this.db
          .prepare('SELECT COUNT(*) AS n FROM freight_loads WHERE shipment_id = ?')
          .get(shipment.id) as { n: number }
      ).n;
      const durationMs = this.runDurationMs(shipment.miles, Math.max(1, loadCount));
      if (at - (shipment.dispatched_at ?? shipment.created_at) < durationMs) continue;

      this.db.transaction(() => {
        this.db
          .prepare(`UPDATE freight_shipments SET status = 'delivered', delivered_at = ? WHERE id = ?`)
          .run(at, shipment.id);
        this.db
          .prepare(`UPDATE freight_loads SET status = 'delivered' WHERE shipment_id = ?`)
          .run(shipment.id);
      })();
      delivered.push(shipment.id);
      this.events.emit('shipment:updated', { shipmentId: shipment.id });
    }
    return delivered;
  }

  listShipmentsForUser(userId: string, limit = 20): ShipmentView[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT s.id, s.created_at FROM freight_shipments s
           JOIN freight_loads l ON l.shipment_id = s.id
          WHERE l.user_id = ?
          ORDER BY s.created_at DESC LIMIT ?`,
      )
      .all(userId, Math.min(100, Math.max(1, limit))) as { id: string; created_at: number }[];
    const at = now();
    return rows.map((row) => this.shipmentView(row.id, userId, at));
  }

  /** The open pool, for a "loads looking for a van" view. */
  listOpenLoads(limit = 20): MatchedLoad[] {
    const rows = this.db
      .prepare(`SELECT * FROM freight_loads WHERE status = 'open' ORDER BY created_at DESC LIMIT ?`)
      .all(Math.min(100, Math.max(1, limit))) as LoadRow[];
    return rows.map((load) => ({
      id: load.id,
      businessName: load.business_name,
      cargoType: load.cargo_type,
      weightLbs: load.weight_lbs,
      deliveryZone: load.delivery_zone,
      deliveryZoneName: zoneById(load.delivery_zone)?.name ?? load.delivery_zone,
      windowId: load.window_id,
      windowLabel: windowById(load.window_id)?.label ?? load.window_id,
      sharePct: 0,
    }));
  }

  private nextVanLabel(): string {
    const count = (
      this.db.prepare('SELECT COUNT(*) AS n FROM freight_shipments').get() as { n: number }
    ).n;
    return `FH-${String((count % 99) + 1).padStart(2, '0')}`;
  }
}
