import { describe, expect, it } from "vitest";

import { scoreHeadline } from "./overlayCompositor";
import { classifyBall, latestGraphic } from "./eventKind";
import type { CompactState } from "@/lib/api/types";

describe("overlayCompositor helpers", () => {
  it("builds a score headline for Facebook / YouTube", () => {
    const state = {
      batting_team: { id: "a", name: "Old Dhaka", short_name: "ODC" },
      score: { runs: 142, wickets: 3, overs_text: "14.2" },
    } as CompactState;
    expect(scoreHeadline(state)).toBe("ODC  142/3  (14.2)");
  });
});

describe("eventKind", () => {
  it("classifies a four, six, wicket, wide and no-ball", () => {
    expect(classifyBall("4", false)).toBe("four");
    expect(classifyBall("6", false)).toBe("six");
    expect(classifyBall("W", false)).toBe("wicket");
    expect(classifyBall("wd", false)).toBe("wide");
    expect(classifyBall("1nb", false)).toBe("no_ball");
  });

  it("keeps 1, 2, 3 and 5 off the live graphic", () => {
    const quiet = {
      recent_balls: [{ display: "1" }],
      score: { runs: 10, is_free_hit: false },
    } as CompactState;
    expect(latestGraphic({ ...quiet, recent_balls: [{ display: "1" } as never] }, 9)).toBeNull();
    expect(latestGraphic({ ...quiet, recent_balls: [{ display: "2" } as never] }, 9)).toBeNull();
    expect(latestGraphic({ ...quiet, recent_balls: [{ display: "3" } as never] }, 9)).toBeNull();
    expect(latestGraphic({ ...quiet, recent_balls: [{ display: "5" } as never] }, 9)).toBeNull();
  });

  it("airs four, six, wicket, no-ball and wide", () => {
    const base = { score: { runs: 10, is_free_hit: false } } as CompactState;
    expect(latestGraphic({ ...base, recent_balls: [{ display: "4" } as never] }, 6)).toBe("four");
    expect(latestGraphic({ ...base, recent_balls: [{ display: "6" } as never] }, 6)).toBe("six");
    expect(latestGraphic({ ...base, recent_balls: [{ display: "W" } as never] }, 6)).toBe("wicket");
    expect(latestGraphic({ ...base, recent_balls: [{ display: "1nb" } as never] }, 6)).toBe("no_ball");
    expect(latestGraphic({ ...base, recent_balls: [{ display: "wd" } as never] }, 6)).toBe("wide");
  });
});
