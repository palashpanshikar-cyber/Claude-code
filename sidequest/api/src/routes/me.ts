import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { isValidTimezone } from '../lib/day.js';
import { liveStreak } from '../services/streak.js';
import { publicCompletion, publicUser, publicUserWithAvatar } from '../lib/serialize.js';
import { ALLOWED_IMAGE_MIME, photoUrlFor, storePhoto } from '../lib/storage.js';
import { processImage } from '../lib/images.js';
import { uploadLimiter } from '../middleware/rateLimit.js';

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

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
      cb(Object.assign(new Error('Avatar must be JPEG, PNG, WebP or HEIC'), { status: 400 }));
      return;
    }
    cb(null, true);
  },
});

meRouter.put('/avatar', uploadLimiter, avatarUpload.single('photo'), async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;

    if (!req.file) {
      res.status(400).json({ error: 'A photo is required' });
      return;
    }

    const image = await processImage(req.file.buffer, req.file.mimetype, 'avatar');
    const avatarKey = await storePhoto({
      buffer: image.buffer,
      mimetype: image.mimetype,
      userId: user.id,
      prefix: 'avatars',
    });

    // The previous avatar object is left in the bucket. Deleting it would race
    // with any client still rendering the old URL, and it costs almost nothing.
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarKey },
    });

    res.json({ user: await publicUserWithAvatar(updated) });
  } catch (err) {
    next(err);
  }
});

meRouter.delete('/avatar', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { avatarKey: null },
    });
    res.json({ user: await publicUserWithAvatar(updated) });
  } catch (err) {
    next(err);
  }
});

const deleteAccountSchema = z.object({
  // Re-authentication: a stolen token should not be enough to destroy an
  // account, and deletion is the one action here with no undo.
  password: z.string().min(1),
});

meRouter.delete('/', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const { password } = deleteAccountSchema.parse(req.body ?? {});

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: 'Password is incorrect' });
      return;
    }

    // Collect the object keys before the rows cascade away, or the bytes are
    // unreachable and leak forever.
    const photos = await prisma.completion.findMany({
      where: { userId: user.id },
      select: { photoKey: true },
    });
    const keys = [...photos.map((p) => p.photoKey), ...(user.avatarKey ? [user.avatarKey] : [])];

    await prisma.$transaction([
      prisma.orphanedObject.createMany({
        data: keys.map((objectKey) => ({ objectKey })),
        skipDuplicates: true,
      }),
      // Completions, mini assignments, streak breaks and follows all cascade.
      // Quests they submitted survive with createdById set to null — an approved
      // quest is content other people are mid-way through, not personal data.
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    // The bytes go on a queue rather than being deleted inline: the account
    // delete must succeed even if object storage is unreachable, or a user who
    // wants out cannot get out. See sweepOrphanedObjects.
    res.json({ deleted: true, objectsQueued: keys.length });
  } catch (err) {
    next(err);
  }
});

/**
 * Everything held about the caller, in one response.
 *
 * Deliberately built from the same rows the app reads rather than a curated
 * subset — an export that omits something is worse than none at all.
 */
meRouter.get('/export', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;

    const [completions, minis, breaks, submissions] = await Promise.all([
      prisma.completion.findMany({
        where: { userId: user.id },
        include: { quest: { select: { title: true, category: true, city: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.miniAssignment.findMany({
        where: { userId: user.id },
        include: { miniQuest: { select: { title: true, prompt: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.streakBreak.findMany({ where: { userId: user.id }, orderBy: { brokenAt: 'asc' } }),
      prisma.quest.findMany({
        where: { createdById: user.id },
        select: { id: true, title: true, description: true, status: true, createdAt: true },
      }),
    ]);

    res.setHeader('Content-Disposition', 'attachment; filename="sidequest-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        city: user.city,
        timezone: user.timezone,
        createdAt: user.createdAt,
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        lastActiveDay: user.lastActiveDay,
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
  } catch (err) {
    next(err);
  }
});
