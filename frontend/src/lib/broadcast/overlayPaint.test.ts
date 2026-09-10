import { describe, expect, it } from "vitest";

import { OVERLAY_DESIGNS } from "@/components/broadcast/overlayThemes";

import { designPalette, overlayImage } from "./overlayPaint";

describe("designPalette", () => {
  it("gives each live score design its own colours", () => {
    const keys = OVERLAY_DESIGNS.map((item) => {
      const palette = designPalette(item.id);
      return `${palette.bar}|${palette.barEnd}|${palette.scoreBg}|${palette.scoreFg}`;
    });
    expect(new Set(keys).size).toBe(OVERLAY_DESIGNS.length);
  });

  it("follows the director design id", () => {
    expect(designPalette("classic").id).toBe("classic");
    expect(designPalette("premium").accent).toBe("#f3d36a");
    expect(designPalette("unknown").id).toBe("circle");
  });
});

describe("overlayImage", () => {
  it("does not draw from an empty url", () => {
    expect(overlayImage("")).toBeNull();
    expect(overlayImage(null)).toBeNull();
    expect(overlayImage("   ")).toBeNull();
  });
});
