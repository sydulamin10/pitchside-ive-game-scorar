import { describe, expect, it } from "vitest";
import { isUnreachableLoopbackWhip, videoBitrateForHeight } from "./whipPublish";

describe("isUnreachableLoopbackWhip", () => {
  it("blocks localhost WHIP when the page is on a public host", () => {
    expect(
      isUnreachableLoopbackWhip("http://localhost:8889/pitchside/abc/whip", "web.odcc.nextframesoft.com"),
    ).toBe(true);
  });

  it("allows localhost WHIP during local development", () => {
    expect(isUnreachableLoopbackWhip("http://localhost:8889/pitchside/abc/whip", "localhost")).toBe(
      false,
    );
  });
});

describe("videoBitrateForHeight", () => {
  it("uses cricket-safe CBR ceilings for 480p, 720p, and 1080p", () => {
    expect(videoBitrateForHeight(480)).toBe(1_400_000);
    expect(videoBitrateForHeight(720)).toBe(2_500_000);
    expect(videoBitrateForHeight(1080)).toBe(3_800_000);
  });
});
