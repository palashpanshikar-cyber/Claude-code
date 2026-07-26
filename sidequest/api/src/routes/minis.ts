import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
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

const miniSchema = z.object({
  slot: z.coerce.number().int().min(0).max(199),
  title: z.string().min(3).max(80),
  prompt: z.string().min(5).max(300),
  category: z.enum(['ADVENTURE', 'FOOD_DRINK', 'CULTURE', 'NATURE', 'FITNESS', 'CREATIVE']),
});

/** The whole pool, in rotation order — the admin's editing view. */
minisRouter.get('/pool', requireAdmin, async (_req, res, next) => {
  try {
    const minis = await prisma.miniQuest.findMany({ orderBy: { slot: 'asc' } });
    res.json({ minis, poolSize: minis.length });
  } catch (err) {
    next(err);
  }
});

minisRouter.post('/pool', requireAdmin, async (req, res, next) => {
  try {
    const input = miniSchema.parse(req.body);
    const mini = await prisma.miniQuest.create({ data: input });
    res.status(201).json({ mini });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'That slot is already taken' });
      return;
    }
    next(err);
  }
});

minisRouter.patch('/pool/:id', requireAdmin, async (req, res, next) => {
  try {
    const input = miniSchema.partial().parse(req.body);
    const existing = await prisma.miniQuest.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      res.status(404).json({ error: 'Mini quest not found' });
      return;
    }

    const mini = await prisma.miniQuest.update({ where: { id: existing.id }, data: input });
    res.json({ mini });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: 'That slot is already taken' });
      return;
    }
    next(err);
  }
});

minisRouter.delete('/pool/:id', requireAdmin, async (req, res, next) => {
  try {
    const existing = await prisma.miniQuest.findUnique({ where: { id: req.params.id } });

    if (!existing) {
      res.status(404).json({ error: 'Mini quest not found' });
      return;
    }

    // Removing a mini changes the pool size and therefore the rotation for
    // everyone. Assignments cascade, so days already served lose their history —
    // acceptable for an admin-only correction, but it is not a soft delete.
    await prisma.miniQuest.delete({ where: { id: existing.id } });
    res.json({ deleted: existing.id });
  } catch (err) {
    next(err);
  }
});
