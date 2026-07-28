import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AuthedRequest } from '../middleware/auth.js';

/**
 * An error whose message is safe to send to a client.
 *
 * Express and its middleware attach `status` to their own errors too — a
 * malformed JSON body arrives as a 400 carrying body-parser's internal parse
 * message. Marking our own errors explicitly means the error handler can echo
 * ours and stay generic about everyone else's, rather than leaking whatever a
 * library happened to put in `message`.
 */
export class AppError extends Error {
  readonly expose = true;

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string) => new AppError(message, 400);
export const notFoundError = (message: string) => new AppError(message, 404);
export const conflict = (message: string) => new AppError(message, 409);
export const gone = (message: string) => new AppError(message, 410);

/**
 * Wraps an async route so rejections reach the error handler.
 *
 * Express 4 does not await handlers, so an un-caught rejection hangs the
 * request until the client times out. Every route used to carry its own
 * try/catch to work around that; this does it once.
 */
export function handle(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Same, for routes behind requireAuth — `req.user` is guaranteed, so the
 * handler gets it typed instead of casting at the top of every function.
 */
export function authed(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}
