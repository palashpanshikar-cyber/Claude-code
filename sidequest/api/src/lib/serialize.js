export function publicUser(user) {
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

export function publicQuest(quest, { completed } = {}) {
  return {
    id: quest.id,
    title: quest.title,
    description: quest.description,
    category: quest.category,
    city: quest.city,
    neighborhood: quest.neighborhood,
    durationMin: quest.durationMin,
    difficulty: quest.difficulty,
    ...(completed === undefined ? {} : { completed }),
  };
}

export function publicCompletion(completion) {
  return {
    id: completion.id,
    photoUrl: completion.photoUrl,
    review: completion.review,
    rating: completion.rating,
    localDay: completion.localDay,
    createdAt: completion.createdAt,
    quest: completion.quest ? publicQuest(completion.quest) : undefined,
  };
}

export function publicMini(assignment) {
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
