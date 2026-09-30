/**
 * Match-end graphics:
 * - awards / after-match card: 30s
 * - full-screen result summary: 45s, then hide
 */

import type { CompactState, OverlayDirector, OverlayPanel } from "@/lib/api/types";

export const MATCH_END_AWARDS_MS = 30_000;
export const MATCH_END_SUMMARY_MS = 45_000;

function completedAgoMs(
  state: Pick<CompactState, "status" | "completed_at"> | null | undefined,
  now: number,
): number | null {
  if (state?.status !== "completed" || !state.completed_at) return null;
  const start = Date.parse(state.completed_at);
  if (Number.isNaN(start)) return null;
  return now - start;
}

export function matchEndAwardsActive(
  state: Pick<CompactState, "status" | "completed_at"> | null | undefined,
  now = Date.now(),
): boolean {
  const ago = completedAgoMs(state, now);
  return ago != null && ago < MATCH_END_AWARDS_MS;
}

export function matchEndSummaryActive(
  state: Pick<CompactState, "status" | "completed_at"> | null | undefined,
  now = Date.now(),
): boolean {
  const ago = completedAgoMs(state, now);
  return ago != null && ago < MATCH_END_SUMMARY_MS;
}

export function effectiveOverlayPanel(
  graphics: OverlayDirector | null | undefined,
  state: Pick<CompactState, "status" | "completed_at"> | null | undefined,
  now = Date.now(),
): OverlayPanel {
  if (matchEndSummaryActive(state, now)) return "summary";
  const until = graphics?.summary_until;
  if (until && graphics?.panel === "summary") {
    const end = Date.parse(until);
    if (!Number.isNaN(end) && now >= end) return "hidden";
  }
  return graphics?.panel ?? "hidden";
}

export function withEffectivePanel(
  graphics: OverlayDirector | null | undefined,
  state: Pick<CompactState, "status" | "completed_at"> | null | undefined,
  now = Date.now(),
): OverlayDirector | undefined {
  if (!graphics) return undefined;
  const panel = effectiveOverlayPanel(graphics, state, now);
  return panel === graphics.panel ? graphics : { ...graphics, panel };
}
