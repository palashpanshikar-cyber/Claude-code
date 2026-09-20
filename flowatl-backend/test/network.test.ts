import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CUMULATIVE_MILES,
  LOOP_MILES,
  SEGMENT_MILES,
  STOPS,
  STOP_COUNT,
  forwardMiles,
  isStopId,
  nextStopIndex,
  pointAtMiles,
  stopDistance,
  stopIndex,
  stopsBetween,
  tripMiles,
  wrapDistance,
} from '../src/domain/network.js';

describe('network geometry', () => {
  it('describes a closed loop of the six downtown stops', () => {
    assert.equal(STOP_COUNT, 6);
    assert.equal(SEGMENT_MILES.length, 6);
    assert.equal(CUMULATIVE_MILES.length, 7);
    assert.equal(CUMULATIVE_MILES[6], LOOP_MILES);
    assert.ok(LOOP_MILES > 3 && LOOP_MILES < 7, `loop should be a few miles, got ${LOOP_MILES}`);
  });

  it('keeps the stop order the client renders', () => {
    assert.deepEqual(
      STOPS.map((s) => s.id),
      ['five-points', 'centennial', 'aquarium', 'benz', 'state-farm', 'castleberry'],
    );
  });

  it('counts stops forward around the one-way loop', () => {
    assert.equal(stopsBetween('five-points', 'aquarium'), 2);
    // Going "backwards" means riding the rest of the loop.
    assert.equal(stopsBetween('aquarium', 'five-points'), 4);
    assert.equal(stopsBetween('five-points', 'five-points'), 0);
  });

  it('measures trips forward only', () => {
    const out = tripMiles('five-points', 'aquarium');
    const back = tripMiles('aquarium', 'five-points');
    assert.ok(out > 0 && back > 0);
    assert.ok(Math.abs(out + back - LOOP_MILES) < 1e-9, 'a there-and-back covers the whole loop');
  });

  it('places a distance of zero on the first stop', () => {
    const point = pointAtMiles(0);
    assert.equal(point.x, STOPS[0]!.x);
    assert.equal(point.y, STOPS[0]!.y);
  });

  it('lands exactly on each stop at its cumulative distance', () => {
    STOPS.forEach((stop, i) => {
      const point = pointAtMiles(stopDistance(i));
      assert.ok(Math.abs(point.x - stop.x) < 0.001, `${stop.id} x`);
      assert.ok(Math.abs(point.y - stop.y) < 0.001, `${stop.id} y`);
    });
  });

  it('wraps distances into the loop', () => {
    assert.ok(Math.abs(wrapDistance(LOOP_MILES) - 0) < 1e-9);
    assert.ok(Math.abs(wrapDistance(LOOP_MILES + 1) - 1) < 1e-9);
    assert.ok(Math.abs(wrapDistance(-1) - (LOOP_MILES - 1)) < 1e-9);
  });

  it('never reports a negative forward distance', () => {
    for (let i = 0; i < STOP_COUNT; i++) {
      for (let j = 0; j < STOP_COUNT; j++) {
        const miles = forwardMiles(stopDistance(i), stopDistance(j));
        assert.ok(miles >= 0 && miles < LOOP_MILES + 1e-9);
      }
    }
  });

  it('points a shuttle sitting on a stop at the next one', () => {
    STOPS.forEach((_, i) => {
      assert.equal(nextStopIndex(stopDistance(i)), (i + 1) % STOP_COUNT);
    });
    // Just before the loop closes, the next stop is the first one again.
    assert.equal(nextStopIndex(LOOP_MILES - 0.01), 0);
  });

  it('validates stop ids', () => {
    assert.ok(isStopId('five-points'));
    assert.ok(!isStopId('nowhere'));
    assert.throws(() => stopIndex('nowhere'), /Unknown stop/);
  });
});
