import type { NextFunction, Request, Response } from 'express';
import type { AuthedRequest } from './auth.js';

/**
 * Gates moderation endpoints. Must run after requireAuth.
 *
 * Admin is a column set by hand in the database — there is deliberately no
 * endpoint that grants it. A self-serve path to moderator rights is a
 * privilege-escalation bug waiting to happen, and with one operator there is
 * nothing to automate.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user?.isAdmin) {
    // 404, not 403 — an admin surface should not confirm it exists.
    res.status(404).json({ error: 'Not found' });
    return;
  }
  next();
}
