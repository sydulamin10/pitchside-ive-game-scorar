/**
 * Inputs to the browser scoring engine.
 *
 * These mirror `backend/app/scoring/types.py` field for field. The *output* type
 * is deliberately `InningsState` from the API contract, because the whole point
 * of this port is that a state derived locally while offline is
 * indistinguishable from one the server sends.
 */

import type { ExtraType, WicketType } from "@/lib/api/types";

export interface PlayerRef {
  id: string;
  name: string;
  batting_order?: number;
  is_playing?: boolean;
}

export interface EngineRules {
  balls_per_over: number;
  overs_limit: number | null;
  players_per_side: number;
  max_overs_per_bowler: number | null;
  wide_penalty_runs: number;
  no_ball_penalty_runs: number;
  free_hit_after_no_ball: boolean;
  allow_boundaries: boolean;
  last_batter_can_bat_alone: boolean;
  target_runs: number | null;
  innings_penalty_runs: number;
  forbid_consecutive_overs: boolean;
}

export const DEFAULT_RULES: EngineRules = {
  balls_per_over: 6,
  overs_limit: 20,
  players_per_side: 11,
  max_overs_per_bowler: null,
  wide_penalty_runs: 1,
  no_ball_penalty_runs: 1,
  free_hit_after_no_ball: true,
  allow_boundaries: true,
  last_batter_can_bat_alone: false,
  target_runs: null,
  innings_penalty_runs: 0,
  forbid_consecutive_overs: true,
};

export function makeRules(overrides: Partial<EngineRules> = {}): EngineRules {
  return { ...DEFAULT_RULES, ...overrides };
}

/** Wickets that end the innings. */
export function maxWickets(rules: EngineRules): number {
  if (rules.last_batter_can_bat_alone) return rules.players_per_side;
  return Math.max(1, rules.players_per_side - 1);
}

export function maxLegalBalls(rules: EngineRules): number | null {
  if (rules.overs_limit === null) return null;
  return rules.overs_limit * rules.balls_per_over;
}

export interface EngineDelivery {
  id: string;
  sequence: number;
  striker_id: string;
  non_striker_id: string;
  bowler_id: string;
  batter_runs: number;
  extra_type: ExtraType | null;
  extra_runs: number;
  is_boundary: boolean;
  /**
   * Did the batters finish at opposite ends? Null means "infer it from the runs",
   * which is right for everything except catches, run-outs and boundary wides.
   */
  batters_crossed: boolean | null;
  is_wicket: boolean;
  wicket_type: WicketType | null;
  dismissed_player_id: string | null;
  fielder_id: string | null;
  replacement_batter_id: string | null;
  commentary: string | null;
}

export function makeDelivery(
  partial: Partial<EngineDelivery> &
    Pick<EngineDelivery, "id" | "sequence" | "striker_id" | "non_striker_id" | "bowler_id">,
): EngineDelivery {
  return {
    batter_runs: 0,
    extra_type: null,
    extra_runs: 0,
    is_boundary: false,
    batters_crossed: null,
    is_wicket: false,
    wicket_type: null,
    dismissed_player_id: null,
    fielder_id: null,
    replacement_batter_id: null,
    commentary: null,
    ...partial,
  };
}

/** Does this delivery advance the over count? */
export function isLegal(event: EngineDelivery): boolean {
  return (
    event.extra_type !== "wide" &&
    event.extra_type !== "no_ball" &&
    event.extra_type !== "penalty"
  );
}

/** A wide is not a ball faced; a no-ball is. */
export function isBallFaced(event: EngineDelivery): boolean {
  return event.extra_type !== "wide" && event.extra_type !== "penalty";
}

/** False only for innings-level penalty awards. */
export function isBallEvent(event: EngineDelivery): boolean {
  return event.extra_type !== "penalty";
}

/** An illegal action under the laws of cricket, carrying a machine code. */
export class RuleViolationError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(message: string, code: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "RuleViolationError";
    this.code = code;
    this.details = details;
  }
}

// Dismissal classifications, kept identical to `app/models/enums.py`.

export const BOWLER_CREDITED_WICKETS: readonly WicketType[] = [
  "bowled",
  "caught",
  "caught_and_bowled",
  "lbw",
  "stumped",
  "hit_wicket",
];

/** `retired_hurt` is not a dismissal: the batter may resume and no wicket falls. */
export const NON_DISMISSAL_WICKETS: readonly WicketType[] = ["retired_hurt"];

export const WICKETS_ALLOWED_ON_NO_BALL: readonly WicketType[] = [
  "run_out",
  "obstructing_the_field",
  "hit_ball_twice",
  "retired_out",
  "retired_hurt",
];

export const WICKETS_ALLOWED_ON_WIDE: readonly WicketType[] = [
  "run_out",
  "stumped",
  "hit_wicket",
  "obstructing_the_field",
  "retired_out",
  "retired_hurt",
];

/**
 * Python's `round()` breaks ties to even; JavaScript's breaks them upward.
 * A strike rate of 3.125 must print as 3.12 in both engines, so the tie is
 * handled explicitly.
 */
export function pyRound(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  if (scaled - floor === 0.5) {
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return Math.round(scaled) / factor;
}
