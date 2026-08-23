import { describe, expect, it } from "vitest";
import { isUnreachableLoopbackWhip } from "./whipPublish";

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
