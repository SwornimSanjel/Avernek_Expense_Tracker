/**
 * "Select several, delete them at once" for the record lists. The pieces the
 * server actions share: which ids to trust, and how the result is worded.
 * Each list's own delete rules still apply; a record they protect is skipped
 * and counted, never forced.
 */

export type BulkResult = { deleted: number; skipped: number; message: string };

/** The most records one action may delete. */
export const BULK_LIMIT = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The ids a client sent, kept only if they look like record ids, without repeats. */
export function bulkIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, BULK_LIMIT);
}

/** "Deleted 12 bills." or "Deleted 11 bills. 1 was not deleted: it has been paid back." */
export function bulkResult(deleted: number, asked: number, noun: { one: string; many: string }, why?: string): BulkResult {
  const skipped = Math.max(0, asked - deleted);
  const count = (n: number) => `${n} ${n === 1 ? noun.one : noun.many}`;
  const message = `Deleted ${count(deleted)}.${skipped ? ` ${skipped} ${skipped === 1 ? "was" : "were"} not deleted${why ? `: ${why}` : ""}.` : ""}`;
  return { deleted, skipped, message };
}
