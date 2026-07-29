/**
 * The scoring engine, plus the adapters that turn API payloads into engine input.
 *
 * The console uses this to do two things the server would otherwise have to be
 * online for: refuse an impossible tap immediately, and show the score that a
 * queued ball will produce once it syncs.
 */

import type {
  DeliveryInput,
  DeliveryLogEntry,
  InningsSnapshot,
  MatchHeader,
  MatchSnapshot,
  SquadMember,
} from "@/lib/api/types";

import { buildInningsState } from "./engine";
import { makeRules, type EngineDelivery, type EngineRules, type PlayerRef } from "./types";

export {
  buildInningsState,
  describeDismissal,
  formatBall,
  replay,
  validateDelivery,
  type ReplayResult,
  type StrikeRepair,
} from "./engine";
export {
  DEFAULT_RULES,
  RuleViolationError,
  isBallFaced,
  isLegal,
  makeDelivery,
  makeRules,
  maxWickets,
  type EngineDelivery,
  type EngineRules,
  type PlayerRef,
} from "./types";
export {
  DEFAULT_POINTS,
  computeStandings,
  type MatchOutcome,
  type PointsConfig,
  type TeamMatchRecord,
} from "./standings";

/** Mirror of `match_query._rules_for`: the rules that govern one innings. */
export function engineRules(header: MatchHeader, innings: InningsSnapshot): EngineRules {
  const rules = header.rules;
  return makeRules({
    balls_per_over: rules.balls_per_over,
    overs_limit: innings.overs_limit ?? rules.overs_limit,
    players_per_side: rules.players_per_side,
    max_overs_per_bowler: rules.max_overs_per_bowler,
    wide_penalty_runs: rules.wide_penalty_runs,
    no_ball_penalty_runs: rules.no_ball_penalty_runs,
    free_hit_after_no_ball: rules.free_hit_after_no_ball,
    allow_boundaries: rules.allow_boundaries,
    last_batter_can_bat_alone: rules.last_batter_can_bat_alone,
    target_runs: innings.target_runs,
    innings_penalty_runs: innings.penalty_runs ?? 0,
    forbid_consecutive_overs: rules.overrides?.allow_consecutive_overs !== true,
  });
}

export function squadRefs(members: readonly SquadMember[] | undefined): PlayerRef[] {
  return (members ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    batting_order: m.batting_order,
    is_playing: m.is_playing,
  }));
}

/** The batting and bowling sides for an innings, as the engine wants them. */
export function inningsSides(
  snapshot: MatchSnapshot,
  innings: InningsSnapshot,
): { batting: PlayerRef[]; bowling: PlayerRef[] } {
  const squads = snapshot.squads ?? {};
  return {
    batting: squadRefs(squads[innings.batting_team_id]),
    bowling: squadRefs(squads[innings.bowling_team_id]),
  };
}

export function deliveryFromLog(entry: DeliveryLogEntry): EngineDelivery {
  return {
    id: entry.id,
    sequence: entry.sequence,
    striker_id: entry.striker_id,
    non_striker_id: entry.non_striker_id,
    bowler_id: entry.bowler_id,
    batter_runs: entry.batter_runs,
    extra_type: entry.extra_type,
    extra_runs: entry.extra_runs,
    is_boundary: entry.is_boundary,
    batters_crossed: entry.batters_crossed,
    is_wicket: entry.is_wicket,
    wicket_type: entry.wicket_type,
    dismissed_player_id: entry.dismissed_player_id,
    fielder_id: entry.fielder_id,
    replacement_batter_id: entry.replacement_batter_id ?? null,
    commentary: entry.commentary,
  };
}

/** A not-yet-sent ball, as the console has it in hand. */
export function deliveryFromInput(
  input: DeliveryInput,
  meta: { id: string; sequence: number },
): EngineDelivery {
  return {
    id: meta.id,
    sequence: meta.sequence,
    striker_id: input.striker_id,
    non_striker_id: input.non_striker_id,
    bowler_id: input.bowler_id,
    batter_runs: input.batter_runs ?? 0,
    extra_type: input.extra_type ?? null,
    extra_runs: input.extra_runs ?? 0,
    is_boundary: input.is_boundary ?? false,
    batters_crossed: input.batters_crossed ?? null,
    is_wicket: input.is_wicket ?? false,
    wicket_type: input.wicket_type ?? null,
    dismissed_player_id: input.dismissed_player_id ?? null,
    fielder_id: input.fielder_id ?? null,
    replacement_batter_id: input.replacement_batter_id ?? null,
    commentary: input.commentary ?? null,
  };
}

/**
 * Replay a known-good log plus anything still queued locally.
 *
 * `pending` are balls the server has not acknowledged yet; their sequences follow
 * the log, which is exactly how the server will number them when the queue drains.
 */
export function projectInnings(
  snapshot: MatchSnapshot,
  innings: InningsSnapshot,
  log: readonly DeliveryLogEntry[],
  pending: readonly DeliveryInput[] = [],
) {
  const rules = engineRules(snapshot.match, innings);
  const { batting, bowling } = inningsSides(snapshot, innings);
  const events = log
    .filter((entry) => entry.innings_id === innings.id)
    .map(deliveryFromLog)
    .sort((a, b) => a.sequence - b.sequence);
  let sequence = events.length > 0 ? events[events.length - 1]!.sequence : 0;
  for (const [index, input] of pending.entries()) {
    sequence += 1;
    events.push(deliveryFromInput(input, { id: `pending-${index}`, sequence }));
  }
  return buildInningsState(rules, batting, bowling, events);
}
