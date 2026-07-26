import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { publicQuest } from '../lib/serialize.js';

export const questsRouter = Router();

export const CATEGORIES = ['ADVENTURE', 'FOOD_DRINK', 'CULTURE', 'NATURE', 'FITNESS', 'CREATIVE'];

const feedSchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  // Defaults to the user's own city; "all" opts out of the city filter entirely.
  city: z.string().max(80).optional(),
  search: z.string().max(80).optional(),
  hideCompleted: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

questsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = feedSchema.parse(req.query);
    const city = q.city ?? req.user.city ?? 'all';

    const where = {
      isActive: true,
      ...(q.category ? { category: q.category } : {}),
      // "Everywhere" quests (city: null) always show alongside local ones.
      ...(city === 'all' ? {} : { OR: [{ city }, { city: null }] }),
      ...(q.search
        ? { title: { contains: q.search, mode: 'insensitive' } }
        : {}),
      ...(q.hideCompleted === 'true' ? { completions: { none: { userId: req.user.id } } } : {}),
    };

    const rows = await prisma.quest.findMany({
      where,
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { completions: { where: { userId: req.user.id }, select: { id: true } } },
    });

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;

    res.json({
      quests: page.map((quest) => publicQuest(quest, { completed: quest.completions.length > 0 })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      appliedCity: city,
    });
  } catch (err) {
    next(err);
  }
});

questsRouter.get('/categories', requireAuth, (req, res) => {
  res.json({
    categories: [
      { key: 'ADVENTURE', label: 'Adventure' },
      { key: 'FOOD_DRINK', label: 'Food & Drink' },
      { key: 'CULTURE', label: 'Culture' },
      { key: 'NATURE', label: 'Nature' },
      { key: 'FITNESS', label: 'Fitness' },
      { key: 'CREATIVE', label: 'Creative' },
    ],
  });
});

questsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const quest = await prisma.quest.findUnique({
      where: { id: req.params.id },
      include: {
        completions: {
          where: { userId: req.user.id },
          select: { id: true, rating: true, createdAt: true },
        },
      },
    });

    if (!quest || !quest.isActive) return res.status(404).json({ error: 'Quest not found' });

    const stats = await prisma.completion.aggregate({
      where: { questId: quest.id },
      _count: { _all: true },
      _avg: { rating: true },
    });

    res.json({
      quest: publicQuest(quest, { completed: quest.completions.length > 0 }),
      myCompletion: quest.completions[0] ?? null,
      stats: {
        completions: stats._count._all,
        avgRating: stats._avg.rating === null ? null : Number(stats._avg.rating.toFixed(2)),
      },
    });
  } catch (err) {
    next(err);
  }
});
