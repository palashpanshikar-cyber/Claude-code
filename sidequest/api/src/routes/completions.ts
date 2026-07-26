import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { localDay } from '../lib/day.js';
import { ALLOWED_IMAGE_MIME, storePhoto } from '../lib/storage.js';
import { milestoneReached, recomputeStreak, recordActivity } from '../services/streak.js';
import { publicCompletion, publicUser } from '../lib/serialize.js';

export const completionsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
      cb(Object.assign(new Error('Photo must be JPEG, PNG, WebP or HEIC'), { status: 400 }));
      return;
    }
    cb(null, true);
  },
});

const bodySchema = z.object({
  questId: z.string().min(1),
  rating: z.coerce.number().int().min(1).max(5),
  review: z.string().max(1000).optional(),
});

completionsRouter.post('/', requireAuth, upload.single('photo'), async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const input = bodySchema.parse(req.body);

    if (!req.file) {
      res.status(400).json({ error: 'A photo is required' });
      return;
    }

    const quest = await prisma.quest.findUnique({ where: { id: input.questId } });
    if (!quest || !quest.isActive) {
      res.status(404).json({ error: 'Quest not found' });
      return;
    }

    const existing = await prisma.completion.findUnique({
      where: { userId_questId: { userId: user.id, questId: quest.id } },
    });
    if (existing) {
      res.status(409).json({ error: 'You have already completed this quest' });
      return;
    }

    // Upload before the transaction: a stray object in R2 is cheaper than a
    // transaction held open across a network call.
    const photoKey = await storePhoto({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      userId: user.id,
    });

    const day = localDay(user.timezone);

    const { completion, streak } = await prisma.$transaction(async (tx) => {
      const completion = await tx.completion.create({
        data: {
          userId: user.id,
          questId: quest.id,
          photoKey,
          rating: input.rating,
          review: input.review ?? null,
          localDay: day,
        },
        include: { quest: true },
      });
      const streak = await recordActivity(tx, user, day);
      return { completion, streak };
    });

    res.status(201).json({
      completion: await publicCompletion(completion),
      streak,
      milestone: milestoneReached(streak.currentStreak),
    });
  } catch (err) {
    // Two devices tapping "complete" at once lose the unique-constraint race.
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'You have already completed this quest' });
      return;
    }
    next(err);
  }
});

completionsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const completion = await prisma.completion.findUnique({
      where: { id: req.params.id },
      include: { quest: true, user: true },
    });

    if (!completion) {
      res.status(404).json({ error: 'Completion not found' });
      return;
    }

    // Readable by any signed-in user — completions are the public artifact the
    // profile grid and (in Phase 2) the friend feed are both built from.
    res.json({
      completion: await publicCompletion(completion),
      user: publicUser(completion.user),
    });
  } catch (err) {
    next(err);
  }
});

completionsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const completion = await prisma.completion.findUnique({ where: { id: req.params.id } });

    if (!completion || completion.userId !== user.id) {
      res.status(404).json({ error: 'Completion not found' });
      return;
    }

    const streak = await prisma.$transaction(async (tx) => {
      await tx.completion.delete({ where: { id: completion.id } });
      // Removing a day's only activity can sever a run, so the streak is
      // rebuilt from history rather than decremented.
      return recomputeStreak(tx, user.id, user.timezone);
    });

    // The stored object is deliberately left in place: it is cheap, and an
    // orphaned key is recoverable where a deleted photo is not.
    res.json({ deleted: completion.id, streak });
  } catch (err) {
    next(err);
  }
});
