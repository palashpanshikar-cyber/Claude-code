import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { localDay } from '../lib/day.js';
import { assignmentsForDay } from '../services/minis.js';
import { milestoneReached, recordActivity } from '../services/streak.js';
import { publicMini } from '../lib/serialize.js';
import { authed, conflict, gone, handle, notFoundError } from '../lib/http.js';

/** Slots are unique; a clash is the operator's mistake, not a server fault. */
const slotTaken = (err: unknown) =>
  (err as { code?: string }).code === 'P2002' ? conflict('That slot is already taken') : err;
import { CATEGORIES } from '../lib/categories.js';

export const minisRouter = Router();

minisRouter.use(requireAuth);

minisRouter.get(
  '/today',
  authed(async (req, res) => {
    const day = localDay(req.user.timezone);
    const assignments = await assignmentsForDay(prisma, req.user.id, day);

    res.json({
      day,
      minis: assignments.map(publicMini),
      completed: assignments.filter((a) => a.completedAt).length,
    });
  }),
);

const completeSchema = z.object({ note: z.string().max(500).optional() });

minisRouter.post(
  '/:assignmentId/complete',
  authed(async (req, res) => {
    const user = req.user;
    const { note } = completeSchema.parse(req.body ?? {});

    const assignment = await prisma.miniAssignment.findUnique({
      where: { id: req.params.assignmentId },
      include: { miniQuest: true },
    });

    if (!assignment || assignment.userId !== user.id) throw notFoundError('Mini quest not found');
    if (assignment.completedAt) throw conflict('Mini quest already completed');

    const today = localDay(user.timezone);
    // Yesterday's leftover minis stay visible in the client's cache; completing
    // them must not backfill a streak day that was actually missed.
    if (assignment.localDay !== today) {
      throw gone("That mini quest expired — pull today's minis");
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
  }),
);

const miniSchema = z.object({
  slot: z.coerce.number().int().min(0).max(199),
  title: z.string().min(3).max(80),
  prompt: z.string().min(5).max(300),
  category: z.enum(CATEGORIES),
});

/** The whole pool, in rotation order — the admin's editing view. */
minisRouter.get(
  '/pool',
  requireAdmin,
  handle(async (_req, res) => {
    const minis = await prisma.miniQuest.findMany({ orderBy: { slot: 'asc' } });
    res.json({ minis, poolSize: minis.length });
  }),
);

minisRouter.post(
  '/pool',
  requireAdmin,
  handle(async (req, res) => {
    const input = miniSchema.parse(req.body);
    try {
      const mini = await prisma.miniQuest.create({ data: input });
      res.status(201).json({ mini });
    } catch (err) {
      throw slotTaken(err);
    }
  }),
);

minisRouter.patch(
  '/pool/:id',
  requireAdmin,
  handle(async (req, res) => {
    const input = miniSchema.partial().parse(req.body);
    const existing = await prisma.miniQuest.findUnique({ where: { id: req.params.id } });

    if (!existing) throw notFoundError('Mini quest not found');

    try {
      const mini = await prisma.miniQuest.update({ where: { id: existing.id }, data: input });
      res.json({ mini });
    } catch (err) {
      throw slotTaken(err);
    }
  }),
);

minisRouter.delete(
  '/pool/:id',
  requireAdmin,
  handle(async (req, res) => {
    const existing = await prisma.miniQuest.findUnique({ where: { id: req.params.id } });

    if (!existing) throw notFoundError('Mini quest not found');

    // Removing a mini changes the pool size and therefore the rotation for
    // everyone. Assignments cascade, so days already served lose their history —
    // acceptable for an admin-only correction, but it is not a soft delete.
    await prisma.miniQuest.delete({ where: { id: existing.id } });
    res.json({ deleted: existing.id });
  }),
);
