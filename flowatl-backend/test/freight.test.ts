import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  MAX_SHIPPERS_PER_VAN,
  VAN_CAPACITY_LBS,
  allocationShare,
  consolidatedPrice,
  dedicatedPrice,
  freightCo2SavedLbs,
  FreightService,
} from '../src/domain/freight.js';
import { AuthService } from '../src/domain/auth.js';
import { ImpactService } from '../src/domain/impact.js';
import { NetworkSimulation } from '../src/domain/simulation.js';
import { resolveZone, windowOverlapHours, zoneMiles } from '../src/domain/zones.js';
import { openDatabase, type Db } from '../src/store/db.js';

describe('delivery zones', () => {
  it('reads the neighbourhood out of an address', () => {
    assert.equal(resolveZone('1180 Peachtree St NE, Midtown').id, 'midtown');
    assert.equal(resolveZone('260 Peters St SW, Castleberry Hill').id, 'castleberry');
    assert.equal(resolveZone('3393 Peachtree Rd NE, Buckhead').id, 'buckhead');
    assert.equal(resolveZone('1100 Howell Mill Rd NW').id, 'westside');
  });

  it('falls back to downtown for an address it cannot place', () => {
    assert.equal(resolveZone('somewhere unlabelled').id, 'downtown');
  });

  it('prefers the more specific match', () => {
    // "peachtree rd ne" (Buckhead) is longer and more specific than "peachtree st ne".
    assert.equal(resolveZone('3376 Peachtree Rd NE').id, 'buckhead');
  });

  it('measures a sane distance between zones', () => {
    assert.ok(zoneMiles('downtown', 'midtown') > 1);
    assert.ok(zoneMiles('downtown', 'perimeter') > zoneMiles('downtown', 'midtown'));
    assert.ok(zoneMiles('midtown', 'midtown') > 0, 'intra-zone runs still cover ground');
  });

  it('knows which delivery windows can share a van', () => {
    assert.equal(windowOverlapHours('morning', 'morning'), 4);
    // 8-12 and 12-17 touch but do not overlap.
    assert.equal(windowOverlapHours('morning', 'afternoon'), 0);
    assert.equal(windowOverlapHours('morning', 'evening'), 0);
  });
});

describe('freight pricing', () => {
  it('charges less when the van is shared', () => {
    const dedicated = dedicatedPrice(4, 150);
    const shared = consolidatedPrice(4, 150, 600, 4);
    assert.ok(shared < dedicated, `${shared} should undercut ${dedicated}`);
  });

  it('charges a heavier load more than a lighter one on the same van', () => {
    const heavy = consolidatedPrice(4, 400, 800, 3);
    const light = consolidatedPrice(4, 100, 800, 3);
    assert.ok(heavy > light);
  });

  it('gets cheaper as more shippers join the run', () => {
    const alone = consolidatedPrice(4, 150, 150, 1);
    const crowded = consolidatedPrice(4, 150, 900, 5);
    assert.ok(crowded < alone);
  });

  it('splits the whole van between its shippers', () => {
    const weights = [150, 120, 85, 210];
    const total = weights.reduce((a, b) => a + b, 0);
    const shares = weights.map((w) => allocationShare(w, total, weights.length));
    const sum = shares.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `shares summed to ${sum}`);
  });

  it('saves no CO2 when nobody else is on the van', () => {
    assert.ok(freightCo2SavedLbs(4, 1, 1) >= 0);
    assert.ok(freightCo2SavedLbs(4, 4, 0.25) > freightCo2SavedLbs(4, 2, 0.25));
  });
});

describe('freight consolidation', () => {
  let db: Db;
  let freight: FreightService;
  let userId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    const simulation = new NetworkSimulation({ fleetSize: 2, seed: 1 });
    freight = new FreightService(db, new ImpactService(db, simulation));
    freight.seedOpenLoads();
    // Loads are owned by a real account — the schema enforces it.
    userId = new AuthService(db).register({
      email: 'diner@test.flowatl',
      password: 'correct horse battery',
      businessName: 'Test Diner',
    }).user.id;
  });

  it('stocks an open-load pool', () => {
    assert.ok(freight.listOpenLoads(50).length > 0);
  });

  it('does not double-seed the same day', () => {
    const before = freight.listOpenLoads(100).length;
    freight.seedOpenLoads();
    assert.equal(freight.listOpenLoads(100).length, before);
  });

  it('matches only loads going the same way in the same window', () => {
    const quote = freight.quote({
      pickupAddress: '123 Marietta St NW',
      deliveryAddress: '1180 Peachtree St NE, Midtown',
      cargoType: 'Restaurant Supplies',
      weightLbs: 150,
      windowId: 'morning',
    });
    assert.ok(quote.matchedLoads.length > 0, 'the seeded pool should offer a match');
    for (const match of quote.matchedLoads) {
      assert.equal(match.deliveryZone, 'midtown');
      assert.ok(windowOverlapHours(match.windowId, 'morning') > 0);
    }
  });

  it('quotes below the dedicated price and reports the saving', () => {
    const quote = freight.quote({
      pickupAddress: '123 Marietta St NW',
      deliveryAddress: '1180 Peachtree St NE, Midtown',
      cargoType: 'Restaurant Supplies',
      weightLbs: 150,
      windowId: 'morning',
    });
    assert.ok(quote.consolidated);
    assert.ok(quote.priceUsd < quote.dedicatedUsd);
    assert.equal(quote.savingsUsd, Math.round((quote.dedicatedUsd - quote.priceUsd) * 100) / 100);
    assert.ok(quote.savingsPct > 0 && quote.savingsPct < 100);
    assert.ok(quote.co2SavedLbs > 0);
  });

  it('never overloads the van', () => {
    const quote = freight.quote({
      pickupAddress: '123 Marietta St NW',
      deliveryAddress: '1180 Peachtree St NE, Midtown',
      cargoType: 'Other',
      weightLbs: 1500,
      windowId: 'morning',
    });
    assert.ok(quote.totalWeightLbs <= VAN_CAPACITY_LBS);
    assert.ok(quote.shipperCount <= MAX_SHIPPERS_PER_VAN);
  });

  it('rejects cargo heavier than a van', () => {
    assert.throws(
      () =>
        freight.quote({
          pickupAddress: 'a place downtown',
          deliveryAddress: 'another place in midtown',
          cargoType: 'Other',
          weightLbs: VAN_CAPACITY_LBS + 1,
          windowId: 'morning',
        }),
      /between 1 and/,
    );
  });

  it('falls back to a dedicated run when nothing else is heading that way', () => {
    const quote = freight.quote({
      pickupAddress: '123 Marietta St NW',
      deliveryAddress: '2200 Clairmont Rd, Decatur',
      cargoType: 'Other',
      weightLbs: 200,
      windowId: 'evening',
    });
    assert.equal(quote.matchedLoads.length, 0);
    assert.equal(quote.consolidated, false);
    assert.equal(quote.priceUsd, quote.dedicatedUsd);
    assert.equal(quote.savingsUsd, 0);
  });

  it('takes the matched loads off the market once consolidation is confirmed', () => {
    const input = {
      pickupAddress: '123 Marietta St NW',
      deliveryAddress: '1180 Peachtree St NE, Midtown',
      cargoType: 'Restaurant Supplies' as const,
      weightLbs: 150,
      windowId: 'morning',
    };
    const quote = freight.quote(input);
    const matchedIds = quote.matchedLoads.map((m) => m.id);
    const shipment = freight.confirm(userId, 'Test Diner', input);

    assert.equal(shipment.loads.length, quote.shipperCount);
    assert.ok(shipment.loads.some((load) => load.isYours));

    const stillOpen = freight.listOpenLoads(100).map((l) => l.id);
    for (const id of matchedIds) {
      assert.ok(!stillOpen.includes(id), `${id} should no longer be open`);
    }
  });

  it('prices every load against the van that actually went out', () => {
    const input = {
      pickupAddress: '123 Marietta St NW',
      deliveryAddress: '1180 Peachtree St NE, Midtown',
      cargoType: 'Restaurant Supplies' as const,
      weightLbs: 150,
      windowId: 'morning',
    };
    const quote = freight.quote(input);

    // Someone else claims one of the matched loads between quote and confirm.
    const stolen = quote.matchedLoads[0]!;
    db.prepare(`UPDATE freight_loads SET status = 'in_transit' WHERE id = ?`).run(stolen.id);

    const shipment = freight.confirm(userId, 'Test Diner', input);
    assert.ok(
      !shipment.loads.some((load) => load.id === stolen.id),
      'the claimed load should not be on this van',
    );

    // Everyone still on the van pays a share of that van, and the shares add up.
    const total = shipment.loads.reduce((sum, load) => sum + (load.priceUsd ?? 0), 0);
    for (const load of shipment.loads) {
      assert.ok(load.priceUsd && load.priceUsd > 0, `${load.businessName} should have a price`);
    }
    assert.ok(total > 0);
    const mine = shipment.loads.find((load) => load.isYours)!;
    assert.ok(
      mine.priceUsd! > quote.priceUsd,
      'a emptier van costs each remaining shipper more than the quote assumed',
    );
  });

  it('tracks a shipment from dispatch to delivery', () => {
    const input = {
      pickupAddress: '123 Marietta St NW',
      deliveryAddress: '1180 Peachtree St NE, Midtown',
      cargoType: 'Restaurant Supplies' as const,
      weightLbs: 150,
      windowId: 'morning',
    };
    const start = Date.now();
    const shipment = freight.confirm(userId, 'Test Diner', input, start);
    assert.equal(shipment.phase, 'Dispatched');
    assert.equal(shipment.progressPct, 0);

    // Halfway through the run it should be somewhere in the middle.
    const midway = freight.shipmentView(shipment.id, userId, start + 8 * 60 * 1000);
    assert.ok(midway.phaseIndex > 0);
    assert.ok(midway.progressPct > 0 && midway.progressPct < 100);

    // "Delivered" must never show while the van is still out, however long
    // the run has been going.
    for (const minutes of [1, 5, 10, 20, 45, 120]) {
      const view = freight.shipmentView(shipment.id, userId, start + minutes * 60 * 1000);
      if (view.status !== 'delivered') {
        assert.notEqual(view.phase, 'Delivered', `showed Delivered at ${minutes}m while in transit`);
      }
    }

    // Well past the run duration it should be delivered.
    const later = start + 3 * 60 * 60 * 1000;
    const delivered = freight.advanceShipments(later);
    assert.ok(delivered.includes(shipment.id));
    const final = freight.shipmentView(shipment.id, userId, later);
    assert.equal(final.status, 'delivered');
    assert.equal(final.phase, 'Delivered');
    assert.ok(final.deliveredAt);
  });
});
