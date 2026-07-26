import test from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, dayIndex, localDay, shiftDay, isValidTimezone } from '../src/lib/day.js';
import { slotsForDay, MINIS_PER_DAY } from '../src/services/minis.js';

test('localDay respects the user timezone', () => {
  // 2026-03-01T23:30Z is still Mar 1 in London but already Mar 2 in Auckland.
  const at = new Date('2026-03-01T23:30:00Z');
  assert.equal(localDay('UTC', at), '2026-03-01');
  assert.equal(localDay('Pacific/Auckland', at), '2026-03-02');
  assert.equal(localDay('America/Los_Angeles', at), '2026-03-01');
});

test('localDay rolls the day backwards for negative offsets', () => {
  const at = new Date('2026-03-02T04:00:00Z');
  assert.equal(localDay('UTC', at), '2026-03-02');
  assert.equal(localDay('America/New_York', at), '2026-03-01');
});

test('shiftDay crosses month and year boundaries', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2024-03-01', -1), '2024-02-29'); // leap year
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween('2026-03-01', '2026-03-02'), 1);
  assert.equal(daysBetween('2026-03-01', '2026-03-01'), 0);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(daysBetween('2026-03-05', '2026-03-01'), -4);
});

test('daysBetween is unaffected by DST transitions', () => {
  // US DST springs forward on 2026-03-08; the calendar gap is still 1 day.
  assert.equal(daysBetween('2026-03-07', '2026-03-08'), 1);
  assert.equal(daysBetween('2026-11-01', '2026-11-02'), 1);
});

test('dayIndex advances by one per day', () => {
  assert.equal(dayIndex('1970-01-01'), 0);
  assert.equal(dayIndex('1970-01-02'), 1);
  assert.equal(dayIndex('2026-03-02') - dayIndex('2026-03-01'), 1);
});

test('isValidTimezone rejects nonsense', () => {
  assert.equal(isValidTimezone('America/New_York'), true);
  assert.equal(isValidTimezone('Not/AZone'), false);
});

test('mini rotation gives four distinct slots that cycle the pool', () => {
  const slots = slotsForDay('2026-03-01', 20);
  assert.equal(slots.length, MINIS_PER_DAY);
  assert.equal(new Set(slots).size, MINIS_PER_DAY);

  // Five consecutive days cover all 20 slots exactly once.
  const seen = new Set();
  for (let i = 0; i < 5; i += 1) {
    for (const slot of slotsForDay(shiftDay('2026-03-01', i), 20)) seen.add(slot);
  }
  assert.equal(seen.size, 20);
});

test('mini rotation is stable for the same day', () => {
  assert.deepEqual(slotsForDay('2026-03-01', 20), slotsForDay('2026-03-01', 20));
});

test('mini rotation handles a pool smaller than a day', () => {
  const slots = slotsForDay('2026-03-01', 3);
  assert.equal(slots.length, MINIS_PER_DAY);
  for (const slot of slots) assert.ok(slot >= 0 && slot < 3);
});

test('consecutive days never serve the same four minis', () => {
  for (let i = 0; i < 30; i += 1) {
    const day = shiftDay('2026-03-01', i);
    const today = slotsForDay(day, 20);
    const tomorrow = slotsForDay(shiftDay(day, 1), 20);
    const shared = today.filter((s) => tomorrow.includes(s));
    assert.equal(shared.length, 0, `day ${day} repeats slots into the next day`);
  }
});
