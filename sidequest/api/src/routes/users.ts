import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { authed, notFoundError } from '../lib/http.js';
import { assertCursorExists, cursorArgs, pageQuerySchema, toPage } from '../lib/pagination.js';
import { liveStreak } from '../services/streak.js';
import { profileStats } from '../services/profile.js';
import { publicCompletion, publicUser } from '../lib/serialize.js';

export const usersRouter = Router();

/**
 * Public profile: identity, streak, stats and the completion grid.
 *
 * Accepts either a user id or a username, because the client links to profiles
 * from a completion (which carries the id) and from an @mention (which
 * doesn't). Usernames are capped at 24 characters and cuids are 25, so the two
 * key spaces cannot collide.
 */
usersRouter.get(
  '/:idOrUsername/profile',
  requireAuth,
  authed(async (req, res) => {
    const key = req.params.idOrUsername!;
    const query = pageQuerySchema.parse(req.query);

    const user = await prisma.user.findFirst({
      where: { OR: [{ id: key }, { username: key.toLowerCase() }] },
    });

    if (!user) throw notFoundError('User not found');

    const [rows, stats] = await Promise.all([
      prisma.completion.findMany({
        where: { userId: user.id },
        ...cursorArgs(query),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { quest: true },
      }),
      profileStats(prisma, user.id),
    ]);

    const { items, nextCursor } = toPage(rows, query.limit);

    // Only worth checking when the profile has completions — an empty page on a
    // brand new account is the truth, not a bad cursor.
    if (items.length === 0 && stats.completions > 0) {
      await assertCursorExists(
        query.cursor,
        async (id) => (await prisma.completion.count({ where: { id, userId: user.id } })) > 0,
      );
    }

    res.json({
      user: await publicUser(user),
      streak: liveStreak(user),
      stats,
      completions: await Promise.all(items.map((c) => publicCompletion(c))),
      nextCursor,
    });
  }),
);
