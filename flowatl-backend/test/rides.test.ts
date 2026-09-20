import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { RIDE_PHASES } from '../src/domain/rides.js';
import { createServices, type Services } from '../src/services.js';
import { openDatabase } from '../src/store/db.js';

/**
 * Drives the network forward with a controlled clock and follows one booked
 * ride all the way from "shuttle approaching" to "you have arrived".
 */
function harness() {
  let clock = Date.now();
  const services = createServices({
    db: openDatabase(':memory:'),
    simulation: {
      fleetSize: 4,
      capacity: 12,
      speedMph: 12,
      dwellSeconds: 20,
      seed: 31337,
      clock: () => clock,
    },
  });
  const advance = (seconds: number, step = 10) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
      clock += step * 1000;
      services.simulation.tick(clock);
    }
  };
  return { services, advance };
}

describe('ride lifecycle', () => {
  let services: Services;
  let advance: (seconds: number, step?: number) => void;
  let userId: string;

  beforeEach(() => {
    const h = harness();
    services = h.services;
    advance = h.advance;
    userId = services.auth.register({
      email: `rider-${Math.random().toString(36).slice(2)}@test.flowatl`,
      password: 'correct horse battery',
    }).user.id;
  });

  it('books a ride onto a real shuttle with a seat held', () => {
    const ride = services.rides.book(userId, 'five-points', 'aquarium');
    assert.equal(ride.status, 'awaiting_pickup');
    assert.equal(ride.phase, 'Approaching');
    assert.ok(ride.shuttle, 'the ride should name the shuttle that is coming');
    assert.ok(ride.boardingPass, 'a booked ride gets a boarding pass');
    assert.match(ride.boardingPass.qrPayload, /^flowatl:\/\/board\?ride=ride_/);

    const shuttle = services.simulation.shuttleById(ride.shuttle.id)!;
    assert.equal(shuttle.heldSeats, 1, 'a seat should be held until the rider boards');
  });

  it('refuses a second ride while one is in progress', () => {
    services.rides.book(userId, 'five-points', 'aquarium');
    assert.throws(
      () => services.rides.book(userId, 'benz', 'castleberry'),
      /already has a ride in progress/,
    );
  });

  it('will not book a trip that goes nowhere', () => {
    assert.throws(
      () => services.rides.book(userId, 'aquarium', 'aquarium'),
      /must be different stops/,
    );
  });

  it('carries the rider from pickup to destination', () => {
    const booked = services.rides.book(userId, 'five-points', 'aquarium');
    const phasesSeen = new Set<string>([booked.phase]);
    const statusesSeen = new Set<string>([booked.status]);

    // Two and a half laps is more than enough for any pickup on the loop.
    const limit = services.simulation.loopSeconds() * 2.5;
    for (let elapsed = 0; elapsed < limit; elapsed += 10) {
      advance(10, 10);
      const ride = services.rides.get(booked.id, userId);
      phasesSeen.add(ride.phase);
      statusesSeen.add(ride.status);
      if (ride.status === 'completed') break;
    }

    const final = services.rides.get(booked.id, userId);
    assert.equal(final.status, 'completed', 'the ride should finish within two and a half laps');
    assert.equal(final.phase, 'Completed');
    assert.equal(final.progressPct, 100);
    assert.ok(final.boardedAt, 'the rider should have boarded');
    assert.ok(final.completedAt);
    assert.ok(
      new Date(final.completedAt).getTime() > new Date(final.boardedAt).getTime(),
      'arrival comes after boarding',
    );

    assert.deepEqual([...statusesSeen].sort(), ['awaiting_pickup', 'completed', 'onboard']);
    assert.ok(phasesSeen.has('Approaching'));
    assert.ok(
      phasesSeen.has('En Route') || phasesSeen.has('Arriving at Destination'),
      `expected an in-vehicle phase, saw ${[...phasesSeen].join(', ')}`,
    );
    for (const phase of phasesSeen) {
      assert.ok(
        [...RIDE_PHASES, 'Completed'].includes(phase as never),
        `unexpected phase "${phase}"`,
      );
    }
  });

  it('releases the seat and frees the rider when a ride is cancelled', () => {
    const ride = services.rides.book(userId, 'five-points', 'aquarium');
    const shuttle = services.simulation.shuttleById(ride.shuttle!.id)!;
    assert.equal(shuttle.heldSeats, 1);

    const cancelled = services.rides.cancel(ride.id, userId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.phase, 'Cancelled');
    assert.equal(shuttle.heldSeats, 0, 'the held seat goes back to the pool');

    // With nothing in progress, the rider can book again.
    assert.ok(services.rides.book(userId, 'benz', 'castleberry'));
  });

  it('keeps one rider out of another rider\'s trip', () => {
    const ride = services.rides.book(userId, 'five-points', 'aquarium');
    const other = services.auth.register({
      email: 'someone-else@test.flowatl',
      password: 'correct horse battery',
    }).user.id;
    assert.throws(() => services.rides.get(ride.id, other), /another account/);
  });

  it('credits the rider and the network once the trip completes', () => {
    const before = services.impact.network();
    const booked = services.rides.book(userId, 'five-points', 'aquarium');

    const limit = services.simulation.loopSeconds() * 2.5;
    for (let elapsed = 0; elapsed < limit; elapsed += 10) {
      advance(10, 10);
      if (services.rides.get(booked.id, userId).status === 'completed') break;
    }

    const personal = services.impact.personal(userId);
    assert.equal(personal.ridesTaken, 1);
    assert.ok(personal.co2SavedLbs > 0);
    assert.ok(personal.moneySavedUsd > 0, 'the rider saved against the ride-hail price');
    assert.equal(personal.favoriteStopId, 'five-points');
    assert.equal(personal.rewardTier.ridesRemaining, personal.rewardTier.ridesRequired - 1);

    const after = services.impact.network();
    assert.equal(after.bookedRidesToday, before.bookedRidesToday + 1);
    assert.ok(after.ridesToday > before.ridesToday);
  });

  it('charges nothing to a FlowPass holder but still counts the saving', () => {
    services.subscriptions.subscribe(userId);
    const ride = services.rides.book(userId, 'five-points', 'castleberry');
    assert.equal(ride.fareUsd, 0);
    assert.ok(ride.listFareUsd > 0);
    assert.ok(ride.coveredBySubscription);
    assert.equal(ride.savingsUsd, ride.ridehailUsd);
  });
});
