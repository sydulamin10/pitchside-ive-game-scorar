import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiveBroadcastHud } from "./LiveBroadcastHud";
import type { CompactState, OverlayDirector } from "@/lib/api/types";

function hudState(graphics: Partial<OverlayDirector> = {}): CompactState {
  return {
    status: "live",
    state_version: 2,
    innings_sequence: 2,
    title: "Friday gala",
    batting_team: { id: "a", name: "Old Dhaka", short_name: "ODC" },
    bowling_team: { id: "b", name: "Gulshan", short_name: "GCC" },
    score: {
      runs: 88,
      wickets: 2,
      overs_text: "11.3",
      run_rate: 7.6,
      required_run_rate: 8.1,
      target_runs: 151,
      runs_needed: 63,
      balls_remaining: 51,
      extras_total: 4,
      is_free_hit: false,
    },
    graphics: {
      panel: "hidden",
      ticker: "",
      ticker_on: false,
      show_tournament: true,
      design: "classic",
      brand_mode: "name",
      brand_name: "Club Cup",
      sponsor_logo_url: "https://cdn.example/sponsor.png",
      sponsor_on: true,
      ...graphics,
    },
  } as CompactState;
}

describe("LiveBroadcastHud", () => {
  it("shows the selected score design, chase target, corner name and sponsor", () => {
    render(
      <LiveBroadcastHud state={hudState()} snapshot={null} design="classic" tickerFallback="ODCC" />,
    );
    expect(screen.getByTestId("live-broadcast-hud")).toBeInTheDocument();
    expect(screen.getByText("Club Cup")).toBeInTheDocument();
    expect(screen.getAllByAltText("Sponsor").length).toBeGreaterThan(0);
    expect(screen.getByText(/Target 151/i)).toBeInTheDocument();
  });

  it("hides the live score bar while a presentation overlay is on air", () => {
    render(
      <LiveBroadcastHud
        state={hudState({ panel: "sponsor" })}
        snapshot={null}
        design="circle"
        tickerFallback="ODCC"
      />,
    );
    expect(screen.getByText("Sponsors")).toBeInTheDocument();
    expect(screen.queryByText(/Target 151/i)).not.toBeInTheDocument();
  });

  it("puts the sponsor panel on air when the director selects it", () => {
    render(
      <LiveBroadcastHud
        state={hudState({ panel: "sponsor" })}
        snapshot={null}
        design="circle"
        tickerFallback="ODCC"
      />,
    );
    expect(screen.getByText("Sponsors")).toBeInTheDocument();
    expect(screen.getAllByAltText("Sponsor").length).toBeGreaterThan(0);
  });
});
