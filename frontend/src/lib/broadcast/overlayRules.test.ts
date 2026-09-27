import { describe, expect, it } from "vitest";

import {
  animationEnabled,
  isCleanCamera,
  showCornerSponsor,
  showScoreBar,
  showTicker,
} from "./overlayRules";
import type { OverlayDirector } from "@/lib/api/types";

function graphics(over: Partial<OverlayDirector> = {}): OverlayDirector {
  return {
    panel: "hidden",
    ticker: "ODCC LIVE",
    ticker_on: true,
    show_tournament: true,
    sponsor_on: true,
    sponsor_logo_url: "https://cdn.example/s.png",
    ...over,
  };
}

describe("overlayRules", () => {
  it("hides the score bar while a presentation panel is on air", () => {
    expect(showScoreBar(graphics({ panel: "squad" }))).toBe(false);
    expect(showScoreBar(graphics({ panel: "summary" }))).toBe(false);
    expect(showTicker(graphics({ panel: "squad" }))).toBe(true);
    expect(showScoreBar(graphics({ panel: "hidden" }))).toBe(true);
  });

  it("clears every overlay in clean camera mode", () => {
    const clean = graphics({ panel: "clean", clean: true, ticker_on: true });
    expect(isCleanCamera(clean)).toBe(true);
    expect(showScoreBar(clean)).toBe(false);
    expect(showTicker(clean)).toBe(false);
    expect(showCornerSponsor(clean)).toBe(false);
    expect(animationEnabled(clean, "four")).toBe(false);
  });

  it("honours per-animation toggles", () => {
    const off = graphics({ anim_four: false });
    expect(animationEnabled(off, "four")).toBe(false);
    expect(animationEnabled(off, "six")).toBe(true);
  });
});
