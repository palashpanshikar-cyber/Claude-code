import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { imageUpload } from '../middleware/upload.js';
import { isValidTimezone } from '../lib/day.js';
import { authed, badRequest } from '../lib/http.js';
import { assertCursorExists, cursorArgs, pageQuerySchema, toPage } from '../lib/pagination.js';
import { liveStreak } from '../services/streak.js';
import { profileStats } from '../services/profile.js';
import { publicCompletion, publicUser } from '../lib/serialize.js';
import { photoUrlFor, storePhoto } from '../lib/storage.js';
import { processImage } from '../lib/images.js';
import { uploadLimiter } from '../middleware/rateLimit.js';

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get(
  '/',
  authed(async (req, res) => {
    res.json({
      user: await publicUser(req.user),
      streak: liveStreak(req.user),
      stats: await profileStats(prisma, req.user.id),
    });
  }),
);

const profileSchema = z
  .object({
    displayName: z.string().min(1).max(60).optional(),
    city: z.string().max(80).nullable().optional(),
    timezone: z.string().refine(isValidTimezone, 'Unknown IANA timezone').optional(),
  })
  .refine((input) => Object.keys(input).length > 0, 'Nothing to update');

meRouter.patch(
  '/',
  authed(async (req, res) => {
    const input = profileSchema.parse(req.body);
    const updated = await prisma.user.update({ where: { id: req.user.id }, data: input });
    res.json({ user: await publicUser(updated) });
  }),
);

meRouter.get(
  '/completions',
  authed(async (req, res) => {
    const query = pageQuerySchema.parse(req.query);

    const rows = await prisma.completion.findMany({
      where: { userId: req.user.id },
      ...cursorArgs(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { quest: true },
    });

    const { items, nextCursor } = toPage(rows, query.limit);

    if (items.length === 0) {
      await assertCursorExists(
        query.cursor,
        async (id) => (await prisma.completion.count({ where: { id, userId: req.user.id } })) > 0,
      );
    }

    res.json({
      completions: await Promise.all(items.map((c) => publicCompletion(c))),
      nextCursor,
    });
  }),
);

/** How many days of activity the profile heatmap shows. */
const HISTORY_DAYS = 30;

meRouter.get(
  '/streak',
  authed(async (req, res) => {
    // Grouped in the database rather than in memory: pulling the most recent N
    // rows and counting them here gets the wrong answer for anyone who logs
    // more than N completions inside the window.
    const grouped = await prisma.completion.groupBy({
      by: ['localDay'],
      where: { userId: req.user.id },
      _count: { _all: true },
      orderBy: { localDay: 'desc' },
      take: HISTORY_DAYS,
    });

    res.json({
      ...liveStreak(req.user),
      history: grouped.map((row) => ({ day: row.localDay, count: row._count._all })),
    });
  }),
);

meRouter.put(
  '/avatar',
  uploadLimiter,
  imageUpload(),
  authed(async (req, res) => {
    if (!req.file) throw badRequest('A photo is required');

    const image = await processImage(req.file.buffer, req.file.mimetype, 'avatar');
    const avatarKey = await storePhoto({
      buffer: image.buffer,
      mimetype: image.mimetype,
      userId: req.user.id,
      prefix: 'avatars',
    });

    const previousKey = req.user.avatarKey;

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: req.user.id },
        data: { avatarKey },
      });
      // The replaced avatar is unreachable once the row points elsewhere, so it
      // goes on the cleanup queue rather than lingering in the bucket forever.
      if (previousKey) {
        await tx.orphanedObject.createMany({
          data: [{ objectKey: previousKey }],
          skipDuplicates: true,
        });
      }
      return updated;
    });

    res.json({ user: await publicUser(updated) });
  }),
);

meRouter.delete(
  '/avatar',
  authed(async (req, res) => {
    const previousKey = req.user.avatarKey;

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: req.user.id },
        data: { avatarKey: null },
      });
      if (previousKey) {
        await tx.orphanedObject.createMany({
          data: [{ objectKey: previousKey }],
          skipDuplicates: true,
        });
      }
      return updated;
    });

    res.json({ user: await publicUser(updated) });
  }),
);

const deleteAccountSchema = z.object({
  // Re-authentication: a stolen token should not be enough to destroy an
  // account, and deletion is the one action here with no undo.
  password: z.string().min(1),
});

meRouter.delete(
  '/',
  authed(async (req, res) => {
    const { password } = deleteAccountSchema.parse(req.body ?? {});

    if (!(await bcrypt.compare(password, req.user.passwordHash))) {
      res.status(401).json({ error: 'Password is incorrect' });
      return;
    }

    // Collect the object keys before the rows cascade away, or the bytes are
    // unreachable and leak forever.
    const photos = await prisma.completion.findMany({
      where: { userId: req.user.id },
      select: { photoKey: true },
    });
    const keys = [
      ...photos.map((p) => p.photoKey),
      ...(req.user.avatarKey ? [req.user.avatarKey] : []),
    ];

    await prisma.$transaction([
      prisma.orphanedObject.createMany({
        data: keys.map((objectKey) => ({ objectKey })),
        skipDuplicates: true,
      }),
      // Completions, mini assignments, streak breaks and follows all cascade.
      // Quests they submitted survive with createdById set to null — an approved
      // quest is content other people are mid-way through, not personal data.
      prisma.user.delete({ where: { id: req.user.id } }),
    ]);

    // The bytes go on a queue rather than being deleted inline: the account
    // delete must succeed even if object storage is unreachable, or a user who
    // wants out cannot get out. See sweepOrphanedObjects.
    res.json({ deleted: true, objectsQueued: keys.length });
  }),
);

/**
 * Everything held about the caller, in one response.
 *
 * Deliberately built from the same rows the app reads rather than a curated
 * subset — an export that omits something is worse than none at all.
 */
meRouter.get(
  '/export',
  authed(async (req, res) => {
    const [completions, minis, breaks, submissions] = await Promise.all([
      prisma.completion.findMany({
        where: { userId: req.user.id },
        include: { quest: { select: { title: true, category: true, city: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.miniAssignment.findMany({
        where: { userId: req.user.id },
        include: { miniQuest: { select: { title: true, prompt: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.streakBreak.findMany({ where: { userId: req.user.id }, orderBy: { brokenAt: 'asc' } }),
      prisma.quest.findMany({
        where: { createdById: req.user.id },
        select: { id: true, title: true, description: true, status: true, createdAt: true },
      }),
    ]);

    res.setHeader('Content-Disposition', 'attachment; filename="sidequest-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      account: {
        id: req.user.id,
        email: req.user.email,
        username: req.user.username,
        displayName: req.user.displayName,
        city: req.user.city,
        timezone: req.user.timezone,
        createdAt: req.user.createdAt,
        currentStreak: req.user.currentStreak,
        longestStreak: req.user.longestStreak,
        lastActiveDay: req.user.lastActiveDay,
      },
      completions: await Promise.all(
        completions.map(async (c) => ({
          questTitle: c.quest.title,
          category: c.quest.category,
          city: c.quest.city,
          rating: c.rating,
          review: c.review,
          localDay: c.localDay,
          completedAt: c.createdAt,
          photoUrl: await photoUrlFor(c.photoKey),
        })),
      ),
      dailyMinis: minis.map((m) => ({
        title: m.miniQuest.title,
        prompt: m.miniQuest.prompt,
        day: m.localDay,
        completedAt: m.completedAt,
        note: m.note,
      })),
      streakBreaks: breaks.map((b) => ({
        streakLength: b.streakLength,
        lastActiveDay: b.lastActiveDay,
        brokenAt: b.brokenAt,
      })),
      submittedQuests: submissions,
    });
  }),
);
