/**
 * Worm and run-rate series for the live overlay, from innings over logs.
 */

import type { InningsSnapshot, MatchSnapshot, OverSummary } from "@/lib/api/types";

export interface ChartOverPoint {
  over: number;
  runs: number;
  cumulative: number;
  wickets: number;
  runRate: number;
}

export interface MatchChartSeries {
  label: string;
  color: string;
  points: ChartOverPoint[];
}

const COLORS = ["#2ecc71", "#3498db", "#f1c40f", "#e67e22"];

export function oversToPoints(overs: OverSummary[] | undefined): ChartOverPoint[] {
  let cumulative = 0;
  return (overs ?? []).map((over) => {
    cumulative += over.runs;
    const overNo = Math.max(1, over.over_number);
    return {
      over: over.over_number,
      runs: over.runs,
      cumulative,
      wickets: over.wickets ?? 0,
      runRate: Number((cumulative / overNo).toFixed(2)),
    };
  });
}

export function matchChartSeries(snapshot: MatchSnapshot | null | undefined): MatchChartSeries[] {
  if (!snapshot?.innings?.length) return [];
  return snapshot.innings.slice(0, 2).map((inn, i) => ({
    label: inn.batting_team_name,
    color: COLORS[i % COLORS.length] ?? "#2ecc71",
    points: oversToPoints(inn.state.overs),
  }));
}

export function inningsLabel(innings: InningsSnapshot): string {
  return innings.batting_team_name;
}
