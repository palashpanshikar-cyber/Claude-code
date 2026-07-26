import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { localDay } from '../lib/day.js';
import { assignmentsForDay } from '../services/minis.js';
import { recordActivity } from '../services/streak.js';
import { publicMini } from '../lib/serialize.js';

export const minisRouter = Router();

minisRouter.use(requireAuth);

minisRouter.get('/today', async (req, res, next) => {
  try {
    const day = localDay(req.user.timezone);
    const assignments = await assignmentsForDay(prisma, req.user.id, day);
    res.json({
      day,
      minis: assignments.map(publicMini),
      completed: assignments.filter((a) => a.completedAt).length,
    });
  } catch (err) {
    next(err);
  }
});

const completeSchema = z.object({ note: z.string().max(500).optional() });

minisRouter.post('/:assignmentId/complete', async (req, res, next) => {
  try {
    const { note } = completeSchema.parse(req.body ?? {});

    const assignment = await prisma.miniAssignment.findUnique({
      where: { id: req.params.assignmentId },
      include: { miniQuest: true },
    });

    if (!assignment || assignment.userId !== req.user.id) {
      return res.status(404).json({ error: 'Mini quest not found' });
    }
    if (assignment.completedAt) {
      return res.status(409).json({ error: 'Mini quest already completed' });
    }

    const today = localDay(req.user.timezone);
    // Yesterday's leftover minis stay visible in the client's cache; completing
    // them must not backfill a streak day that was actually missed.
    if (assignment.localDay !== today) {
      return res.status(410).json({ error: 'That mini quest expired — pull today\'s minis' });
    }

    const { updated, streak } = await prisma.$transaction(async (tx) => {
      const updated = await tx.miniAssignment.update({
        where: { id: assignment.id },
        data: { completedAt: new Date(), note: note ?? null },
        include: { miniQuest: true },
      });
      // Minis count toward the streak — they exist so a busy day still has a
      // reachable way to keep it alive.
      const streak = await recordActivity(tx, req.user, today);
      return { updated, streak };
    });

    res.json({ mini: publicMini(updated), streak });
  } catch (err) {
    next(err);
  }
});
