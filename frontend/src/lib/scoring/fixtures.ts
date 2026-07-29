/**
 * Test harness for `spec/scoring-fixtures.json`.
 *
 * The Python twin lives in `backend/tests/fixture_runner.py` and this file follows
 * it deliberately closely, including the incremental replay: fixture deliveries
 * omit the striker whenever it follows from the previous ball, so the harness asks
 * the engine who is on strike before appending the next one. A rotation bug
 * therefore surfaces as runs credited to the wrong batter.
 */

import specJson from "@spec/scoring-fixtures.json";

import type { ExtraType, InningsState, WicketType } from "@/lib/api/types";

import { buildInningsState } from "./engine";
import { makeRules, type EngineDelivery, type EngineRules, type PlayerRef } from "./types";

interface RawDelivery {
  id?: string;
  striker?: string;
  non_striker?: string;
  bowler?: string;
  runs?: number;
  extra?: ExtraType;
  extra_runs?: number;
  boundary?: boolean;
  crossed?: boolean;
  wicket?: WicketType;
  out?: string;
  fielder?: string;
  new_batter?: string;
  commentary?: string;
}

interface RawPlayer {
  id: string;
  name: string;
  batting_order?: number;
  is_playing?: boolean;
}

export interface ReplayCase {
  name: string;
  rules?: Partial<EngineRules>;
  batting?: RawPlayer[];
  bowling?: RawPlayer[];
  bowlers?: string[];
  deliveries: RawDelivery[];
  expect: Record<string, unknown>;
}

export interface ValidationCase {
  name: string;
  rules?: Partial<EngineRules>;
  deliveries: RawDelivery[];
  candidate: RawDelivery;
  expect_error: string;
}

export interface StandingsCase {
  name: string;
  config: {
    win: number;
    tie: number;
    loss: number;
    no_result: number;
    use_net_run_rate: boolean;
  };
  team_names: Record<string, string>;
  records: Array<{
    team_id: string;
    match_id: string;
    outcome: "win" | "loss" | "tie" | "no_result";
    runs_scored?: number;
    overs_faced?: number;
    runs_conceded?: number;
    overs_bowled?: number;
    counts_for_run_rate?: boolean;
  }>;
  expect: Array<Record<string, unknown>>;
}

interface Spec {
  version: string;
  defaults: {
    rules: Partial<EngineRules>;
    batting: RawPlayer[];
    bowling: RawPlayer[];
    bowlers: string[];
  };
  cases: ReplayCase[];
  validation_cases: ValidationCase[];
  standings_cases: StandingsCase[];
}

export const spec = specJson as unknown as Spec;

function players(raw: RawPlayer[]): PlayerRef[] {
  return raw.map((item) => ({
    id: item.id,
    name: item.name,
    batting_order: item.batting_order ?? 0,
    is_playing: item.is_playing ?? true,
  }));
}

export interface CaseSetup {
  rules: EngineRules;
  batting: PlayerRef[];
  bowling: PlayerRef[];
  bowlerRotation: string[];
}

export function caseSetup(testCase: ReplayCase | ValidationCase): CaseSetup {
  const defaults = spec.defaults;
  return {
    rules: makeRules({ ...defaults.rules, ...(testCase.rules ?? {}) }),
    batting: players(("batting" in testCase && testCase.batting) || defaults.batting),
    bowling: players(("bowling" in testCase && testCase.bowling) || defaults.bowling),
    bowlerRotation: ("bowlers" in testCase && testCase.bowlers) || defaults.bowlers,
  };
}

/** Turn one compact fixture entry into a full delivery. */
export function buildEvent(
  raw: RawDelivery,
  ctx: { index: number; state: InningsState | null; bowlerRotation: string[] },
): EngineDelivery {
  const striker = raw.striker ?? ctx.state?.striker_id ?? null;
  const nonStriker = raw.non_striker ?? ctx.state?.non_striker_id ?? null;
  if (striker === null || nonStriker === null) {
    throw new Error(
      `Fixture delivery #${ctx.index + 1} needs an explicit striker/non_striker: ` +
        "no batter is at that end.",
    );
  }

  let bowler = raw.bowler ?? null;
  if (bowler === null && ctx.state) bowler = ctx.state.current_bowler_id;
  if (bowler === null) {
    const overIndex = ctx.state
      ? Math.floor(ctx.state.legal_balls / ctx.state.balls_per_over)
      : 0;
    bowler = ctx.bowlerRotation[overIndex % ctx.bowlerRotation.length]!;
  }

  const wicket = raw.wicket ?? null;
  return {
    id: raw.id ?? `d${ctx.index + 1}`,
    sequence: ctx.index + 1,
    striker_id: striker,
    non_striker_id: nonStriker,
    bowler_id: bowler,
    batter_runs: raw.runs ?? 0,
    extra_type: raw.extra ?? null,
    extra_runs: raw.extra_runs ?? 0,
    is_boundary: raw.boundary ?? false,
    batters_crossed: raw.crossed ?? null,
    is_wicket: wicket !== null,
    wicket_type: wicket,
    dismissed_player_id: raw.out ?? null,
    fielder_id: raw.fielder ?? null,
    replacement_batter_id: raw.new_batter ?? null,
    commentary: raw.commentary ?? null,
  };
}

export function replayCase(testCase: ReplayCase | ValidationCase): {
  state: InningsState;
  events: EngineDelivery[];
  setup: CaseSetup;
} {
  const setup = caseSetup(testCase);
  const events: EngineDelivery[] = [];
  let state: InningsState | null = null;
  testCase.deliveries.forEach((raw, index) => {
    events.push(buildEvent(raw, { index, state, bowlerRotation: setup.bowlerRotation }));
    state = buildInningsState(setup.rules, setup.batting, setup.bowling, events);
  });
  state ??= buildInningsState(setup.rules, setup.batting, setup.bowling, []);
  return { state, events, setup };
}

/** The candidate delivery for a validation fixture: not appended, just checked. */
export function buildCandidate(
  testCase: ValidationCase,
  state: InningsState,
  setup: CaseSetup,
): EngineDelivery {
  const raw = testCase.candidate;
  const event = buildEvent(raw, {
    index: testCase.deliveries.length,
    state,
    bowlerRotation: setup.bowlerRotation,
  });
  // Validation fixtures deliberately probe illegal personnel, so honour the
  // literal values whenever they are given.
  return {
    ...event,
    striker_id: raw.striker ?? event.striker_id,
    non_striker_id: raw.non_striker ?? event.non_striker_id,
    bowler_id: raw.bowler ?? event.bowler_id,
  };
}
