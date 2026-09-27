import { describe, expect, it } from "vitest";

import { oversToPoints } from "./matchCharts";
import type { OverSummary } from "@/lib/api/types";

function over(n: number, runs: number, wickets = 0): OverSummary {
  return {
    over_number: n,
    bowler_id: "b",
    bowler_name: "Bowler",
    runs,
    wickets,
    is_maiden: runs === 0,
    is_complete: true,
    balls: [],
  };
}

describe("matchCharts", () => {
  it("builds a worm (cumulative) and run rate from overs", () => {
    const pts = oversToPoints([over(1, 8), over(2, 12, 1), over(3, 6)]);
    expect(pts.map((p) => p.cumulative)).toEqual([8, 20, 26]);
    expect(pts[1]?.wickets).toBe(1);
    expect(pts[2]?.runRate).toBeCloseTo(26 / 3, 2);
  });
});
