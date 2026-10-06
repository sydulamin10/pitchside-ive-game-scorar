import { useQuery } from "@tanstack/react-query";

import { billing } from "@/lib/api/endpoints";
import { useAuth } from "@/store/auth";

/**
 * Whether this account may start (or continue) a live broadcast for a match.
 *
 * - Remaining credits / Pro / admin unlock Go Live on any match.
 * - A match that already reserved a live credit stays unlocked even at 0
 *   credits, including after leaving scoring and coming back.
 * - A match started without a credit stays locked until the account buys one.
 */
export function useCanGoLive(matchId?: string, liveUnlocked?: boolean) {
  const user = useAuth((state) => state.user);
  const entitlement = useQuery({
    queryKey: ["billing-entitlement"],
    queryFn: () => billing.entitlement(),
  });
  const admin = user?.role === "admin";
  const canStart = admin || entitlement.data?.can_go_live === true;
  const persisted = liveUnlocked === true;
  const allowed = canStart || persisted;
  const ready =
    admin || persisted || canStart || (!entitlement.isPending && liveUnlocked === false);
  const locked = ready && !allowed;
  const reason =
    entitlement.data?.reason ??
    "This account has no live match credits. One credit starts one live match.";

  return { allowed, ready, locked, reason, entitlement };
}
