/**
 * Classify the latest ball for on-screen and burned-in broadcast graphics.
 */

import type { CompactState } from "@/lib/api/types";

export type GraphicKind =
  | "one"
  | "two"
  | "three"
  | "four"
  | "five"
  | "six"
  | "wicket"
  | "wide"
  | "no_ball"
  | "free_hit"
  | "fifty"
  | "century"
  | "team_hundred"
  | null;

/** Full-screen live animations: 4, 6, wicket, no-ball, wide. */
const ON_AIR = new Set<Exclude<GraphicKind, null>>([
  "four",
  "six",
  "wicket",
  "no_ball",
  "wide",
]);

export function classifyBall(display: string | undefined, freeHit: boolean): GraphicKind {
  if (!display) return freeHit ? "free_hit" : null;
  const d = display.toLowerCase();
  if (d.includes("w") && !d.includes("wd")) return "wicket";
  if (d.includes("wd") || d.includes("wide")) return "wide";
  if (d.includes("nb")) return "no_ball";
  if (d === "6" || d.startsWith("6")) return "six";
  if (d === "5" || d.startsWith("5")) return "five";
  if (d === "4" || d.startsWith("4")) return "four";
  if (freeHit) return "free_hit";
  if (d === "3" || d.startsWith("3")) return "three";
  if (d === "2" || d.startsWith("2")) return "two";
  if (d === "1" || d.startsWith("1")) return "one";
  return null;
}

export function detectMilestones(state: CompactState, prevRuns: number | null): GraphicKind {
  const score = state.score;
  if (!score) return null;
  if (prevRuns != null) {
    if (prevRuns < 100 && score.runs >= 100) return "team_hundred";
    if (prevRuns < 200 && score.runs >= 200) return "team_hundred";
  }
  const striker = state.striker;
  if (!striker) return null;
  const last = state.recent_balls?.[state.recent_balls.length - 1];
  const boundaryish =
    last && (last.display === "4" || last.display === "6" || (last.batter_runs ?? 0) >= 1);
  if (!boundaryish) return null;
  if (striker.runs >= 100 && striker.runs < 106) return "century";
  if (striker.runs >= 50 && striker.runs < 56) return "fifty";
  return null;
}

export const GRAPHIC_DIGITS: Partial<Record<Exclude<GraphicKind, null>, string>> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
};

export const GRAPHIC_WORDS: Record<Exclude<GraphicKind, null>, string> = {
  one: "SINGLE",
  two: "TWO",
  three: "THREE",
  four: "FOUR",
  five: "FIVE",
  six: "SIX",
  wicket: "OUT",
  wide: "WIDE",
  no_ball: "NO BALL",
  free_hit: "FREE HIT",
  fifty: "FIFTY",
  century: "CENTURY",
  team_hundred: "100 UP",
};

export function graphicHoldMs(kind: Exclude<GraphicKind, null>, reduce: boolean): number {
  if (reduce) return 900;
  if (kind === "six" || kind === "wicket" || kind === "century") return 3200;
  if (kind === "four" || kind === "five" || kind === "fifty" || kind === "team_hundred") return 2800;
  return 1800;
}

export function latestGraphic(state: CompactState | null, _prevRuns: number | null): GraphicKind {
  if (!state?.recent_balls?.length) return null;
  const last = state.recent_balls[state.recent_balls.length - 1];
  let next = classifyBall(last?.display, Boolean(state.score?.is_free_hit));
  if (next && !ON_AIR.has(next)) return null;
  return next;
}
