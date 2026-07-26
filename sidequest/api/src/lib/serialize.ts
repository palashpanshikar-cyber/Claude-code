import type { Completion, MiniAssignment, MiniQuest, Quest, User } from '@prisma/client';
import { photoUrlFor } from './storage.js';

export function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    city: user.city,
    timezone: user.timezone,
    currentStreak: user.currentStreak,
    longestStreak: user.longestStreak,
    createdAt: user.createdAt,
  };
}

export function publicQuest(quest: Quest, opts: { completed?: boolean } = {}) {
  return {
    id: quest.id,
    title: quest.title,
    description: quest.description,
    category: quest.category,
    city: quest.city,
    neighborhood: quest.neighborhood,
    durationMin: quest.durationMin,
    difficulty: quest.difficulty,
    ...(opts.completed === undefined ? {} : { completed: opts.completed }),
  };
}

/** Async because a private R2 bucket needs the photo URL presigned per read. */
export async function publicCompletion(completion: Completion & { quest?: Quest }) {
  return {
    id: completion.id,
    photoUrl: await photoUrlFor(completion.photoKey),
    review: completion.review,
    rating: completion.rating,
    localDay: completion.localDay,
    createdAt: completion.createdAt,
    quest: completion.quest ? publicQuest(completion.quest) : undefined,
  };
}

export function publicMini(assignment: MiniAssignment & { miniQuest: MiniQuest }) {
  return {
    assignmentId: assignment.id,
    id: assignment.miniQuest.id,
    title: assignment.miniQuest.title,
    prompt: assignment.miniQuest.prompt,
    category: assignment.miniQuest.category,
    localDay: assignment.localDay,
    completedAt: assignment.completedAt,
    note: assignment.note,
  };
}
