/**
 * Points table and Net Run Rate, ported from `backend/app/scoring/standings.py`.
 *
 *     NRR = (runs scored / overs faced) − (runs conceded / overs bowled)
 *
 * The browser copy lets a tournament organiser see the effect of a result while
 * offline, and gives the shared fixtures a second implementation to disagree
 * with if either side drifts.
 */

import type { StandingRow } from "@/lib/api/types";

import { pyRound } from "./types";

export interface PointsConfig {
  win: number;
  tie: number;
  loss: number;
  no_result: number;
  use_net_run_rate: boolean;
}

export const DEFAULT_POINTS: PointsConfig = {
  win: 2,
  tie: 1,
  loss: 0,
  no_result: 1,
  use_net_run_rate: true,
};

export type MatchOutcome = "win" | "loss" | "tie" | "no_result";

/** One team's contribution from one completed match. */
export interface TeamMatchRecord {
  team_id: string;
  match_id: string;
  outcome: MatchOutcome;
  runs_scored?: number;
  overs_faced?: number;
  runs_conceded?: number;
  overs_bowled?: number;
  counts_for_run_rate?: boolean;
}

interface Accumulator {
  team_id: string;
  team_name: string;
  group_id: string | null;
  group_name: string | null;
  played: number;
  won: number;
  lost: number;
  tied: number;
  no_result: number;
  points: number;
  runs_scored: number;
  overs_faced: number;
  runs_conceded: number;
  overs_bowled: number;
  points_adjustment: number;
  form: string[];
}

function netRunRate(row: Accumulator): number {
  if (row.overs_faced <= 0 && row.overs_bowled <= 0) return 0;
  const scored = row.overs_faced > 0 ? row.runs_scored / row.overs_faced : 0;
  const conceded = row.overs_bowled > 0 ? row.runs_conceded / row.overs_bowled : 0;
  return pyRound(scored - conceded, 3);
}

export function computeStandings(
  records: readonly TeamMatchRecord[],
  options: {
    config?: PointsConfig;
    teamNames?: Record<string, string>;
    teamGroups?: Record<string, { id: string | null; name: string | null }>;
    pointsAdjustments?: Record<string, number>;
  } = {},
): StandingRow[] {
  const config = options.config ?? DEFAULT_POINTS;
  const names = options.teamNames ?? {};
  const groups = options.teamGroups ?? {};
  const adjustments = options.pointsAdjustments ?? {};

  const rows = new Map<string, Accumulator>();
  const seed = (teamId: string): Accumulator => {
    let row = rows.get(teamId);
    if (!row) {
      const group = groups[teamId];
      row = {
        team_id: teamId,
        team_name: names[teamId] ?? "",
        group_id: group?.id ?? null,
        group_name: group?.name ?? null,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        no_result: 0,
        points: 0,
        runs_scored: 0,
        overs_faced: 0,
        runs_conceded: 0,
        overs_bowled: 0,
        points_adjustment: adjustments[teamId] ?? 0,
        form: [],
      };
      rows.set(teamId, row);
    }
    return row;
  };

  for (const teamId of new Set([
    ...records.map((r) => r.team_id),
    ...Object.keys(names),
    ...Object.keys(groups),
  ])) {
    seed(teamId);
  }

  for (const record of records) {
    const row = seed(record.team_id);
    row.played += 1;
    switch (record.outcome) {
      case "win":
        row.won += 1;
        row.points += config.win;
        row.form.push("W");
        break;
      case "loss":
        row.lost += 1;
        row.points += config.loss;
        row.form.push("L");
        break;
      case "tie":
        row.tied += 1;
        row.points += config.tie;
        row.form.push("T");
        break;
      default:
        row.no_result += 1;
        row.points += config.no_result;
        row.form.push("N");
        break;
    }
    if (record.counts_for_run_rate !== false) {
      row.runs_scored += record.runs_scored ?? 0;
      row.overs_faced += record.overs_faced ?? 0;
      row.runs_conceded += record.runs_conceded ?? 0;
      row.overs_bowled += record.overs_bowled ?? 0;
    }
  }

  const ordered = [...rows.values()].sort((a, b) => {
    const pa = a.points + a.points_adjustment;
    const pb = b.points + b.points_adjustment;
    if (pa !== pb) return pb - pa;
    if (config.use_net_run_rate) {
      const na = netRunRate(a);
      const nb = netRunRate(b);
      if (na !== nb) return nb - na;
    }
    if (a.won !== b.won) return b.won - a.won;
    const ka = a.team_name.toLowerCase() || a.team_id;
    const kb = b.team_name.toLowerCase() || b.team_id;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Position is per-group when groups are in play, otherwise overall.
  const counters = new Map<string | null, number>();
  return ordered.map((row) => {
    const seen = (counters.get(row.group_id) ?? 0) + 1;
    counters.set(row.group_id, seen);
    return {
      team_id: row.team_id,
      team_name: row.team_name,
      group_id: row.group_id,
      group_name: row.group_name,
      position: seen,
      played: row.played,
      won: row.won,
      lost: row.lost,
      tied: row.tied,
      no_result: row.no_result,
      points: row.points + row.points_adjustment,
      points_adjustment: 0,
      runs_scored: row.runs_scored,
      overs_faced: pyRound(row.overs_faced, 3),
      runs_conceded: row.runs_conceded,
      overs_bowled: pyRound(row.overs_bowled, 3),
      run_rate_for: row.overs_faced > 0 ? pyRound(row.runs_scored / row.overs_faced, 3) : 0,
      run_rate_against:
        row.overs_bowled > 0 ? pyRound(row.runs_conceded / row.overs_bowled, 3) : 0,
      net_run_rate: netRunRate(row),
      form: row.form.slice(-5),
    };
  });
}
