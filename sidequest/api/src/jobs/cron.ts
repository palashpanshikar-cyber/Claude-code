import cron, { type ScheduledTask } from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { localDay, shiftDay } from '../lib/day.js';
import { deleteObject } from '../lib/storage.js';

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
      const [streaks, objects] = await Promise.all([
        sweepStreaks(startedAt),
        sweepOrphanedObjects(),
      ]);
      const result = { ...streaks, objectsDeleted: objects.deleted, objectsFailed: objects.failed };
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

/** How many failed attempts before an object is left alone for manual review. */
const MAX_CLEANUP_ATTEMPTS = 5;

/**
 * Deletes stored objects whose owning row is gone.
 *
 * Runs separately from the request that orphaned them so that account deletion
 * never depends on object storage being reachable. Failures are counted rather
 * than retried forever — a key that will not delete after five passes is a
 * bug to look at, not something to hammer every hour.
 */
export async function sweepOrphanedObjects(limit = 200): Promise<{
  deleted: number;
  failed: number;
}> {
  const pending = await prisma.orphanedObject.findMany({
    where: { attempts: { lt: MAX_CLEANUP_ATTEMPTS } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  let deleted = 0;
  let failed = 0;

  for (const object of pending) {
    try {
      await deleteObject(object.objectKey);
      await prisma.orphanedObject.delete({ where: { id: object.id } });
      deleted += 1;
    } catch {
      await prisma.orphanedObject.update({
        where: { id: object.id },
        data: { attempts: { increment: 1 } },
      });
      failed += 1;
    }
  }

  return { deleted, failed };
}
