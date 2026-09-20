import type { Request } from 'express';
import { ApiError } from '../lib/errors.js';

/**
 * Read a path parameter as a string. Express types these as `string | string[]`
 * to allow for repeated wildcards, which none of these routes use.
 */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw ApiError.badRequest(`Missing "${name}" in the request path`);
  }
  return value;
}
