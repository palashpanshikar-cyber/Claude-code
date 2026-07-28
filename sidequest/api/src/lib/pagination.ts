/**
 * Cursor pagination helpers.
 *
 * Prisma treats a cursor pointing at a row that does not exist as an empty
 * result rather than an error. For a client that is indistinguishable from
 * "you have reached the end", so a stale or corrupted cursor silently renders
 * an empty feed with nothing to debug. These helpers turn that into a 400.
 */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Splits an over-fetched result (limit + 1) into a page and its next cursor. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
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
  throw Object.assign(new Error('Unknown cursor — start the list again without one'), {
    status: 400,
  });
}
