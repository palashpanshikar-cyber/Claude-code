import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { localDay } from '../lib/day.js';
import { ALLOWED_IMAGE_MIME, storePhoto } from '../lib/storage.js';
import { recordActivity } from '../services/streak.js';
import { publicCompletion } from '../lib/serialize.js';

export const completionsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_MIME.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Photo must be JPEG, PNG, WebP or HEIC'), { status: 400 }));
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
    const input = bodySchema.parse(req.body);

    if (!req.file) return res.status(400).json({ error: 'A photo is required' });

    const quest = await prisma.quest.findUnique({ where: { id: input.questId } });
    if (!quest || !quest.isActive) return res.status(404).json({ error: 'Quest not found' });

    const existing = await prisma.completion.findUnique({
      where: { userId_questId: { userId: req.user.id, questId: quest.id } },
    });
    if (existing) return res.status(409).json({ error: 'You have already completed this quest' });

    // Upload before the transaction: a stray object in R2 is cheaper than a
    // transaction held open across a network call.
    const photoUrl = await storePhoto({
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      userId: req.user.id,
    });

    const day = localDay(req.user.timezone);

    const { completion, streak } = await prisma.$transaction(async (tx) => {
      const completion = await tx.completion.create({
        data: {
          userId: req.user.id,
          questId: quest.id,
          photoUrl,
          rating: input.rating,
          review: input.review ?? null,
          localDay: day,
        },
        include: { quest: true },
      });
      const streak = await recordActivity(tx, req.user, day);
      return { completion, streak };
    });

    res.status(201).json({ completion: publicCompletion(completion), streak });
  } catch (err) {
    // Two devices tapping "complete" at once lose the unique-constraint race.
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'You have already completed this quest' });
    }
    next(err);
  }
});
