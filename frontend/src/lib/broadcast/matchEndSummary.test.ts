import { describe, expect, it } from "vitest";

import { effectiveOverlayPanel, matchEndSummaryActive } from "./matchEndSummary";

describe("matchEndSummary", () => {
  it("shows the result for one minute after the match ends", () => {
    const start = "2026-09-22T12:00:00.000Z";
    const t0 = Date.parse(start);
    expect(matchEndSummaryActive({ status: "completed", completed_at: start }, t0 + 1_000)).toBe(true);
    expect(matchEndSummaryActive({ status: "completed", completed_at: start }, t0 + 59_000)).toBe(true);
    expect(matchEndSummaryActive({ status: "completed", completed_at: start }, t0 + 60_000)).toBe(false);
    expect(effectiveOverlayPanel({ panel: "hidden" } as never, { status: "completed", completed_at: start }, t0 + 5_000)).toBe(
      "summary",
    );
    expect(
      effectiveOverlayPanel(
        { panel: "summary", summary_until: "2026-09-22T12:01:00.000Z" } as never,
        { status: "completed", completed_at: start },
        t0 + 61_000,
      ),
    ).toBe("hidden");
    expect(effectiveOverlayPanel({ panel: "summary" } as never, { status: "completed", completed_at: start }, t0 + 61_000)).toBe(
      "summary",
    );
  });
});
