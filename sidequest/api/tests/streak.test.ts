import test from 'node:test';
import assert from 'node:assert/strict';
import { liveStreak } from '../src/services/streak.js';

const at = new Date('2026-03-10T12:00:00Z');
const base = { timezone: 'UTC', currentStreak: 7, longestStreak: 12 };

test('a completion today keeps the streak and flags activeToday', () => {
  const s = liveStreak({ ...base, lastActiveDay: '2026-03-10' }, at);
  assert.equal(s.current, 7);
  assert.equal(s.activeToday, true);
});

test('a completion yesterday keeps the streak alive but today is still open', () => {
  const s = liveStreak({ ...base, lastActiveDay: '2026-03-09' }, at);
  assert.equal(s.current, 7);
  assert.equal(s.activeToday, false);
});

test('a two-day gap reads as broken even before the sweep runs', () => {
  const s = liveStreak({ ...base, lastActiveDay: '2026-03-08' }, at);
  assert.equal(s.current, 0);
  assert.equal(s.longest, 12);
});

test('a brand new user has no streak', () => {
  const s = liveStreak({ ...base, currentStreak: 0, longestStreak: 0, lastActiveDay: null }, at);
  assert.equal(s.current, 0);
  assert.equal(s.activeToday, false);
});

test('the streak is judged in the user own timezone', () => {
  // 2026-03-10T12:00Z is already Mar 11 in Auckland, so a Mar 10 completion
  // is "yesterday" there — still alive — while for a UTC user it is today.
  const kiwi = liveStreak(
    { ...base, timezone: 'Pacific/Auckland', lastActiveDay: '2026-03-10' },
    at,
  );
  assert.equal(kiwi.today, '2026-03-11');
  assert.equal(kiwi.current, 7);
  assert.equal(kiwi.activeToday, false);
});
