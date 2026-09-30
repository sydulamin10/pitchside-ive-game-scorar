import { describe, expect, it } from "vitest";

import {
  effectiveOverlayPanel,
  matchEndAwardsActive,
  matchEndSummaryActive,
} from "./matchEndSummary";

describe("matchEndSummary", () => {
  it("hides awards after 30s and the full-screen summary after 45s", () => {
    const start = "2026-09-22T12:00:00.000Z";
    const t0 = Date.parse(start);
    const completed = { status: "completed" as const, completed_at: start };
    expect(matchEndAwardsActive(completed, t0 + 1_000)).toBe(true);
    expect(matchEndAwardsActive(completed, t0 + 29_000)).toBe(true);
    expect(matchEndAwardsActive(completed, t0 + 30_000)).toBe(false);
    expect(matchEndSummaryActive(completed, t0 + 1_000)).toBe(true);
    expect(matchEndSummaryActive(completed, t0 + 44_000)).toBe(true);
    expect(matchEndSummaryActive(completed, t0 + 45_000)).toBe(false);
    expect(effectiveOverlayPanel({ panel: "hidden" } as never, completed, t0 + 5_000)).toBe(
      "summary",
    );
    expect(
      effectiveOverlayPanel(
        { panel: "summary", summary_until: "2026-09-22T12:00:45.000Z" } as never,
        completed,
        t0 + 46_000,
      ),
    ).toBe("hidden");
    expect(effectiveOverlayPanel({ panel: "summary" } as never, completed, t0 + 46_000)).toBe(
      "summary",
    );
  });
});
