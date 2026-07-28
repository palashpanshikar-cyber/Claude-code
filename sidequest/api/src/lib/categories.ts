import type { Category } from '@prisma/client';

/**
 * The single source of truth for categories.
 *
 * Prisma generates the enum, but zod needs a runtime tuple and the client needs
 * display labels — previously each route redeclared its own copy, which is how
 * they drift apart.
 */
export const CATEGORIES = [
  'ADVENTURE',
  'FOOD_DRINK',
  'CULTURE',
  'NATURE',
  'FITNESS',
  'CREATIVE',
] as const satisfies readonly Category[];

export const CATEGORY_LABELS: Record<Category, string> = {
  ADVENTURE: 'Adventure',
  FOOD_DRINK: 'Food & Drink',
  CULTURE: 'Culture',
  NATURE: 'Nature',
  FITNESS: 'Fitness',
  CREATIVE: 'Creative',
};

export const categoryOptions = CATEGORIES.map((key) => ({ key, label: CATEGORY_LABELS[key] }));
