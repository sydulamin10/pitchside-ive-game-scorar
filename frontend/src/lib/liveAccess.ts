import { useQuery } from "@tanstack/react-query";

import { ApiError } from "@/lib/api/client";
import { billing, broadcast } from "@/lib/api/endpoints";
import { useAuth } from "@/store/auth";

function isMissingSession(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.code === "stream_session_not_found")
  );
}

/**
 * Whether this account may start (or continue) a live broadcast for a match.
 * Admin / Pro / credits / tournament cover a new session. An already-paid
 * session on this match stays open even if remaining credits are zero.
 */
export function useCanGoLive(matchId?: string) {
  const user = useAuth((state) => state.user);
  const entitlement = useQuery({
    queryKey: ["billing-entitlement"],
    queryFn: () => billing.entitlement(),
  });
  const admin = user?.role === "admin";
  const canStart = admin || entitlement.data?.can_go_live === true;
  const needsSessionCheck =
    Boolean(matchId) && !admin && entitlement.isSuccess && !entitlement.data?.can_go_live;

  const active = useQuery({
    queryKey: ["stream-session-active", matchId],
    queryFn: () => broadcast.getActive(matchId!),
    enabled: needsSessionCheck,
    retry: false,
  });

  const hasSession = active.isSuccess;
  const sessionUnknown = active.isError && !isMissingSession(active.error);
  const allowed = canStart || hasSession || sessionUnknown;
  const ready = !entitlement.isPending && (!needsSessionCheck || active.isFetched);
  const locked = ready && !allowed;
  const reason =
    entitlement.data?.reason ??
    "This account has no live match credits. One credit starts one live match.";

  return { allowed, ready, locked, reason, hasSession, entitlement, active };
}
