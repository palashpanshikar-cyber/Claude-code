import { dayIndex } from '../lib/day.js';

export const MINIS_PER_DAY = 4;

/**
 * Which mini slots surface on a given day.
 *
 * Deliberately a fixed rotation, not a recommender: with a 20-mini pool and 4
 * a day the cycle is 5 days long, which is enough for the feed to feel fresh
 * without any scoring machinery to build or debug.
 */
export function slotsForDay(day, poolSize) {
  const start = (dayIndex(day) * MINIS_PER_DAY) % poolSize;
  return Array.from({ length: MINIS_PER_DAY }, (_, i) => (start + i) % poolSize);
}

/**
 * Returns today's minis for a user, creating the assignment rows on first read.
 * Idempotent — opening the app twice on the same day yields the same four.
 */
export async function assignmentsForDay(prisma, userId, day) {
  const pool = await prisma.miniQuest.findMany({ orderBy: { slot: 'asc' } });
  if (pool.length === 0) return [];

  const slots = slotsForDay(day, pool.length);
  const chosen = slots.map((slot) => pool[slot]);

  await prisma.miniAssignment.createMany({
    data: chosen.map((mini) => ({ userId, miniQuestId: mini.id, localDay: day })),
    skipDuplicates: true,
  });

  return prisma.miniAssignment.findMany({
    where: { userId, localDay: day, miniQuestId: { in: chosen.map((m) => m.id) } },
    include: { miniQuest: true },
    orderBy: { miniQuest: { slot: 'asc' } },
  });
}
