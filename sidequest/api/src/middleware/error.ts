import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../lib/config.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies error handlers by arity, so `next` must stay declared.
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
    });
    return;
  }

  const e = err as { code?: string; status?: number; message?: string };

  // Multer surfaces upload problems (size, field name) with a code.
  if (e.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Photo is too large (max 10MB)' });
    return;
  }
  if (e.code === 'LIMIT_UNEXPECTED_FILE') {
    res.status(400).json({ error: 'Unexpected file field — send the photo as "photo"' });
    return;
  }

  const status = e.status ?? 500;
  if (status >= 500 && config.env !== 'test') {
    console.error(err);
  }

  res.status(status).json({ error: status >= 500 ? 'Internal server error' : e.message });
}
