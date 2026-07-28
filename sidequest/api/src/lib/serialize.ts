import type { Completion, MiniAssignment, MiniQuest, Quest, User } from '@prisma/client';
import { photoUrlFor } from './storage.js';

/**
 * The public shape of a user.
 *
 * Async because the avatar is stored as an object key and resolved to a URL on
 * read — a private bucket needs it presigned. There is deliberately only one
 * user serializer: when a second "with avatar" variant existed, most endpoints
 * used the plain one and profile photos silently never reached the client.
 */
export async function publicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    city: user.city,
    timezone: user.timezone,
    avatarUrl: user.avatarKey ? await photoUrlFor(user.avatarKey) : null,
    currentStreak: user.currentStreak,
    longestStreak: user.longestStreak,
    createdAt: user.createdAt,
  };
}

export interface QuestOptions {
  /** Present only when the caller has a relationship to the quest. */
  completed?: boolean;
  /**
   * Moderation fields. Off by default — `createdById` identifies whoever
   * submitted a quest, which is nobody else's business in the feed.
   */
  includeModeration?: boolean;
}

export function publicQuest(quest: Quest, opts: QuestOptions = {}) {
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
    ...(opts.includeModeration ? { status: quest.status, createdById: quest.createdById } : {}),
  };
}

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
