import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../../config.js';
import { ApiError } from '../../lib/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` },
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Request body or query parameters are invalid',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  console.error('[error] unhandled:', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on the FlowATL network',
      ...(config.isProduction
        ? {}
        : { details: error instanceof Error ? error.message : String(error) }),
    },
  });
}

/** Wrap an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (...args: never[]) => unknown>(handler: T): T {
  return ((req: Request, res: Response, next: NextFunction) => {
    try {
      const result = (handler as unknown as (...a: unknown[]) => unknown)(req, res, next);
      if (result instanceof Promise) result.catch(next);
      return result;
    } catch (error) {
      next(error);
      return undefined;
    }
  }) as unknown as T;
}
