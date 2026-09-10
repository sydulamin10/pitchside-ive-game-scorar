import { describe, expect, it } from "vitest";

import { chaseCaption } from "./chase";

describe("chaseCaption", () => {
  it("shows Target and Need for a chasing innings", () => {
    expect(
      chaseCaption(
        {
          runs: 40,
          wickets: 1,
          overs_text: "5.0",
          run_rate: 8,
          required_run_rate: 7.2,
          target_runs: 151,
          runs_needed: 111,
          balls_remaining: 90,
          extras_total: 2,
          is_free_hit: false,
        },
        2,
      ),
    ).toBe("Target 151 · Need 111 from 90");
  });

  it("still names the chase when only the innings sequence is known", () => {
    expect(
      chaseCaption(
        {
          runs: 0,
          wickets: 0,
          overs_text: "0.0",
          run_rate: 0,
          required_run_rate: null,
          target_runs: null,
          runs_needed: null,
          balls_remaining: 120,
          extras_total: 0,
          is_free_hit: false,
        },
        2,
      ),
    ).toBe("Chase");
  });
});
