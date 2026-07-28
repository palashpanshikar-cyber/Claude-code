import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { liveStreak } from '../services/streak.js';
import { publicCompletion, publicUser } from '../lib/serialize.js';
import { assertCursorExists, toPage } from '../lib/pagination.js';

export const usersRouter = Router();

const gridSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

/**
 * Public profile: identity, streak, stats and the completion grid.
 *
 * Accepts either a user id or a username, because the client links to profiles
 * from both a completion (which carries the id) and an @mention (which doesn't).
 */
usersRouter.get('/:idOrUsername/profile', requireAuth, async (req, res, next) => {
  try {
    const key = req.params.idOrUsername;
    const q = gridSchema.parse(req.query);

    const user = await prisma.user.findFirst({
      where: { OR: [{ id: key }, { username: key.toLowerCase() }] },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const [rows, total, categories] = await Promise.all([
      prisma.completion.findMany({
        where: { userId: user.id },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { quest: true },
      }),
      prisma.completion.count({ where: { userId: user.id } }),
      prisma.completion.findMany({
        where: { userId: user.id },
        select: { quest: { select: { category: true } } },
        distinct: ['questId'],
      }),
    ]);

    const { items: page, nextCursor } = toPage(rows, q.limit);

    if (page.length === 0 && total > 0) {
      await assertCursorExists(
        q.cursor,
        async (id) => (await prisma.completion.count({ where: { id, userId: user.id } })) > 0,
      );
    }

    // A brand new user has no completions at all — every field below has to
    // hold up against empty, not 500.
    res.json({
      user: publicUser(user),
      streak: liveStreak(user),
      stats: {
        completions: total,
        categoriesExplored: new Set(categories.map((c) => c.quest.category)).size,
      },
      completions: await Promise.all(page.map((c) => publicCompletion(c))),
      nextCursor,
    });
  } catch (err) {
    next(err);
  }
});
