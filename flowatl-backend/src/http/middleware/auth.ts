import type { NextFunction, Request, Response } from 'express';
import type { UserRow } from '../../domain/auth.js';
import { ApiError } from '../../lib/errors.js';
import type { Services } from '../../services.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      token?: string;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  // Browsers cannot set headers on an EventSource, so the stream endpoint
  // accepts the token as a query parameter.
  const query = req.query.token;
  if (typeof query === 'string' && query.length > 0) return query;
  return null;
}

/** Attach the user when a valid token is present, but do not require one. */
export function optionalAuth(services: Services) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    if (token) {
      const user = services.auth.authenticate(token);
      if (user) {
        req.user = user;
        req.token = token;
      }
    }
    next();
  };
}

export function requireAuth(services: Services) {
  const optional = optionalAuth(services);
  return (req: Request, res: Response, next: NextFunction): void => {
    optional(req, res, () => {
      if (!req.user) {
        next(ApiError.unauthorized('Sign in to continue'));
        return;
      }
      next();
    });
  };
}

export function currentUser(req: Request): UserRow {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}
