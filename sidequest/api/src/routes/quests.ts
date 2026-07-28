import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { submissionLimiter } from '../middleware/rateLimit.js';
import { publicQuest } from '../lib/serialize.js';
import { assertCursorExists, toPage } from '../lib/pagination.js';

export const questsRouter = Router();

export const CATEGORIES = [
  'ADVENTURE',
  'FOOD_DRINK',
  'CULTURE',
  'NATURE',
  'FITNESS',
  'CREATIVE',
] as const;

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
    const user = (req as AuthedRequest).user;
    const q = feedSchema.parse(req.query);
    const city = q.city ?? user.city ?? 'all';

    const where: Prisma.QuestWhereInput = {
      isActive: true,
      status: 'APPROVED',
      ...(q.category ? { category: q.category } : {}),
      // "Everywhere" quests (city: null) always show alongside local ones.
      ...(city === 'all' ? {} : { OR: [{ city }, { city: null }] }),
      ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.hideCompleted === 'true' ? { completions: { none: { userId: user.id } } } : {}),
    };

    const rows = await prisma.quest.findMany({
      where,
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { completions: { where: { userId: user.id }, select: { id: true } } },
    });

    const { items: page, nextCursor } = toPage(rows, q.limit);

    if (page.length === 0) {
      await assertCursorExists(
        q.cursor,
        async (id) => (await prisma.quest.count({ where: { id } })) > 0,
      );
    }

    res.json({
      quests: page.map((quest) => publicQuest(quest, { completed: quest.completions.length > 0 })),
      nextCursor,
      appliedCity: city,
    });
  } catch (err) {
    next(err);
  }
});

questsRouter.get('/categories', requireAuth, (_req, res) => {
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
    const user = (req as AuthedRequest).user;
    const quest = await prisma.quest.findUnique({
      where: { id: req.params.id },
      include: {
        completions: {
          where: { userId: user.id },
          select: { id: true, rating: true, createdAt: true },
        },
      },
    });

    // A pending submission stays visible to its author so they can see it is
    // in review, and to admins; to everyone else it does not exist yet.
    const visible =
      quest &&
      quest.isActive &&
      (quest.status === 'APPROVED' || quest.createdById === user.id || user.isAdmin);

    if (!quest || !visible) {
      res.status(404).json({ error: 'Quest not found' });
      return;
    }

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

const submitSchema = z.object({
  title: z.string().min(4).max(120),
  description: z.string().min(10).max(1000),
  category: z.enum(CATEGORIES),
  city: z.string().max(80).nullable().optional(),
  neighborhood: z.string().max(80).nullable().optional(),
  durationMin: z.coerce.number().int().min(5).max(600).default(30),
  difficulty: z.coerce.number().int().min(1).max(3).default(1),
});

/**
 * User-submitted quests. They land PENDING and stay out of the feed until an
 * admin approves — quest supply is the product, so it cannot be open season.
 */
questsRouter.post('/', requireAuth, submissionLimiter, async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const input = submitSchema.parse(req.body);

    const quest = await prisma.quest.create({
      data: {
        ...input,
        city: input.city ?? null,
        neighborhood: input.neighborhood ?? null,
        // An admin's own submission skips the queue; there is nobody else to review it.
        status: user.isAdmin ? 'APPROVED' : 'PENDING',
        createdById: user.id,
      },
    });

    res.status(201).json({ quest: publicQuest(quest) });
  } catch (err) {
    next(err);
  }
});

/** A user's own submissions, whatever their state. */
questsRouter.get('/mine/submissions', requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const quests = await prisma.quest.findMany({
      where: { createdById: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ quests: quests.map((q) => publicQuest(q)) });
  } catch (err) {
    next(err);
  }
});

const moderationQueueSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

questsRouter.get('/admin/queue', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const q = moderationQueueSchema.parse(req.query);
    const quests = await prisma.quest.findMany({
      where: { status: q.status },
      orderBy: { createdAt: 'asc' },
      take: q.limit,
      include: { createdBy: { select: { id: true, username: true } } },
    });

    res.json({
      quests: quests.map((quest) => ({
        ...publicQuest(quest),
        submittedBy: quest.createdBy,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const decisionSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']) });

questsRouter.patch('/:id/status', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { status } = decisionSchema.parse(req.body);
    const quest = await prisma.quest.findUnique({ where: { id: req.params.id } });

    if (!quest) {
      res.status(404).json({ error: 'Quest not found' });
      return;
    }

    const updated = await prisma.quest.update({ where: { id: quest.id }, data: { status } });
    res.json({ quest: publicQuest(updated) });
  } catch (err) {
    next(err);
  }
});
