/**
 * On-device storage for offline scoring.
 *
 * Two tables, deliberately small:
 *
 * - `queue`  — balls recorded while offline, in the order they were tapped.
 *              Each carries a `client_event_id`; the server treats a replay of
 *              the same id as a no-op, which is what makes retrying safe.
 * - `cache`  — the last known scorecard per match, so opening the console in a
 *              tunnel still shows the right score instead of an empty page.
 */

import Dexie, { type EntityTable } from "dexie";

import type { DeliveryInput, DeliveryLogEntry, MatchSnapshot } from "@/lib/api/types";

export type QueueStatus = "pending" | "sending" | "rejected";

export interface QueuedDelivery {
  /** Auto-increment keeps the queue in tap order, which is the order cricket happened in. */
  id?: number;
  matchId: string;
  clientEventId: string;
  ball: DeliveryInput;
  /** Human-readable description for the pending list, e.g. "4 runs, Kohli". */
  label: string;
  createdAt: number;
  attempts: number;
  status: QueueStatus;
  lastError?: string;
  lastErrorCode?: string;
}

export interface CachedSnapshot {
  matchId: string;
  snapshot: MatchSnapshot;
  /**
   * The raw delivery log. Kept alongside the scorecard because the browser
   * engine replays a log — with it, a ball tapped in a tunnel updates the score
   * on screen instead of only joining a queue.
   */
  log?: DeliveryLogEntry[];
  savedAt: number;
}

class PitchsideDb extends Dexie {
  queue!: EntityTable<QueuedDelivery, "id">;
  cache!: EntityTable<CachedSnapshot, "matchId">;

  constructor() {
    super("pitchside");
    this.version(1).stores({
      queue: "++id, matchId, status, createdAt, clientEventId",
      cache: "matchId, savedAt",
    });
  }
}

export const db = new PitchsideDb();

export async function enqueueDelivery(entry: Omit<QueuedDelivery, "id">): Promise<number> {
  return (await db.queue.add(entry)) as number;
}

export function pendingForMatch(matchId: string): Promise<QueuedDelivery[]> {
  return db.queue.where("matchId").equals(matchId).sortBy("id");
}

export async function countPending(matchId: string): Promise<number> {
  return db.queue.where("matchId").equals(matchId).count();
}

export async function dropQueued(ids: number[]): Promise<void> {
  if (ids.length) await db.queue.bulkDelete(ids);
}

export async function markRejected(
  id: number,
  error: { code: string; message: string },
): Promise<void> {
  await db.queue.update(id, {
    status: "rejected",
    lastError: error.message,
    lastErrorCode: error.code,
  });
}

export async function bumpAttempts(ids: number[]): Promise<void> {
  await db.transaction("rw", db.queue, async () => {
    for (const id of ids) {
      const row = await db.queue.get(id);
      if (row) await db.queue.update(id, { attempts: row.attempts + 1 });
    }
  });
}

export async function cacheSnapshot(
  matchId: string,
  snapshot: MatchSnapshot,
  log?: DeliveryLogEntry[],
): Promise<void> {
  const existing = log === undefined ? await db.cache.get(matchId) : undefined;
  await db.cache.put({
    matchId,
    snapshot,
    log: log ?? existing?.log,
    savedAt: Date.now(),
  });
}

export async function readCachedSnapshot(matchId: string): Promise<MatchSnapshot | null> {
  const row = await db.cache.get(matchId);
  return row?.snapshot ?? null;
}

export async function readCachedMatch(matchId: string): Promise<CachedSnapshot | null> {
  return (await db.cache.get(matchId)) ?? null;
}

/** Housekeeping: a phone should not hold months of finished matches. */
export async function pruneCache(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  const stale = await db.cache.where("savedAt").below(cutoff).primaryKeys();
  if (stale.length) await db.cache.bulkDelete(stale);
}
