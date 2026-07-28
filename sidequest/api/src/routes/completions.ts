import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { localDay } from '../lib/day.js';
import { ALLOWED_IMAGE_MIME, storePhoto } from '../lib/storage.js';
import { processImage } from '../lib/images.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import {
  liveStreak,
  milestoneReached,
  recomputeStreak,
  recordActivity,
} from '../services/streak.js';
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

/**
 * Logging a completion is idempotent.
 *
 * A phone on a patchy connection retries a request that already succeeded.
 * Answering "you have already completed this quest" for something that worked
 * is a bug from the user's side, so a repeat returns the completion that
 * exists, flagged with `duplicate`, rather than an error.
 */
completionsRouter.post(
  '/',
  requireAuth,
  uploadLimiter,
  upload.single('photo'),
  async (req, res, next) => {
    const user = (req as AuthedRequest).user;
    let questId: string | undefined;
    let uploadedKey: string | undefined;

    try {
      const input = bodySchema.parse(req.body);
      questId = input.questId;

      if (!req.file) {
        res.status(400).json({ error: 'A photo is required' });
        return;
      }

      const quest = await prisma.quest.findUnique({ where: { id: input.questId } });
      // A pending submission is visible to its author but must not be completable
      // — otherwise you could log a quest you invented and nobody approved.
      if (!quest || !quest.isActive || quest.status !== 'APPROVED') {
        res.status(404).json({ error: 'Quest not found' });
        return;
      }

      const existing = await prisma.completion.findUnique({
        where: { userId_questId: { userId: user.id, questId: quest.id } },
        include: { quest: true },
      });
      if (existing) {
        // Nothing was uploaded on this path — the check happens before storage.
        res.status(200).json({
          completion: await publicCompletion(existing),
          streak: liveStreak(user),
          milestone: null,
          duplicate: true,
        });
        return;
      }

      // Resize before upload — phone originals are 4-12MB and every profile grid
      // render would pay for that.
      const image = await processImage(req.file.buffer, req.file.mimetype, 'completion');

      // Upload before the transaction: a stray object in R2 is cheaper than a
      // transaction held open across a network call.
      uploadedKey = await storePhoto({
        buffer: image.buffer,
        mimetype: image.mimetype,
        userId: user.id,
      });

      const day = localDay(user.timezone);

      const { completion, streak } = await prisma.$transaction(async (tx) => {
        const completion = await tx.completion.create({
          data: {
            userId: user.id,
            questId: quest.id,
            photoKey: uploadedKey!,
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
      // Two requests racing past the check above: one wins the unique
      // constraint, the other lands here with its photo already uploaded.
      if ((err as { code?: string }).code === 'P2002' && questId) {
        try {
          const winner = await prisma.completion.findUniqueOrThrow({
            where: { userId_questId: { userId: user.id, questId } },
            include: { quest: true },
          });

          // The loser's upload is unreachable now — queue it rather than leak it.
          if (uploadedKey && uploadedKey !== winner.photoKey) {
            await prisma.orphanedObject.createMany({
              data: [{ objectKey: uploadedKey }],
              skipDuplicates: true,
            });
          }

          res.status(200).json({
            completion: await publicCompletion(winner),
            streak: liveStreak(user),
            milestone: null,
            duplicate: true,
          });
          return;
        } catch (lookupErr) {
          next(lookupErr);
          return;
        }
      }
      next(err);
    }
  },
);

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
      // The row is gone, so the object key would be unreachable — queue it for
      // the cleanup job rather than leaking the bytes.
      await tx.orphanedObject.createMany({
        data: [{ objectKey: completion.photoKey }],
        skipDuplicates: true,
      });
      // Removing a day's only activity can sever a run, so the streak is
      // rebuilt from history rather than decremented.
      return recomputeStreak(tx, user.id, user.timezone);
    });

    res.json({ deleted: completion.id, streak });
  } catch (err) {
    next(err);
  }
});
