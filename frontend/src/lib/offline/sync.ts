/**
 * Draining the offline queue.
 *
 * The rules that make this safe:
 *
 * - Balls are sent in the order they were tapped, in one batch, because a
 *   delivery log only makes sense in sequence.
 * - Every ball carries a `client_event_id`, so a ball that actually reached the
 *   server before the connection dropped comes back as a *duplicate* rather than
 *   being scored twice.
 * - `stop_on_error` is false: one illegal ball in the middle of a queue must not
 *   hold up the twenty legal ones behind it. Rejections are kept on the device
 *   and shown to the scorer to fix by hand.
 * - Only one drain runs at a time per tab, and a drain never runs while offline.
 */

import { ApiError } from "@/lib/api/client";
import { scoring } from "@/lib/api/endpoints";
import type { MatchSnapshot } from "@/lib/api/types";

import {
  bumpAttempts,
  dropQueued,
  markRejected,
  pendingForMatch,
  type QueuedDelivery,
} from "./db";

export interface SyncOutcome {
  attempted: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  snapshot: MatchSnapshot | null;
  /** Set when the whole batch failed (offline, server error) and nothing moved. */
  error: ApiError | null;
}

const IDLE: SyncOutcome = {
  attempted: 0,
  accepted: 0,
  duplicates: 0,
  rejected: 0,
  snapshot: null,
  error: null,
};

const inFlight = new Map<string, Promise<SyncOutcome>>();

/** Balls that were refused for a cricket reason will never succeed on a retry. */
function isPermanent(error: ApiError): boolean {
  return error.status === 422 || error.status === 403 || error.status === 404;
}

async function drain(matchId: string): Promise<SyncOutcome> {
  const queued = (await pendingForMatch(matchId)).filter((row) => row.status !== "rejected");
  if (queued.length === 0) return IDLE;

  const ids = queued.map((row) => row.id!).filter((id): id is number => typeof id === "number");
  await bumpAttempts(ids);

  let response;
  try {
    response = await scoring.sync(
      matchId,
      queued.map((row) => row.ball),
      false,
    );
  } catch (cause) {
    const error = cause instanceof ApiError ? cause : null;
    if (error && isPermanent(error) && queued.length === 1) {
      // A single ball the server will never accept: park it for manual repair.
      const only = queued[0];
      if (only?.id !== undefined) {
        await markRejected(only.id, { code: error.code, message: error.message });
      }
      return { ...IDLE, attempted: 1, rejected: 1, error: null };
    }
    return { ...IDLE, attempted: queued.length, error };
  }

  const { result, state } = response;
  const rejectedByIndex = new Map(result.rejected.map((entry) => [entry.index, entry]));

  const settled: number[] = [];
  for (const [index, row] of queued.entries()) {
    if (row.id === undefined) continue;
    const rejection = rejectedByIndex.get(index);
    if (rejection) await markRejected(row.id, rejection);
    else settled.push(row.id);
  }
  await dropQueued(settled);

  return {
    attempted: queued.length,
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected: result.rejected.length,
    snapshot: state,
    error: null,
  };
}

/** Push every queued ball for one match. Safe to call as often as you like. */
export function syncMatch(matchId: string): Promise<SyncOutcome> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return Promise.resolve(IDLE);
  }
  const existing = inFlight.get(matchId);
  if (existing) return existing;

  const run = drain(matchId).finally(() => inFlight.delete(matchId));
  inFlight.set(matchId, run);
  return run;
}

/** A short description of a ball, for the pending queue list. */
export function describeBall(ball: QueuedDelivery["ball"], strikerName: string): string {
  const parts: string[] = [];
  if (ball.extra_type) parts.push(ball.extra_type.replace("_", " "));
  const runs = (ball.batter_runs ?? 0) + (ball.extra_runs ?? 0);
  parts.push(runs === 1 ? "1 run" : `${runs} runs`);
  if (ball.is_wicket) parts.push("wicket");
  return `${parts.join(", ")} · ${strikerName}`;
}
