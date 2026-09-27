import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EventGraphics } from "./EventGraphics";
import type { CompactState } from "@/lib/api/types";

function frame(display: string, extra: Partial<CompactState> = {}, deliveryId = `d-${display}`): CompactState {
  return {
    status: "live",
    state_version: 4,
    score: {
      runs: 48,
      wickets: 1,
      overs_text: "6.2",
      run_rate: 7.5,
      required_run_rate: null,
      target_runs: null,
      runs_needed: null,
      balls_remaining: null,
      extras_total: 2,
      is_free_hit: false,
    },
    striker: {
      player_id: "p1",
      name: "Rakib Hasan",
      runs: 24,
      balls_faced: 14,
      fours: 2,
      sixes: 1,
      strike_rate: 171,
    },
    recent_balls: [
      {
        delivery_id: deliveryId,
        sequence: extra.state_version ?? 1,
        over_number: 6,
        ball_in_over: 2,
        over_ball_text: "6.2",
        display,
        runs_total: Number.parseInt(display, 10) || 0,
        batter_runs: Number.parseInt(display, 10) || 0,
        extra_type: null,
        extra_runs: 0,
        is_wicket: display.toLowerCase() === "w",
        is_legal: true,
        is_free_hit: false,
        striker_id: "p1",
        striker_name: "Rakib Hasan",
        bowler_id: "p9",
        bowler_name: "Karim",
        commentary: null,
      },
    ],
    ...extra,
  } as CompactState;
}

describe("EventGraphics", () => {
  it("sweeps FOUR across the frame", async () => {
    render(<EventGraphics state={frame("4")} />);
    expect(await screen.findByText("FOUR")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("booms SIX", async () => {
    render(<EventGraphics state={frame("6")} />);
    expect(await screen.findByText("SIX")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });

  it("ribbons NO BALL", async () => {
    render(<EventGraphics state={frame("1nb")} />);
    expect(await screen.findByText("NO BALL")).toBeInTheDocument();
  });

  it("ribbons WIDE", async () => {
    render(<EventGraphics state={frame("wd")} />);
    expect(await screen.findByText("WIDE")).toBeInTheDocument();
  });

  it("stamps OUT on a wicket", async () => {
    render(<EventGraphics state={frame("W")} />);
    expect(await screen.findByText("OUT")).toBeInTheDocument();
  });

  it("replays FOUR when a second four arrives with a new delivery id", async () => {
    const { rerender } = render(<EventGraphics state={frame("4")} />);
    expect(await screen.findByText("FOUR")).toBeInTheDocument();
    rerender(<EventGraphics state={frame("4", { state_version: 5 }, "d-4-b")} />);
    expect(await screen.findByText("FOUR")).toBeInTheDocument();
  });

  it("does not animate singles, twos, threes or fives", () => {
    const { rerender } = render(<EventGraphics state={frame("1")} />);
    expect(screen.queryByText("SINGLE")).not.toBeInTheDocument();
    rerender(<EventGraphics state={frame("2")} />);
    expect(screen.queryByText("TWO")).not.toBeInTheDocument();
    rerender(<EventGraphics state={frame("3")} />);
    expect(screen.queryByText("THREE")).not.toBeInTheDocument();
    rerender(<EventGraphics state={frame("5")} />);
    expect(screen.queryByText("FIVE")).not.toBeInTheDocument();
  });
});
