import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { localDay, shiftDay } from '../lib/day.js';

export interface SweepResult {
  scanned: number;
  broken: number;
  durationMs: number;
}

/**
 * Zeroes streaks for users whose last active day is older than yesterday
 * *in their own timezone*, and records each break for analytics.
 *
 * The read path already reports the correct number (see liveStreak), so this
 * job is about keeping stored state honest for anything that queries the
 * column directly — leaderboards, reminder targeting, analytics.
 *
 * Runs hourly rather than nightly because "midnight" happens 24+ times a day
 * across timezones; an hourly pass catches each one within the hour.
 */
export async function sweepStreaks(now: Date = new Date()): Promise<SweepResult> {
  const startedAt = Date.now();

  const users = await prisma.user.findMany({
    where: { currentStreak: { gt: 0 } },
    select: { id: true, timezone: true, lastActiveDay: true, currentStreak: true },
  });

  const stale = users.filter((user) => {
    const yesterday = shiftDay(localDay(user.timezone, now), -1);
    return !user.lastActiveDay || user.lastActiveDay < yesterday;
  });

  if (stale.length > 0) {
    await prisma.$transaction([
      // Recorded before zeroing, so streakLength captures how far they got —
      // this is the drop-off data, and it is unrecoverable once overwritten.
      prisma.streakBreak.createMany({
        data: stale.map((u) => ({
          userId: u.id,
          streakLength: u.currentStreak,
          lastActiveDay: u.lastActiveDay,
          brokenAt: now,
        })),
      }),
      prisma.user.updateMany({
        where: { id: { in: stale.map((u) => u.id) } },
        data: { currentStreak: 0 },
      }),
    ]);
  }

  return { scanned: users.length, broken: stale.length, durationMs: Date.now() - startedAt };
}

export function startCron(): ScheduledTask {
  // Hourly, on the hour.
  return cron.schedule('0 * * * *', async () => {
    const startedAt = new Date();
    try {
      const result = await sweepStreaks(startedAt);
      // Logged on every run, not just when something breaks — a job that goes
      // silent is indistinguishable from a job that has nothing to do.
      console.log(
        JSON.stringify({
          job: 'sweepStreaks',
          status: 'ok',
          at: startedAt.toISOString(),
          ...result,
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          job: 'sweepStreaks',
          status: 'failed',
          at: startedAt.toISOString(),
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });
}
