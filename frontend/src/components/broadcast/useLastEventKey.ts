import { useEffect, useRef, useState } from "react";

import type { CompactState } from "@/lib/api/types";

/** Stable key for the latest delivery in a compact frame — drives event graphics. */
export function useLastEventKey(state: CompactState | null): string | null {
  const prev = useRef<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    if (!state?.recent_balls?.length) return;
    const last = state.recent_balls[state.recent_balls.length - 1];
    const id = last?.delivery_id ?? `${state.state_version}-${last?.display}`;
    if (id && id !== prev.current) {
      prev.current = id;
      setKey(`${id}:${last?.display ?? ""}:${state.score?.is_free_hit ? "fh" : ""}`);
    }
  }, [state]);

  return key;
}
