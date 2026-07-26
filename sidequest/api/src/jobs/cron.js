import cron from 'node-cron';
import { prisma } from '../lib/prisma.js';
import { localDay, shiftDay } from '../lib/day.js';

/**
 * Zeroes streaks for users whose last active day is older than yesterday
 * *in their own timezone*.
 *
 * The read path already reports the correct number (see liveStreak), so this
 * job is about keeping stored state honest for anything that queries the
 * column directly — leaderboards, reminder targeting, analytics.
 *
 * Runs hourly rather than nightly because "midnight" happens 24+ times a day
 * across timezones; an hourly pass catches each one within the hour.
 */
export async function sweepStreaks(now = new Date()) {
  const users = await prisma.user.findMany({
    where: { currentStreak: { gt: 0 } },
    select: { id: true, timezone: true, lastActiveDay: true },
  });

  const stale = users.filter((user) => {
    const today = localDay(user.timezone, now);
    const yesterday = shiftDay(today, -1);
    return !user.lastActiveDay || user.lastActiveDay < yesterday;
  });

  if (stale.length === 0) return { broken: 0 };

  await prisma.user.updateMany({
    where: { id: { in: stale.map((u) => u.id) } },
    data: { currentStreak: 0 },
  });

  return { broken: stale.length };
}

export function startCron() {
  // Hourly, on the hour.
  const task = cron.schedule('0 * * * *', async () => {
    try {
      const { broken } = await sweepStreaks();
      if (broken > 0) console.log(`[cron] broke ${broken} stale streak(s)`);
    } catch (err) {
      console.error('[cron] streak sweep failed', err);
    }
  });

  return task;
}
