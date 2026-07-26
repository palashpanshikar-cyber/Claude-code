import { daysBetween, localDay } from '../lib/day.js';

/**
 * Records activity for a user's local day and returns the updated streak fields.
 *
 * Rules:
 *  - Same day again        → no change (one quest a day is enough, more is fine)
 *  - Yesterday → today     → +1
 *  - Any longer gap        → reset to 1
 *
 * Runs inside the caller's transaction so a completion and its streak bump
 * can never diverge.
 */
export async function recordActivity(tx, user, day) {
  const last = user.lastActiveDay;

  let currentStreak;
  if (last === day) {
    currentStreak = Math.max(user.currentStreak, 1);
  } else if (last && daysBetween(last, day) === 1) {
    currentStreak = user.currentStreak + 1;
  } else {
    currentStreak = 1;
  }

  const longestStreak = Math.max(user.longestStreak, currentStreak);

  return tx.user.update({
    where: { id: user.id },
    data: { currentStreak, longestStreak, lastActiveDay: day },
    select: { currentStreak: true, longestStreak: true, lastActiveDay: true },
  });
}

/**
 * The streak as the user should see it right now.
 *
 * The nightly sweep zeroes broken streaks, but a user who opens the app before
 * the sweep reaches their timezone must still see the truth, so the read path
 * recomputes rather than trusting the stored counter.
 */
export function liveStreak(user, at = new Date()) {
  const today = localDay(user.timezone, at);
  const last = user.lastActiveDay;

  if (!last) {
    return { current: 0, longest: user.longestStreak, activeToday: false, today, lastActiveDay: null };
  }

  const gap = daysBetween(last, today);
  // gap 0 = already logged today, gap 1 = streak alive but today still open.
  const current = gap <= 1 ? user.currentStreak : 0;

  return {
    current,
    longest: user.longestStreak,
    activeToday: gap === 0,
    today,
    lastActiveDay: last,
  };
}
