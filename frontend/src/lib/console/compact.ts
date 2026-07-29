/**
 * Building the compact frame locally.
 *
 * The scoreboard component is fed by the realtime frame, and the console has to
 * render the same board from state it derived itself while offline. This mirrors
 * `MatchSnapshot.compact()` on the server so the board never has two code paths.
 */

import type {
  BatterLine,
  BowlerLine,
  CompactState,
  InningsSnapshot,
  MatchSnapshot,
} from "@/lib/api/types";

function batterLine(innings: InningsSnapshot, playerId: string | null): BatterLine | null {
  if (!playerId) return null;
  const batter = innings.state.batting.find((b) => b.player_id === playerId);
  if (!batter) return null;
  return {
    player_id: batter.player_id,
    name: batter.name,
    runs: batter.runs,
    balls_faced: batter.balls_faced,
    fours: batter.fours,
    sixes: batter.sixes,
    strike_rate: batter.strike_rate,
  };
}

function bowlerLine(innings: InningsSnapshot, playerId: string | null): BowlerLine | null {
  if (!playerId) return null;
  const bowler = innings.state.bowling.find((b) => b.player_id === playerId);
  if (!bowler) return null;
  return {
    player_id: bowler.player_id,
    name: bowler.name,
    overs_text: bowler.overs_text,
    runs_conceded: bowler.runs_conceded,
    wickets: bowler.wickets,
    economy: bowler.economy,
    maidens: bowler.maidens,
  };
}

export function compactFromSnapshot(
  snapshot: MatchSnapshot,
  innings: InningsSnapshot | null,
): CompactState {
  const base: CompactState = {
    status: snapshot.match.status,
    state_version: snapshot.match.state_version,
    title: snapshot.match.title,
    result_summary: snapshot.result.summary,
  };
  if (!innings) return base;

  const teams = [snapshot.match.teams.a, snapshot.match.teams.b];
  const state = innings.state;
  const timeline = state.timeline ?? state.recent_balls ?? [];

  return {
    ...base,
    innings_id: innings.id,
    innings_sequence: innings.sequence,
    batting_team: teams.find((team) => team.id === innings.batting_team_id),
    bowling_team: teams.find((team) => team.id === innings.bowling_team_id),
    score: {
      runs: state.total_runs,
      wickets: state.wickets,
      overs_text: state.overs_text,
      run_rate: state.run_rate,
      required_run_rate: state.required_run_rate,
      target_runs: state.target_runs,
      runs_needed: state.runs_needed,
      balls_remaining: state.balls_remaining,
      extras_total: state.extras.total,
      is_free_hit: state.is_free_hit,
    },
    striker: batterLine(innings, state.striker_id),
    non_striker: batterLine(innings, state.non_striker_id),
    bowler: bowlerLine(innings, state.current_bowler_id),
    current_partnership: state.current_partnership,
    recent_balls: timeline.slice(-8),
    next_action: state.next_action,
  };
}
