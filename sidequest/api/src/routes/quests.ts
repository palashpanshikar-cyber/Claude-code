import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { submissionLimiter } from '../middleware/rateLimit.js';
import { authed, notFoundError } from '../lib/http.js';
import { assertCursorExists, cursorArgs, pageQuerySchema, toPage } from '../lib/pagination.js';
import { CATEGORIES, categoryOptions } from '../lib/categories.js';
import { publicQuest } from '../lib/serialize.js';

export const questsRouter = Router();

const feedSchema = pageQuerySchema.extend({
  category: z.enum(CATEGORIES).optional(),
  // Defaults to the user's own city; "all" opts out of the city filter entirely.
  city: z.string().max(80).optional(),
  search: z.string().max(80).optional(),
  hideCompleted: z.enum(['true', 'false']).optional(),
});

questsRouter.get(
  '/',
  requireAuth,
  authed(async (req, res) => {
    const query = feedSchema.parse(req.query);
    const city = query.city ?? req.user.city ?? 'all';

    const where: Prisma.QuestWhereInput = {
      isActive: true,
      status: 'APPROVED',
      ...(query.category ? { category: query.category } : {}),
      // "Everywhere" quests (city: null) always show alongside local ones.
      ...(city === 'all' ? {} : { OR: [{ city }, { city: null }] }),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.hideCompleted === 'true' ? { completions: { none: { userId: req.user.id } } } : {}),
    };

    const rows = await prisma.quest.findMany({
      where,
      ...cursorArgs(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { completions: { where: { userId: req.user.id }, select: { id: true } } },
    });

    const { items, nextCursor } = toPage(rows, query.limit);

    if (items.length === 0) {
      await assertCursorExists(
        query.cursor,
        async (id) => (await prisma.quest.count({ where: { id } })) > 0,
      );
    }

    res.json({
      quests: items.map((quest) => publicQuest(quest, { completed: quest.completions.length > 0 })),
      nextCursor,
      appliedCity: city,
    });
  }),
);

questsRouter.get('/categories', requireAuth, (_req, res) => {
  res.json({ categories: categoryOptions });
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
questsRouter.post(
  '/',
  requireAuth,
  submissionLimiter,
  authed(async (req, res) => {
    const input = submitSchema.parse(req.body);

    const quest = await prisma.quest.create({
      data: {
        ...input,
        city: input.city ?? null,
        neighborhood: input.neighborhood ?? null,
        // An admin's own submission skips the queue; there is nobody else to review it.
        status: req.user.isAdmin ? 'APPROVED' : 'PENDING',
        createdById: req.user.id,
      },
    });

    res.status(201).json({ quest: publicQuest(quest, { includeModeration: true }) });
  }),
);

/** A user's own submissions, whatever their state. */
questsRouter.get(
  '/mine/submissions',
  requireAuth,
  authed(async (req, res) => {
    const quests = await prisma.quest.findMany({
      where: { createdById: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ quests: quests.map((q) => publicQuest(q, { includeModeration: true })) });
  }),
);

const moderationQueueSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

questsRouter.get(
  '/admin/queue',
  requireAuth,
  requireAdmin,
  authed(async (req, res) => {
    const query = moderationQueueSchema.parse(req.query);

    const quests = await prisma.quest.findMany({
      where: { status: query.status },
      orderBy: { createdAt: 'asc' },
      take: query.limit,
      include: { createdBy: { select: { id: true, username: true } } },
    });

    res.json({
      quests: quests.map((quest) => ({
        ...publicQuest(quest, { includeModeration: true }),
        submittedBy: quest.createdBy,
      })),
    });
  }),
);

const decisionSchema = z.object({ status: z.enum(['APPROVED', 'REJECTED']) });

questsRouter.patch(
  '/:id/status',
  requireAuth,
  requireAdmin,
  authed(async (req, res) => {
    const { status } = decisionSchema.parse(req.body);
    const quest = await prisma.quest.findUnique({ where: { id: req.params.id } });

    if (!quest) throw notFoundError('Quest not found');

    const updated = await prisma.quest.update({ where: { id: quest.id }, data: { status } });
    res.json({ quest: publicQuest(updated, { includeModeration: true }) });
  }),
);

/**
 * Quest detail.
 *
 * Declared after the literal-segment routes above so that /quests/categories
 * and /quests/admin/... are never swallowed by :id.
 */
questsRouter.get(
  '/:id',
  requireAuth,
  authed(async (req, res) => {
    const quest = await prisma.quest.findUnique({
      where: { id: req.params.id },
      include: {
        completions: {
          where: { userId: req.user.id },
          select: { id: true, rating: true, createdAt: true },
        },
      },
    });

    // A pending submission stays visible to its author so they can see it is
    // in review, and to admins; to everyone else it does not exist yet.
    const visible =
      quest?.isActive &&
      (quest.status === 'APPROVED' || quest.createdById === req.user.id || req.user.isAdmin);

    if (!quest || !visible) throw notFoundError('Quest not found');

    const stats = await prisma.completion.aggregate({
      where: { questId: quest.id },
      _count: { _all: true },
      _avg: { rating: true },
    });

    const isOwnOrAdmin = quest.createdById === req.user.id || req.user.isAdmin;

    res.json({
      quest: publicQuest(quest, {
        completed: quest.completions.length > 0,
        includeModeration: isOwnOrAdmin,
      }),
      myCompletion: quest.completions[0] ?? null,
      stats: {
        completions: stats._count._all,
        avgRating: stats._avg.rating === null ? null : Number(stats._avg.rating.toFixed(2)),
      },
    });
  }),
);
