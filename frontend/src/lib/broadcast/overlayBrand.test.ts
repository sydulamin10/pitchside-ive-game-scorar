import { describe, expect, it } from "vitest";

import { overlayBrandLogo, overlayBrandMode, overlayBrandName } from "./overlayBrand";
import type { CompactState } from "@/lib/api/types";

function state(over: Partial<CompactState> = {}): CompactState {
  return {
    status: "live",
    state_version: 1,
    ...over,
  } as CompactState;
}

describe("overlayBrand", () => {
  it("hides the corner when the director picks nothing", () => {
    expect(overlayBrandMode(state({ graphics: { brand_mode: "none" } as never }))).toBe("none");
  });

  it("uses a custom name on a one-off match", () => {
    const frame = state({
      title: "Friday gala",
      graphics: { brand_mode: "name", brand_name: "Club Cup" } as never,
    });
    expect(overlayBrandMode(frame)).toBe("name");
    expect(overlayBrandName(frame)).toBe("Club Cup");
  });

  it("falls back to tournament name, then the match title", () => {
    expect(
      overlayBrandName(
        state({
          tournament: { id: "t", name: "ODCL", slug: "odcl", round: null },
          graphics: { brand_mode: "name" } as never,
        }),
      ),
    ).toBe("ODCL");
    expect(overlayBrandName(state({ title: "Street match", graphics: { brand_mode: "name" } as never }))).toBe(
      "Street match",
    );
  });

  it("prefers a custom logo over the tournament logo", () => {
    const frame = state({
      tournament: { id: "t", name: "ODCL", slug: "odcl", round: null, logo_url: "/t.png" },
      graphics: { brand_mode: "logo", brand_logo_url: "/custom.png" } as never,
    });
    expect(overlayBrandMode(frame)).toBe("logo");
    expect(overlayBrandLogo(frame)).toBe("/custom.png");
  });
});
