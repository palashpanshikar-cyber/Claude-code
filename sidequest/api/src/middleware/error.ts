import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/http.js';
import { logger } from '../lib/logger.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/** Upload failures multer reports by code, mapped to something a user can act on. */
const MULTER_MESSAGES: Record<string, { status: number; message: string }> = {
  LIMIT_FILE_SIZE: { status: 413, message: 'Photo is too large (max 10MB)' },
  LIMIT_UNEXPECTED_FILE: {
    status: 400,
    message: 'Unexpected file field — send the photo as "photo"',
  },
  LIMIT_FILE_COUNT: { status: 400, message: 'Only one photo per completion' },
};

export function errorHandler(
  err: unknown,
  req: Request,
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

  const e = err as { code?: string; status?: number; statusCode?: number; message?: string };

  const multer = e.code ? MULTER_MESSAGES[e.code] : undefined;
  if (multer) {
    res.status(multer.status).json({ error: multer.message });
    return;
  }

  // Only errors we constructed are echoed back verbatim. Express middleware
  // attaches `status` to its own errors too — a malformed JSON body arrives as
  // a 400 carrying body-parser's internal parse message, which tells a client
  // about our internals and nothing useful about their mistake.
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  const status = e.status ?? e.statusCode ?? 500;

  if (status === 400) {
    res.status(400).json({ error: 'Malformed request' });
    return;
  }

  if (status >= 500) {
    logger.error(
      { err, method: req.method, url: req.originalUrl },
      'unhandled error serving request',
    );
  }

  res.status(status >= 500 ? 500 : status).json({
    error: status >= 500 ? 'Internal server error' : 'Request could not be completed',
  });
}
