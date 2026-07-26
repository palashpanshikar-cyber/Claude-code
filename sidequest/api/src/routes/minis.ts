import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { localDay } from '../lib/day.js';
import { assignmentsForDay } from '../services/minis.js';
import { milestoneReached, recordActivity } from '../services/streak.js';
import { publicMini } from '../lib/serialize.js';

export const minisRouter = Router();

minisRouter.use(requireAuth);

minisRouter.get('/today', async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const day = localDay(user.timezone);
    const assignments = await assignmentsForDay(prisma, user.id, day);

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
    const user = (req as AuthedRequest).user;
    const { note } = completeSchema.parse(req.body ?? {});

    const assignment = await prisma.miniAssignment.findUnique({
      where: { id: req.params.assignmentId },
      include: { miniQuest: true },
    });

    if (!assignment || assignment.userId !== user.id) {
      res.status(404).json({ error: 'Mini quest not found' });
      return;
    }
    if (assignment.completedAt) {
      res.status(409).json({ error: 'Mini quest already completed' });
      return;
    }

    const today = localDay(user.timezone);
    // Yesterday's leftover minis stay visible in the client's cache; completing
    // them must not backfill a streak day that was actually missed.
    if (assignment.localDay !== today) {
      res.status(410).json({ error: "That mini quest expired — pull today's minis" });
      return;
    }

    const { updated, streak } = await prisma.$transaction(async (tx) => {
      const updated = await tx.miniAssignment.update({
        where: { id: assignment.id },
        data: { completedAt: new Date(), note: note ?? null },
        include: { miniQuest: true },
      });
      // Minis count toward the streak — they exist so a busy day still has a
      // reachable way to keep it alive.
      const streak = await recordActivity(tx, user, today);
      return { updated, streak };
    });

    res.json({
      mini: publicMini(updated),
      streak,
      milestone: milestoneReached(streak.currentStreak),
    });
  } catch (err) {
    next(err);
  }
});
