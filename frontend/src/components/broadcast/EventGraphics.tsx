/**
 * Full-screen event + milestone graphics for overlay and camera studio.
 * Driven by the latest ball in the compact SSE frame.
 */

import { useEffect, useRef, useState } from "react";

import { useLastEventKey } from "@/components/broadcast/useLastEventKey";
import type { CompactState } from "@/lib/api/types";
import { cn } from "@/lib/utils";

type GraphicKind =
  | "four"
  | "six"
  | "wicket"
  | "wide"
  | "no_ball"
  | "free_hit"
  | "fifty"
  | "century"
  | "team_hundred"
  | null;

function classifyBall(display: string | undefined, freeHit: boolean): GraphicKind {
  if (freeHit) return "free_hit";
  if (!display) return null;
  const d = display.toLowerCase();
  if (d.includes("w") && !d.includes("wd")) return "wicket";
  if (d === "6" || /^6/.test(d) || d.includes("6")) return "six";
  if (d === "4" || /^4/.test(d)) return "four";
  if (d.includes("wd") || d.includes("wide")) return "wide";
  if (d.includes("nb")) return "no_ball";
  return null;
}

function detectMilestones(
  state: CompactState,
  prevRuns: number | null,
): GraphicKind {
  const score = state.score;
  if (!score) return null;
  if (prevRuns != null) {
    if (prevRuns < 100 && score.runs >= 100) return "team_hundred";
    if (prevRuns < 200 && score.runs >= 200) return "team_hundred";
  }
  const striker = state.striker;
  if (striker) {
    // Milestone on the strike batter when their score crosses thresholds.
    if (striker.runs >= 100 && striker.runs - (striker.balls_faced > 0 ? 0 : 0) <= 106) {
      // Soft signal: if last ball was boundary and runs in 100-106 range
      const last = state.recent_balls?.[state.recent_balls.length - 1];
      if (last && (last.display === "4" || last.display === "6" || last.batter_runs >= 4)) {
        if (striker.runs >= 100 && striker.runs < 106) return "century";
        if (striker.runs >= 50 && striker.runs < 56) return "fifty";
      }
    }
    if (striker.runs >= 50 && striker.runs < 56) {
      const last = state.recent_balls?.[state.recent_balls.length - 1];
      if (last && (last.display === "4" || last.display === "6" || (last.batter_runs ?? 0) >= 1)) {
        if (striker.runs < 100) return "fifty";
      }
    }
  }
  return null;
}

const LABELS: Record<Exclude<GraphicKind, null>, string> = {
  four: "FOUR",
  six: "SIX",
  wicket: "OUT",
  wide: "WIDE",
  no_ball: "NO BALL",
  free_hit: "FREE HIT",
  fifty: "FIFTY",
  century: "CENTURY",
  team_hundred: "100 UP",
};

export function EventGraphics({ state }: { state: CompactState | null }) {
  const eventKey = useLastEventKey(state);
  const [kind, setKind] = useState<GraphicKind>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const prevRuns = useRef<number | null>(null);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!eventKey || !state?.recent_balls?.length) return;
    const last = state.recent_balls[state.recent_balls.length - 1];
    let next = classifyBall(last?.display, Boolean(state.score?.is_free_hit));
    let sub: string | null = null;

    if (!next || next === "wide" || next === "no_ball") {
      const milestone = detectMilestones(state, prevRuns.current);
      if (milestone) {
        next = milestone;
        if (state.striker && (milestone === "fifty" || milestone === "century")) {
          sub = `${state.striker.name} · ${state.striker.runs}(${state.striker.balls_faced})`;
          if (state.striker.sixes) sub += ` · ${state.striker.sixes} sixes`;
        } else if (milestone === "team_hundred" && state.batting_team) {
          sub = `${state.batting_team.short_name ?? state.batting_team.name} · ${state.score?.runs}/${state.score?.wickets}`;
        }
      }
    } else if (next === "wicket" && state.striker) {
      sub = state.striker.name;
    } else if ((next === "four" || next === "six") && state.striker) {
      sub = `${state.striker.name} · ${state.striker.runs}(${state.striker.balls_faced})`;
    }

    if (state.score) prevRuns.current = state.score.runs;
    if (!next) return;

    const frame = window.requestAnimationFrame(() => {
      setKind(next);
      setSubtitle(sub);
    });
    const ms = reduceMotion ? 900 : next === "wicket" || next === "six" ? 2800 : 2200;
    const timer = window.setTimeout(() => {
      setKind(null);
      setSubtitle(null);
    }, ms);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [eventKey, state, reduceMotion]);

  if (!kind) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
      aria-live="polite"
    >
      <div
        className={cn(
          "flex min-w-[min(90vw,28rem)] flex-col items-center gap-2 rounded-[4px] border-2 px-10 py-7 shadow-tile",
          "animate-[fadeIn_0.2s_ease-out]",
          kind === "six" && "border-flip bg-ink text-flip",
          kind === "four" && "border-chalk bg-pitch text-chalk",
          kind === "wicket" && "border-boundary bg-ink text-boundary",
          kind === "free_hit" && "border-flip bg-flip text-ink",
          (kind === "fifty" || kind === "century" || kind === "team_hundred") &&
            "border-flip bg-pitch-deep text-flip",
          (kind === "wide" || kind === "no_ball") && "border-willow bg-ink text-willow",
        )}
      >
        <span className="font-sans text-5xl font-black tracking-[0.18em] uppercase sm:text-6xl">
          {LABELS[kind]}
        </span>
        {subtitle && (
          <span className="font-sans text-sm tracking-wide text-chalk/90 uppercase">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
