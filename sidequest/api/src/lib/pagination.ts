import { z } from 'zod';
import { badRequest } from './http.js';

/**
 * Cursor pagination helpers.
 *
 * Prisma treats a cursor pointing at a row that does not exist as an empty
 * result rather than an error. For a client that is indistinguishable from
 * "you have reached the end", so a stale or corrupted cursor silently renders
 * an empty feed with nothing to debug. These helpers turn that into a 400.
 */

/** The query shape every cursor-paginated endpoint accepts. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Splits an over-fetched result into a page and its next cursor.
 *
 * Callers ask the database for `limit + 1` rows; the extra row is how we know
 * another page exists without a second count query.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

/** Prisma arguments for a cursor page, spread into a findMany call. */
export function cursorArgs({ limit, cursor }: PageQuery) {
  return {
    take: limit + 1,
    // `skip: 1` steps past the cursor row itself, which the client already has.
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * Throws a 400 when a cursor was supplied but points at nothing.
 *
 * Only called when a page came back empty, so the extra lookup costs nothing
 * on the normal path.
 */
export async function assertCursorExists(
  cursor: string | undefined,
  exists: (id: string) => Promise<boolean>,
): Promise<void> {
  if (!cursor) return;
  if (await exists(cursor)) return;
  throw badRequest('Unknown cursor — start the list again without one');
}
