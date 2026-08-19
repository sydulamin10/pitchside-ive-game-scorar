/**
 * Everything the scoring console needs, in one hook.
 *
 * The design rule: **a tap is never lost and never doubled.**
 *
 * - Every ball is validated by the browser engine before it goes anywhere, so an
 *   impossible entry is refused in place with the same error code the server
 *   would have used.
 * - Online, a ball is posted with `expected_state_version`; a second scorer who
 *   got there first causes a conflict rather than a silently interleaved log.
 * - Offline (or on any network failure), the ball goes to IndexedDB with a
 *   `client_event_id` and the score on screen is recomputed locally from the
 *   cached delivery log. When the connection returns the queue drains in order
 *   and the server treats a replayed id as a no-op.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";

import { ApiError } from "@/lib/api/client";
import { matches, scoring } from "@/lib/api/endpoints";
import type {
  DeliveryInput,
  DeliveryLogEntry,
  DeliveryUpdateInput,
  InningsSnapshot,
  MatchSnapshot,
} from "@/lib/api/types";
import {
  cacheSnapshot,
  enqueueDelivery,
  pendingForMatch,
  readCachedMatch,
  type QueuedDelivery,
} from "@/lib/offline/db";
import { describeBall, syncMatch } from "@/lib/offline/sync";
import { useMatchStream, type StreamStatus } from "@/lib/realtime/useMatchStream";
import {
  RuleViolationError,
  buildInningsState,
  deliveryFromInput,
  deliveryFromLog,
  engineRules,
  inningsSides,
  validateDelivery,
} from "@/lib/scoring";
import { toast, toastError } from "@/store/toast";
import { uuid } from "@/lib/utils";

/** The innings a scorer is working on: in progress, else the last unfinished one. */
export function currentInnings(
  snapshot: MatchSnapshot | null | undefined,
): InningsSnapshot | null {
  if (!snapshot) return null;
  const byId = snapshot.innings.find((i) => i.id === snapshot.current_innings_id);
  if (byId) return byId;
  return snapshot.innings.at(-1) ?? null;
}

export type NewBall = Omit<DeliveryInput, "client_event_id" | "expected_state_version">;

export interface ConsoleController {
  status: "loading" | "ready" | "error";
  error: ApiError | null;
  /** The scorecard to render: server state with any queued balls applied. */
  snapshot: MatchSnapshot | null;
  innings: InningsSnapshot | null;
  /** The raw delivery log, as stored: what a correction dialog edits. */
  log: DeliveryLogEntry[];
  /** True while the view includes balls the server has not accepted yet. */
  isProjected: boolean;
  fromCache: boolean;
  online: boolean;
  streamStatus: StreamStatus;
  updatedAt: number | null;
  pending: QueuedDelivery[];
  rejected: QueuedDelivery[];
  busy: boolean;
  /** Pre-flight check. Returns the violation instead of throwing. */
  check: (ball: NewBall) => RuleViolationError | null;
  record: (ball: NewBall) => Promise<void>;
  undo: () => Promise<void>;
  editBall: (deliveryId: string, patch: DeliveryUpdateInput) => Promise<void>;
  deleteBall: (deliveryId: string, reason?: string) => Promise<void>;
  startInnings: (input?: {
    batting_team_id?: string | null;
    overs_limit?: number | null;
    target_runs?: number | null;
    is_super_over?: boolean;
  }) => Promise<void>;
  closeInnings: (endReason: string) => Promise<void>;
  setToss: (winnerTeamId: string, decision: "bat" | "bowl") => Promise<void>;
  changeBowler: (bowlerId: string) => Promise<void>;
  swapEnds: () => Promise<void>;
  setBatters: (strikerId: string, nonStrikerId: string) => Promise<void>;
  syncNow: () => Promise<void>;
  refetch: () => void;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function useConsole(matchId: string | undefined): ConsoleController {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [cached, setCached] = useState<{
    snapshot: MatchSnapshot;
    log: DeliveryLogEntry[];
  } | null>(null);

  const key = useMemo(() => ["match", matchId] as const, [matchId]);

  const snapshotQuery = useQuery({
    queryKey: key,
    enabled: Boolean(matchId),
    queryFn: () => matches.get(matchId!),
    staleTime: 2_000,
  });

  // The raw log is what the browser engine replays, so it is fetched once per
  // match and kept fresh from the same responses that update the scorecard.
  const logQuery = useQuery({
    queryKey: ["match", matchId, "log"],
    enabled: Boolean(matchId),
    queryFn: () => matches.deliveries(matchId!, { limit: 2000 }),
    staleTime: 30_000,
  });

  const server = snapshotQuery.data ?? cached?.snapshot ?? null;
  const log = useMemo(() => logQuery.data?.items ?? cached?.log ?? [], [logQuery.data, cached]);

  // Keep the on-device copy current whenever the network gives us something new.
  useEffect(() => {
    if (!matchId || !snapshotQuery.data) return;
    void cacheSnapshot(matchId, snapshotQuery.data, logQuery.data?.items);
  }, [matchId, snapshotQuery.data, logQuery.data]);

  // A cold start with no network still opens on the last known scorecard.
  useEffect(() => {
    if (!matchId || snapshotQuery.data || !snapshotQuery.isError) return;
    let alive = true;
    void readCachedMatch(matchId).then((row) => {
      if (!alive || !row) return;
      setCached({ snapshot: row.snapshot, log: row.log ?? [] });
      setFromCache(true);
    });
    return () => {
      alive = false;
    };
  }, [matchId, snapshotQuery.data, snapshotQuery.isError]);

  const pendingRows = useLiveQuery(
    () => (matchId ? pendingForMatch(matchId) : Promise.resolve([])),
    [matchId],
    [] as QueuedDelivery[],
  );
  const pending = useMemo(
    () => pendingRows.filter((row) => row.status !== "rejected"),
    [pendingRows],
  );
  const rejected = useMemo(
    () => pendingRows.filter((row) => row.status === "rejected"),
    [pendingRows],
  );

  const refetch = useCallback(() => {
    void snapshotQuery.refetch();
    void logQuery.refetch();
  }, [snapshotQuery, logQuery]);

  const serverVersion = server?.match.state_version ?? 0;

  // Another scorer's ball, an edit from a laptop, or a rebuild: pull the truth.
  const stream = useMatchStream(server?.match.slug, {
    enabled: Boolean(server?.match.slug) && online,
    onResync: refetch,
  });
  useEffect(() => {
    const version = stream.state?.state_version;
    if (version !== undefined && version > serverVersion) refetch();
  }, [stream.state?.state_version, serverVersion, refetch]);

  // Drain the queue whenever we plausibly can.
  useEffect(() => {
    if (!matchId || !online || pending.length === 0) return;
    let cancelled = false;
    const run = async () => {
      const outcome = await syncMatch(matchId);
      if (cancelled) return;
      if (outcome.snapshot) {
        queryClient.setQueryData(key, outcome.snapshot);
        void logQuery.refetch();
      }
      if (outcome.rejected > 0) {
        toast(
          `${outcome.rejected} ${outcome.rejected === 1 ? "ball was" : "balls were"} refused by the server. Open the queue to fix ${outcome.rejected === 1 ? "it" : "them"}.`,
          "warning",
        );
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, online, pending.length, queryClient]);

  const innings = useMemo(() => currentInnings(server), [server]);

  const sides = useMemo(
    () => (server && innings ? inningsSides(server, innings) : { batting: [], bowling: [] }),
    [server, innings],
  );
  const rules = useMemo(
    () => (server && innings ? engineRules(server.match, innings) : null),
    [server, innings],
  );

  /**
   * The score as the scorer should see it: the server's log plus whatever is
   * still queued on this device, replayed by the same engine the server uses.
   */
  const projected = useMemo(() => {
    if (!server || !innings || !rules || pending.length === 0) return server;
    const events = log
      .filter((entry) => entry.innings_id === innings.id)
      .map(deliveryFromLog)
      .sort((a, b) => a.sequence - b.sequence);
    let sequence = events.at(-1)?.sequence ?? 0;
    for (const row of pending) {
      sequence += 1;
      events.push(deliveryFromInput(row.ball, { id: row.clientEventId, sequence }));
    }
    const state = buildInningsState(rules, sides.batting, sides.bowling, events);
    return {
      ...server,
      innings: server.innings.map((entry) =>
        entry.id === innings.id ? { ...entry, state } : entry,
      ),
    };
  }, [server, innings, rules, log, pending, sides]);

  const check = useCallback(
    (ball: NewBall): RuleViolationError | null => {
      const snapshot = projected;
      const active = currentInnings(snapshot);
      if (!snapshot || !active || !rules) return null;
      try {
        validateDelivery(
          active.state,
          deliveryFromInput(ball, { id: "candidate", sequence: 0 }),
          rules,
          sides.batting,
          sides.bowling,
        );
        return null;
      } catch (error) {
        return error instanceof RuleViolationError ? error : null;
      }
    },
    [projected, rules, sides],
  );

  const applyResponse = useCallback(
    (snapshot: MatchSnapshot) => {
      queryClient.setQueryData(key, snapshot);
      setFromCache(false);
      void logQuery.refetch();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, key],
  );

  const recordMutation = useMutation({
    mutationFn: async (ball: NewBall) => {
      if (!matchId) throw new Error("No match");
      const clientEventId = uuid();
      const payload: DeliveryInput = {
        ...ball,
        client_event_id: clientEventId,
        occurred_at: new Date().toISOString(),
      };

      const strikerName =
        currentInnings(projected)?.state.batting.find((b) => b.player_id === ball.striker_id)
          ?.name ?? "the striker";

      const queueIt = async () => {
        await enqueueDelivery({
          matchId,
          clientEventId,
          ball: payload,
          label: describeBall(payload, strikerName),
          createdAt: Date.now(),
          attempts: 0,
          status: "pending",
        });
      };

      // Anything queued must stay in order, so a new ball joins the back of the
      // queue rather than overtaking it.
      if (!online || pending.length > 0) {
        await queueIt();
        return null;
      }

      try {
        const response = await scoring.record(matchId, {
          ...payload,
          expected_state_version: server?.match.state_version ?? null,
        });
        return response.state;
      } catch (error) {
        if (error instanceof ApiError && error.isOffline) {
          await queueIt();
          return null;
        }
        throw error;
      }
    },
    onSuccess: (snapshot) => {
      if (snapshot) applyResponse(snapshot);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "version_conflict") {
        toast("Someone else scored a ball first. Reloading the live state.", "warning");
        refetch();
        return;
      }
      toastError(error, "That ball could not be recorded.");
    },
  });

  const undo = useCallback(async () => {
    if (!matchId) return;
    try {
      const response = await scoring.undo(matchId, innings?.id);
      applyResponse(response.state);
      toast("Last ball removed.", "success");
    } catch (error) {
      toastError(error, "That ball could not be undone.");
    }
  }, [matchId, innings, applyResponse]);

  const editBall = useCallback(
    async (deliveryId: string, patch: DeliveryUpdateInput) => {
      if (!matchId) return;
      try {
        const response = await scoring.edit(matchId, deliveryId, patch);
        applyResponse(response.state);
        toast("Corrected. Every figure after it has been recalculated.", "success");
      } catch (error) {
        toastError(error, "That correction was refused.");
        throw error;
      }
    },
    [matchId, applyResponse],
  );

  const deleteBall = useCallback(
    async (deliveryId: string, reason?: string) => {
      if (!matchId) return;
      try {
        const response = await scoring.remove(matchId, deliveryId, reason);
        applyResponse(response.state);
        toast("Ball removed from the log.", "success");
      } catch (error) {
        toastError(error, "That ball could not be removed.");
        throw error;
      }
    },
    [matchId, applyResponse],
  );

  const startInnings = useCallback(
    async (input: Parameters<ConsoleController["startInnings"]>[0] = {}) => {
      if (!matchId) return;
      try {
        applyResponse(await matches.startInnings(matchId, input));
      } catch (error) {
        toastError(error, "The innings could not be started.");
        throw error;
      }
    },
    [matchId, applyResponse],
  );

  const closeInnings = useCallback(
    async (endReason: string) => {
      if (!matchId || !innings) return;
      try {
        applyResponse(
          await matches.closeInnings(matchId, innings.id, { end_reason: endReason }),
        );
      } catch (error) {
        toastError(error, "The innings could not be closed.");
        throw error;
      }
    },
    [matchId, innings, applyResponse],
  );

  const setToss = useCallback(
    async (winnerTeamId: string, decision: "bat" | "bowl") => {
      if (!matchId) return;
      try {
        applyResponse(
          await matches.update(matchId, {
            toss: { winner_team_id: winnerTeamId, decision },
            expected_state_version: server?.match.state_version ?? null,
          }),
        );
      } catch (error) {
        toastError(error, "The toss could not be saved.");
        throw error;
      }
    },
    [matchId, server, applyResponse],
  );

  const changeBowler = useCallback(
    async (bowlerId: string) => {
      if (!matchId) return;
      try {
        const response = await scoring.changeBowler(
          matchId,
          {
            bowler_id: bowlerId,
            expected_state_version: server?.match.state_version ?? null,
          },
          innings?.id,
        );
        applyResponse(response.state);
        toast("Bowler changed for the rest of this over.", "success");
      } catch (error) {
        toastError(error, "The bowler could not be changed.");
        throw error;
      }
    },
    [matchId, server, innings, applyResponse],
  );

  const swapEnds = useCallback(async () => {
    if (!matchId) return;
    try {
      const response = await scoring.swapEnds(
        matchId,
        { expected_state_version: server?.match.state_version ?? null },
        innings?.id,
      );
      applyResponse(response.state);
      toast("Strike swapped for future balls.", "success");
    } catch (error) {
      toastError(error, "Strike could not be swapped.");
      throw error;
    }
  }, [matchId, server, innings, applyResponse]);

  const setBatters = useCallback(
    async (strikerId: string, nonStrikerId: string) => {
      if (!matchId) return;
      try {
        const response = await scoring.setBatters(
          matchId,
          {
            striker_id: strikerId,
            non_striker_id: nonStrikerId,
            expected_state_version: server?.match.state_version ?? null,
          },
          innings?.id,
        );
        applyResponse(response.state);
        toast("Crease updated for future balls.", "success");
      } catch (error) {
        toastError(error, "The crease could not be updated.");
        throw error;
      }
    },
    [matchId, server, innings, applyResponse],
  );

  const syncNow = useCallback(async () => {
    if (!matchId) return;
    const outcome = await syncMatch(matchId);
    if (outcome.snapshot) applyResponse(outcome.snapshot);
    if (outcome.error) toastError(outcome.error, "The queue could not be sent yet.");
    else if (outcome.accepted > 0) {
      toast(
        `${outcome.accepted} ${outcome.accepted === 1 ? "ball" : "balls"} synced.`,
        "success",
      );
    }
  }, [matchId, applyResponse]);

  const record = useCallback(
    async (ball: NewBall) => {
      const violation = check(ball);
      if (violation) {
        toast(violation.message, "error");
        return;
      }
      await recordMutation.mutateAsync(ball);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [check, recordMutation.mutateAsync],
  );

  const error = snapshotQuery.error instanceof ApiError && !server ? snapshotQuery.error : null;

  return {
    status: server ? "ready" : snapshotQuery.isError && !server ? "error" : "loading",
    error,
    snapshot: projected,
    innings: currentInnings(projected),
    log,
    isProjected: pending.length > 0,
    fromCache,
    online,
    streamStatus: stream.status,
    updatedAt: stream.updatedAt,
    pending,
    rejected,
    busy: recordMutation.isPending,
    check,
    record,
    undo,
    editBall,
    deleteBall,
    startInnings,
    closeInnings,
    setToss,
    changeBowler,
    swapEnds,
    setBatters,
    syncNow,
    refetch,
  };
}
