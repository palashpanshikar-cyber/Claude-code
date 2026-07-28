export type Category =
  | 'ADVENTURE'
  | 'FOOD_DRINK'
  | 'CULTURE'
  | 'NATURE'
  | 'FITNESS'
  | 'CREATIVE';

export const CATEGORY_LABELS: Record<Category, string> = {
  ADVENTURE: 'Adventure',
  FOOD_DRINK: 'Food & Drink',
  CULTURE: 'Culture',
  NATURE: 'Nature',
  FITNESS: 'Fitness',
  CREATIVE: 'Creative',
};

export interface User {
  id: string;
  username: string;
  displayName: string;
  city: string | null;
  timezone: string;
  currentStreak: number;
  longestStreak: number;
  createdAt: string;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  category: Category;
  city: string | null;
  neighborhood: string | null;
  durationMin: number;
  difficulty: number;
  completed?: boolean;
}

export interface Completion {
  id: string;
  photoUrl: string;
  review: string | null;
  rating: number;
  localDay: string;
  createdAt: string;
  quest?: Quest;
}

export interface Streak {
  current: number;
  longest: number;
  activeToday: boolean;
  today: string;
  lastActiveDay: string | null;
}

export interface Mini {
  assignmentId: string;
  id: string;
  title: string;
  prompt: string;
  category: Category;
  localDay: string;
  completedAt: string | null;
  note: string | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface QuestFeed {
  quests: Quest[];
  nextCursor: string | null;
  appliedCity: string;
}

export interface CompletionResponse {
  completion: Completion;
  streak: { currentStreak: number; longestStreak: number; lastActiveDay: string } | Streak;
  milestone: number | null;
  duplicate?: boolean;
}
