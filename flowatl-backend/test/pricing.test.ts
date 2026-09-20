import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MIN_FARE_USD,
  co2SavedLbs,
  listFare,
  quoteRide,
  ridehailPrice,
} from '../src/domain/pricing.js';
import { LOOP_MILES, tripMiles } from '../src/domain/network.js';

describe('fares', () => {
  it('charges $0.35 per stop with a $1.50 minimum', () => {
    // One stop is $0.35, so the minimum applies.
    assert.equal(listFare('five-points', 'centennial'), MIN_FARE_USD);
    // Five stops is $1.75, above the minimum.
    assert.equal(listFare('centennial', 'five-points'), 1.75);
  });

  it('is free to go nowhere', () => {
    assert.equal(listFare('five-points', 'five-points'), 0);
  });

  it('waives the fare for FlowPass holders but keeps the list price', () => {
    const quote = quoteRide('five-points', 'aquarium', { hasSubscription: true });
    assert.equal(quote.fareUsd, 0);
    assert.equal(quote.listFareUsd, MIN_FARE_USD);
    assert.ok(quote.coveredBySubscription);
    assert.ok(quote.savingsUsd > 0);
  });
});

describe('ride-hail comparison', () => {
  it('never quotes below the trip minimum', () => {
    assert.equal(ridehailPrice(0.1), 8.25);
  });

  it('costs more the further you go', () => {
    assert.ok(ridehailPrice(5) > ridehailPrice(1));
  });

  it('always beats the shuttle fare on a real trip', () => {
    const quote = quoteRide('five-points', 'castleberry');
    assert.ok(quote.ridehailUsd > quote.fareUsd);
    assert.equal(quote.savingsUsd, Math.round((quote.ridehailUsd - quote.fareUsd) * 100) / 100);
  });
});

describe('emissions', () => {
  it('saves more CO2 on a fuller shuttle', () => {
    const sparse = co2SavedLbs(2, 1);
    const full = co2SavedLbs(2, 12);
    assert.ok(full > sparse, 'spreading the shuttle draw over more riders saves more each');
  });

  it('never reports a negative saving', () => {
    assert.ok(co2SavedLbs(0, 1) >= 0);
    assert.ok(co2SavedLbs(LOOP_MILES, 1) >= 0);
  });

  it('scales with distance', () => {
    assert.ok(co2SavedLbs(4, 6) > co2SavedLbs(1, 6));
  });
});

describe('quotes', () => {
  it('reports the same mileage the network does', () => {
    const quote = quoteRide('five-points', 'benz');
    assert.equal(quote.miles, Math.round(tripMiles('five-points', 'benz') * 100) / 100);
    assert.equal(quote.stopsTraversed, 3);
  });
});
