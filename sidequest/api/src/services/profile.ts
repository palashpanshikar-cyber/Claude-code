import type { PrismaClient, User } from '@prisma/client';
import { liveStreak, type StreakSummary } from './streak.js';

export interface ProfileStats {
  completions: number;
  categoriesExplored: number;
}

/**
 * The numbers shown on a profile.
 *
 * Shared because /me and /users/:id/profile must agree — when this was
 * duplicated, a change to one silently made the two disagree about the same
 * user.
 */
export async function profileStats(prisma: PrismaClient, userId: string): Promise<ProfileStats> {
  const [completions, categories] = await Promise.all([
    prisma.completion.count({ where: { userId } }),
    prisma.completion.findMany({
      where: { userId },
      select: { quest: { select: { category: true } } },
      distinct: ['questId'],
    }),
  ]);

  return {
    completions,
    categoriesExplored: new Set(categories.map((c) => c.quest.category)).size,
  };
}

export function profileSummary(user: User): { streak: StreakSummary } {
  return { streak: liveStreak(user) };
}
