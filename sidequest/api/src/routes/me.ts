import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isValidTimezone } from '../lib/day.js';
import { liveStreak } from '../services/streak.js';
import { publicCompletion, publicUser } from '../lib/serialize.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;

    const [completions, categories] = await Promise.all([
      prisma.completion.count({ where: { userId: user.id } }),
      prisma.completion.findMany({
        where: { userId: user.id },
        select: { quest: { select: { category: true } } },
        distinct: ['questId'],
      }),
    ]);

    res.json({
      user: publicUser(user),
      streak: liveStreak(user),
      stats: {
        completions,
        categoriesExplored: new Set(categories.map((c) => c.quest.category)).size,
      },
    });
  } catch (err) {
    next(err);
  }
});

const profileSchema = z.object({
  displayName: z.string().min(1).max(60).optional(),
  city: z.string().max(80).nullable().optional(),
  timezone: z.string().refine(isValidTimezone, 'Unknown IANA timezone').optional(),
});

meRouter.patch('/', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const input = profileSchema.parse(req.body);
    const updated = await prisma.user.update({ where: { id: user.id }, data: input });
    res.json({ user: publicUser(updated) });
  } catch (err) {
    next(err);
  }
});

const gridSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

meRouter.get('/completions', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const q = gridSchema.parse(req.query);

    const rows = await prisma.completion.findMany({
      where: { userId: user.id },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { quest: true },
    });

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;

    res.json({
      completions: await Promise.all(page.map(publicCompletion)),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
    });
  } catch (err) {
    next(err);
  }
});

meRouter.get('/streak', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const streak = liveStreak(user);

    // Last 30 local days of activity — drives the profile heatmap.
    const recent = await prisma.completion.findMany({
      where: { userId: user.id },
      select: { localDay: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const byDay = new Map<string, number>();
    for (const { localDay: day } of recent) {
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    res.json({
      ...streak,
      history: [...byDay.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, 30)
        .map(([day, count]) => ({ day, count })),
    });
  } catch (err) {
    next(err);
  }
});
