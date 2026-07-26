import type { User } from '@prisma/client';
import type { Tx } from '../lib/prisma.js';
import { daysBetween, localDay } from '../lib/day.js';

export interface StreakSummary {
  current: number;
  longest: number;
  activeToday: boolean;
  today: string;
  lastActiveDay: string | null;
}

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
export async function recordActivity(tx: Tx, user: User, day: string) {
  const last = user.lastActiveDay;

  let currentStreak: number;
  if (last === day) {
    currentStreak = Math.max(user.currentStreak, 1);
  } else if (last && daysBetween(last, day) === 1) {
    currentStreak = user.currentStreak + 1;
  } else {
    currentStreak = 1;
  }

  return tx.user.update({
    where: { id: user.id },
    data: {
      currentStreak,
      longestStreak: Math.max(user.longestStreak, currentStreak),
      lastActiveDay: day,
    },
    select: { currentStreak: true, longestStreak: true, lastActiveDay: true },
  });
}

/** Milestones worth celebrating. Rule-based on purpose — badges build on these. */
export const STREAK_MILESTONES = [7, 30, 100, 365] as const;

/**
 * The milestone this streak just crossed, if any.
 *
 * Only fires on the exact day the number is hit, so a client can celebrate once
 * rather than every day after.
 */
export function milestoneReached(streak: number): number | null {
  return STREAK_MILESTONES.find((m) => m === streak) ?? null;
}

/**
 * Rebuilds a user's streak from their actual activity history.
 *
 * The incremental path (recordActivity) can't handle deletion — removing a
 * completion may sever a run that the stored counter still believes in. Rather
 * than trying to patch the counter, this recomputes from the days that really
 * have activity, which is the only way to get it right.
 */
export async function recomputeStreak(tx: Tx, userId: string, timezone: string, at = new Date()) {
  const [completions, minis] = await Promise.all([
    tx.completion.findMany({
      where: { userId },
      select: { localDay: true },
      distinct: ['localDay'],
    }),
    tx.miniAssignment.findMany({
      where: { userId, completedAt: { not: null } },
      select: { localDay: true },
      distinct: ['localDay'],
    }),
  ]);

  const days = [...new Set([...completions, ...minis].map((r) => r.localDay))].sort();

  if (days.length === 0) {
    return tx.user.update({
      where: { id: userId },
      data: { currentStreak: 0, longestStreak: 0, lastActiveDay: null },
      select: { currentStreak: true, longestStreak: true, lastActiveDay: true },
    });
  }

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    run = daysBetween(days[i - 1]!, days[i]!) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  // `run` now holds the length of the run ending on the most recent active day.
  // That only counts as a live streak if it reaches today or yesterday.
  const lastActiveDay = days[days.length - 1]!;
  const gap = daysBetween(lastActiveDay, localDay(timezone, at));
  const current = gap <= 1 ? run : 0;

  return tx.user.update({
    where: { id: userId },
    data: { currentStreak: current, longestStreak: longest, lastActiveDay },
    select: { currentStreak: true, longestStreak: true, lastActiveDay: true },
  });
}

/**
 * The streak as the user should see it right now.
 *
 * The hourly sweep zeroes broken streaks, but a user who opens the app before
 * the sweep reaches their timezone must still see the truth, so the read path
 * recomputes rather than trusting the stored counter.
 */
export function liveStreak(
  user: Pick<User, 'timezone' | 'currentStreak' | 'longestStreak' | 'lastActiveDay'>,
  at: Date = new Date(),
): StreakSummary {
  const today = localDay(user.timezone, at);
  const last = user.lastActiveDay;

  if (!last) {
    return {
      current: 0,
      longest: user.longestStreak,
      activeToday: false,
      today,
      lastActiveDay: null,
    };
  }

  const gap = daysBetween(last, today);
  // gap 0 = already logged today, gap 1 = streak alive but today still open.
  return {
    current: gap <= 1 ? user.currentStreak : 0,
    longest: user.longestStreak,
    activeToday: gap === 0,
    today,
    lastActiveDay: last,
  };
}
