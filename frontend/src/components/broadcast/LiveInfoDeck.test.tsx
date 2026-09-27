import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LiveInfoDeck } from "./LiveInfoDeck";
import type {
  BatterCard,
  BowlerCard,
  CompactState,
  InningsSnapshot,
  MatchSnapshot,
} from "@/lib/api/types";

function batter(over: Partial<BatterCard> & { player_id: string; name: string }): BatterCard {
  return {
    batting_position: 1,
    runs: 0,
    balls_faced: 0,
    fours: 0,
    sixes: 0,
    dots: 0,
    strike_rate: 0,
    status: "not_out",
    is_out: false,
    has_batted: false,
    wicket_type: null,
    dismissal_text: null,
    dismissed_by_bowler_id: null,
    fielder_id: null,
    is_striker: false,
    is_non_striker: false,
    ...over,
  } as BatterCard;
}

function bowler(over: Partial<BowlerCard> & { player_id: string; name: string }): BowlerCard {
  return {
    balls_bowled: 0,
    overs_text: "0.0",
    overs_decimal: 0,
    runs_conceded: 0,
    wickets: 0,
    maidens: 0,
    wides: 0,
    no_balls: 0,
    dots: 0,
    fours_conceded: 0,
    sixes_conceded: 0,
    economy: 0,
    is_current_bowler: false,
    ...over,
  } as BowlerCard;
}

function innings(sequence: number, over: Partial<InningsSnapshot> = {}): InningsSnapshot {
  return {
    id: `innings-${sequence}`,
    sequence,
    status: "in_progress",
    batting_team_id: "team-a",
    bowling_team_id: "team-b",
    batting_team_name: sequence === 1 ? "Old Dhaka" : "Gulshan CC",
    bowling_team_name: sequence === 1 ? "Gulshan CC" : "Old Dhaka",
    is_super_over: false,
    is_follow_on: false,
    overs_limit: 20,
    target_runs: null,
    penalty_runs: 0,
    end_reason: null,
    state: {
      total_runs: 142,
      wickets: 3,
      legal_balls: 86,
      balls_per_over: 6,
      overs_text: "14.2",
      overs_decimal: 14.33,
      run_rate: 9.9,
      required_run_rate: null,
      projected_score: 198,
      balls_remaining: 34,
      wickets_remaining: 7,
      runs_needed: null,
      target_runs: null,
      overs_limit: 20,
      max_wickets: 10,
      is_all_out: false,
      is_complete: false,
      end_reason: null,
      next_action: "next_ball",
      is_free_hit: false,
      striker_id: "p1",
      non_striker_id: "p2",
      current_bowler_id: "p9",
      previous_over_bowler_id: null,
      extras: { wide: 3, no_ball: 1, bye: 0, leg_bye: 2, penalty: 0, total: 6 },
      batting: [
        batter({
          player_id: "p1",
          name: "Rakib Hasan",
          runs: 62,
          balls_faced: 38,
          fours: 5,
          sixes: 3,
          strike_rate: 163.2,
          has_batted: true,
          is_striker: true,
        }),
        batter({
          player_id: "p2",
          name: "Imran Kabir",
          runs: 24,
          balls_faced: 19,
          strike_rate: 126.3,
          has_batted: true,
          is_non_striker: true,
        }),
        batter({ player_id: "p3", name: "Sabbir Ahmed" }),
      ],
      bowling: [
        bowler({
          player_id: "p9",
          name: "Karim Sheikh",
          balls_bowled: 20,
          overs_text: "3.2",
          runs_conceded: 28,
          wickets: 2,
          economy: 8.4,
          is_current_bowler: true,
        }),
      ],
      partnerships: [],
      current_partnership: {
        wicket_number: 4,
        batter_a_id: "p1",
        batter_a_name: "Rakib Hasan",
        batter_a_runs: 62,
        batter_b_id: "p2",
        batter_b_name: "Imran Kabir",
        batter_b_runs: 24,
        runs: 86,
        balls: 57,
        is_current: true,
      },
      fall_of_wickets: [
        {
          wicket_number: 1,
          runs_at_fall: 18,
          overs_text: "2.4",
          batter_id: "p4",
          batter_name: "Nayeem Islam",
          dismissal_text: "c Karim b Jibon",
        },
      ],
      available_batter_ids: [],
      ineligible_bowler_ids: [],
      warnings: [],
      overs: [],
    },
    ...over,
  } as InningsSnapshot;
}

const snapshot = {
  match: {
    teams: {
      a: { id: "team-a", name: "Old Dhaka" },
      b: { id: "team-b", name: "Gulshan CC" },
    },
  },
  innings: [innings(1)],
  current_innings_id: "innings-1",
  squads: {
    "team-a": [
      {
        id: "s1",
        player_id: "p1",
        team_id: "team-a",
        name: "Rakib Hasan",
        batting_order: 1,
        is_captain: true,
        is_wicket_keeper: false,
        is_playing: true,
        is_substitute: false,
      },
    ],
    "team-b": [
      {
        id: "s2",
        player_id: "p9",
        team_id: "team-b",
        name: "Karim Sheikh",
        batting_order: 1,
        is_captain: false,
        is_wicket_keeper: true,
        is_playing: true,
        is_substitute: false,
      },
    ],
  },
} as unknown as MatchSnapshot;

const state = {
  status: "live",
  state_version: 12,
  batting_team: { id: "team-a", name: "Old Dhaka", short_name: "ODC" },
  bowling_team: { id: "team-b", name: "Gulshan CC", short_name: "GCC" },
  score: {
    runs: 142,
    wickets: 3,
    overs_text: "14.2",
    run_rate: 9.9,
    required_run_rate: null,
    target_runs: null,
    runs_needed: null,
    balls_remaining: 34,
    extras_total: 6,
    is_free_hit: false,
  },
  striker: {
    player_id: "p1",
    name: "Rakib Hasan",
    runs: 62,
    balls_faced: 38,
    fours: 5,
    sixes: 3,
    strike_rate: 163.2,
  },
  non_striker: {
    player_id: "p2",
    name: "Imran Kabir",
    runs: 24,
    balls_faced: 19,
    fours: 1,
    sixes: 0,
    strike_rate: 126.3,
  },
  bowler: {
    player_id: "p9",
    name: "Karim Sheikh",
    overs_text: "3.2",
    runs_conceded: 28,
    wickets: 2,
    economy: 8.4,
    maidens: 0,
  },
  recent_balls: [
    {
      delivery_id: "d1",
      sequence: 85,
      over_number: 14,
      ball_in_over: 1,
      over_ball_text: "14.1",
      display: "4",
      runs_total: 4,
      batter_runs: 4,
      extra_type: null,
      extra_runs: 0,
      is_wicket: false,
      is_legal: true,
      is_free_hit: false,
      striker_id: "p1",
      striker_name: "Rakib Hasan",
      bowler_id: "p9",
      bowler_name: "Karim Sheikh",
      commentary: null,
    },
  ],
} as unknown as CompactState;

describe("LiveInfoDeck", () => {
  it("renders a tab per panel", () => {
    render(<LiveInfoDeck state={state} snapshot={snapshot} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Live",
      "Card",
      "Overs",
      "Worm",
      "Run rate",
      "1st",
      "2nd",
      "Squads",
      "Summary",
      "Sponsor",
    ]);
  });

  it("shows the crease, the bowler and the over on the live panel", () => {
    render(<LiveInfoDeck state={state} snapshot={snapshot} panels={["live"]} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Rakib Hasan")).toBeInTheDocument();
    expect(within(panel).getByText("62 (38)")).toBeInTheDocument();
    expect(within(panel).getByText("Imran Kabir")).toBeInTheDocument();
    // overs-maidens-runs-wickets
    expect(within(panel).getByText("3.2-0-28-2")).toBeInTheDocument();
    expect(within(panel).getByText("Partnership 86 (57)")).toBeInTheDocument();
  });

  it("renders the batting card with extras and a total", () => {
    render(<LiveInfoDeck state={state} snapshot={snapshot} panels={["scorecard"]} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("142/3")).toBeInTheDocument();
    expect(within(panel).getByText(/Yet to bat:/)).toBeInTheDocument();
    expect(within(panel).getByText(/Sabbir Ahmed/)).toBeInTheDocument();
    expect(within(panel).getByText(/Fall of wickets:/)).toBeInTheDocument();
    expect(within(panel).getByText("Karim Sheikh")).toBeInTheDocument();
  });

  it("says an innings has not started rather than rendering an empty card", () => {
    render(<LiveInfoDeck state={state} snapshot={snapshot} panels={["innings2"]} />);
    expect(screen.getByText("Not started.")).toBeInTheDocument();
  });

  it("lists both squads with captain and keeper marks", () => {
    render(<LiveInfoDeck state={state} snapshot={snapshot} panels={["squad"]} />);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Old Dhaka")).toBeInTheDocument();
    expect(within(panel).getByText("Gulshan CC")).toBeInTheDocument();
    expect(within(panel).getByText("(c)")).toBeInTheDocument();
    expect(within(panel).getByText("(wk)")).toBeInTheDocument();
  });

  it("shows the chase target on the live panel", () => {
    render(
      <LiveInfoDeck
        state={{
          ...state,
          innings_sequence: 2,
          score: {
            ...state.score!,
            target_runs: 151,
            runs_needed: 9,
            balls_remaining: 34,
          },
        }}
        snapshot={snapshot}
        panels={["live"]}
      />,
    );
    expect(screen.getByText("Target 151")).toBeInTheDocument();
    expect(screen.getByText(/Need 9 from 34/)).toBeInTheDocument();
  });

  it("survives having no live state at all", () => {
    render(<LiveInfoDeck state={null} snapshot={null} panels={["live", "scorecard"]} />);
    expect(screen.getByText("Waiting for the first ball…")).toBeInTheDocument();
  });

  it("shows over analysis bars and the bowler", () => {
    const first = innings(1);
    const withOvers: MatchSnapshot = {
      ...snapshot,
      innings: [
        {
          ...first,
          state: {
            ...first.state,
            overs: [
              {
                over_number: 1,
                bowler_id: "p9",
                bowler_name: "Karim Sheikh",
                runs: 12,
                wickets: 0,
                is_maiden: false,
                is_complete: true,
                balls: [],
              },
              {
                over_number: 2,
                bowler_id: "p9",
                bowler_name: "Karim Sheikh",
                runs: 8,
                wickets: 1,
                is_maiden: false,
                is_complete: true,
                balls: [],
              },
            ],
          },
        },
      ],
    };
    render(<LiveInfoDeck state={state} snapshot={withOvers} panels={["over"]} />);
    expect(screen.getByText("Runs per over")).toBeInTheDocument();
    expect(screen.getAllByText(/Karim Sheikh/).length).toBeGreaterThan(0);
  });
});
