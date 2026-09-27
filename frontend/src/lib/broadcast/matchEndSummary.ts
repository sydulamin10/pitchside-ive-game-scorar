/**
 * At match end the result card stays on air for one minute, then hides.
 */

import type { CompactState, OverlayDirector, OverlayPanel } from "@/lib/api/types";

export const MATCH_END_SUMMARY_MS = 60_000;

export function matchEndSummaryActive(
  state: Pick<CompactState, "status" | "completed_at"> | null | undefined,
  now = Date.now(),
): boolean {
  if (state?.status !== "completed" || !state.completed_at) return false;
  const start = Date.parse(state.completed_at);
  if (Number.isNaN(start)) return false;
  return now - start < MATCH_END_SUMMARY_MS;
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
