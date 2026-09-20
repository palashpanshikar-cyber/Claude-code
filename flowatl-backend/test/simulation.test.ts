import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { STOPS, STOP_COUNT, stopDistance } from '../src/domain/network.js';
import { NetworkSimulation, type SimulationOptions } from '../src/domain/simulation.js';

/** Noon in Atlanta on a weekday — the middle of the demand curve. */
const START = Date.UTC(2026, 8, 20, 16, 0, 0);

function makeSim(overrides: SimulationOptions = {}) {
  let clock = START;
  const simulation = new NetworkSimulation({
    fleetSize: 4,
    capacity: 8,
    speedMph: 12,
    dwellSeconds: 20,
    seed: 4242,
    timeScale: 1,
    clock: () => clock,
    ...overrides,
  });
  /** Advance the world by `seconds`, ticking every `step` seconds. */
  const advance = (seconds: number, step = 30) => {
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
      clock += step * 1000;
      simulation.tick(clock);
    }
  };
  return { simulation, advance, at: () => clock };
}

describe('network simulation', () => {
  let sim: ReturnType<typeof makeSim>;

  beforeEach(() => {
    sim = makeSim();
  });

  it('starts with the configured fleet spread around the loop', () => {
    assert.equal(sim.simulation.fleetSize, 4);
    const positions = sim.simulation.snapshotAll().map((s) => s.distanceMiles);
    assert.equal(new Set(positions).size, 4, 'no two shuttles start in the same place');
  });

  it('opens with riders already aboard', () => {
    assert.ok(sim.simulation.totalPassengers() > 0, 'the warm-up should leave riders on board');
  });

  it('moves the fleet as time passes', () => {
    const before = sim.simulation.snapshotAll().map((s) => s.odometerMiles);
    sim.advance(600);
    const after = sim.simulation.snapshotAll().map((s) => s.odometerMiles);
    after.forEach((miles, i) => assert.ok(miles > before[i]!, 'each shuttle should cover ground'));
  });

  it('visits every stop within a couple of laps', () => {
    const visited = new Set<number>();
    sim.simulation.events.on('shuttle:arrive', ({ stopIndex }) => visited.add(stopIndex));
    sim.advance(sim.simulation.loopSeconds() * 2, 15);
    assert.equal(visited.size, STOP_COUNT, 'all six stops should be served');
  });

  it('never carries more riders than there are seats', () => {
    sim.advance(sim.simulation.loopSeconds() * 3, 15);
    for (const shuttle of sim.simulation.snapshotAll()) {
      assert.ok(
        shuttle.passengers <= shuttle.capacity,
        `${shuttle.label} carried ${shuttle.passengers} of ${shuttle.capacity}`,
      );
      assert.ok(shuttle.passengers >= 0);
    }
  });

  describe('battery and charging', () => {
    it('drains the battery as the shuttles drive', () => {
      const before = sim.simulation.snapshotAll()[0]!.batteryPct;
      sim.advance(1800, 15);
      const after = sim.simulation.snapshotAll()[0]!.batteryPct;
      assert.ok(after !== before, 'battery state should change over half an hour of service');
    });

    it('sends a low shuttle to the depot before the pack runs flat', () => {
      // A top-up only takes a couple of minutes, so sample often enough to
      // catch one rather than checking on the hour.
      let sawCharging = false;
      let sawOutOfService = false;
      for (let minute = 0; minute < 8 * 60; minute++) {
        sim.advance(60, 20);
        for (const shuttle of sim.simulation.snapshotAll()) {
          if (shuttle.status === 'charging') sawCharging = true;
          if (!shuttle.acceptingRiders) sawOutOfService = true;
          assert.ok(
            shuttle.batteryPct > 0,
            `${shuttle.label} ran the pack to ${shuttle.batteryPct}% without charging`,
          );
        }
        if (sawCharging) break;
      }
      assert.ok(sawOutOfService, 'a shuttle should have gone out of service to charge');
      assert.ok(sawCharging, 'a shuttle should have pulled into the depot within eight hours');
    });

    it('stops picking riders up once it is depot-bound', () => {
      const shuttle = sim.simulation.shuttleById('shuttle_flo01')!;
      shuttle.outOfService = true;
      assert.equal(sim.simulation.availableSeats(shuttle), 0, 'no new reservations');
      assert.equal(sim.simulation.holdSeat(shuttle.id), false);
      assert.equal(sim.simulation.snapshot(shuttle).acceptingRiders, false);
      // It no longer counts toward the headway riders actually experience.
      assert.equal(sim.simulation.activeShuttleCount(), sim.simulation.fleetSize - 1);
    });

    it('empties a depot-bound shuttle instead of filling it', () => {
      const shuttle = sim.simulation.shuttleById('shuttle_flo02')!;
      shuttle.outOfService = true;
      const before = sim.simulation.passengerCount(shuttle);
      sim.advance(sim.simulation.loopSeconds() * 1.2, 15);
      assert.ok(
        sim.simulation.passengerCount(shuttle) <= before,
        'a depot-bound shuttle should only ever shed riders',
      );
    });
  });

  describe('arrivals', () => {
    it('returns soonest-first, within the requested limit', () => {
      const arrivals = sim.simulation.arrivalsAtStop('five-points', 3);
      assert.ok(arrivals.length <= 3 && arrivals.length > 0);
      for (let i = 1; i < arrivals.length; i++) {
        assert.ok(arrivals[i]!.etaSeconds >= arrivals[i - 1]!.etaSeconds);
      }
    });

    it('never predicts an arrival in the past', () => {
      for (const stop of STOPS) {
        for (const arrival of sim.simulation.arrivalsAtStop(stop.id, 5)) {
          assert.ok(arrival.etaSeconds >= 0, `${stop.id} -> ${arrival.etaSeconds}s`);
        }
      }
    });

    it('predicts a wait no longer than one full circuit', () => {
      const loop = sim.simulation.loopSeconds();
      for (const stop of STOPS) {
        const next = sim.simulation.arrivalsAtStop(stop.id, 1)[0]!;
        assert.ok(
          next.etaSeconds <= loop + 60,
          `${stop.id} waits ${next.etaSeconds}s, longer than a ${Math.round(loop)}s loop`,
        );
      }
    });

    it('reports zero for a shuttle standing at the stop', () => {
      const shuttle = sim.simulation.shuttleById('shuttle_flo01')!;
      shuttle.status = 'dwelling';
      shuttle.atStopIndex = 2;
      shuttle.distanceMiles = stopDistance(2);
      assert.equal(sim.simulation.estimateArrivalSeconds(shuttle, 2), 0);
    });
  });

  describe('seat management', () => {
    /** The warm-up leaves some shuttles full; these tests need one with room. */
    const shuttleWithRoom = () => {
      const shuttle = sim.simulation
        .snapshotAll()
        .map((snapshot) => sim.simulation.shuttleById(snapshot.id)!)
        .find((candidate) => sim.simulation.availableSeats(candidate) > 0);
      assert.ok(shuttle, 'expected at least one shuttle with a free seat');
      return shuttle;
    };

    it('assigns the soonest shuttle with a seat free', () => {
      const assignment = sim.simulation.assignShuttle('five-points', 'aquarium');
      assert.ok(assignment, 'a lightly loaded network should always find a shuttle');
      assert.ok(sim.simulation.availableSeats(assignment.shuttle) > 0);
      const soonest = sim.simulation.arrivalsAtStop('five-points', 4)[0]!;
      assert.ok(assignment.pickupEtaSeconds >= soonest.etaSeconds - 1);
    });

    it('counts a held seat as taken', () => {
      const shuttle = shuttleWithRoom();
      const before = sim.simulation.availableSeats(shuttle);
      assert.ok(sim.simulation.holdSeat(shuttle.id));
      assert.equal(sim.simulation.availableSeats(shuttle), before - 1);
      sim.simulation.releaseSeat(shuttle.id);
      assert.equal(sim.simulation.availableSeats(shuttle), before);
    });

    it('refuses to hold a seat on a full shuttle', () => {
      const shuttle = shuttleWithRoom();
      while (sim.simulation.availableSeats(shuttle) > 0) {
        assert.ok(sim.simulation.holdSeat(shuttle.id));
      }
      assert.equal(sim.simulation.holdSeat(shuttle.id), false);
    });

    it('turns a held seat into a boarded rider without double counting', () => {
      const shuttle = shuttleWithRoom();
      const before = sim.simulation.availableSeats(shuttle);
      sim.simulation.holdSeat(shuttle.id);
      sim.simulation.boardRide(shuttle.id, 'ride_test');
      assert.equal(sim.simulation.availableSeats(shuttle), before - 1);
      assert.equal(shuttle.heldSeats, 0);
      sim.simulation.alightRide(shuttle.id, 'ride_test');
      assert.equal(sim.simulation.availableSeats(shuttle), before);
    });
  });

  it('reports a headway that shrinks as the fleet grows', () => {
    const small = makeSim({ fleetSize: 2 }).simulation.headwaySeconds();
    const large = makeSim({ fleetSize: 8 }).simulation.headwaySeconds();
    assert.ok(large < small);
  });

  it('is deterministic for a given seed', () => {
    const a = makeSim({ seed: 99 });
    const b = makeSim({ seed: 99 });
    a.advance(900, 30);
    b.advance(900, 30);
    assert.deepEqual(
      a.simulation.snapshotAll().map((s) => s.distanceMiles),
      b.simulation.snapshotAll().map((s) => s.distanceMiles),
    );
  });
});
