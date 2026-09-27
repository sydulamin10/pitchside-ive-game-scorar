/**
 * Full-screen event graphics for overlay, studio and external camera.
 * Driven by the latest ball in the compact SSE frame, plus optional director cues.
 *
 * Each new event remounts the plate (`key={playKey}`) so a second 4/6/wicket
 * always replays the CSS animation instead of sticking on the first run.
 */

import { useEffect, useRef, useState } from "react";

import { useLastEventKey } from "@/components/broadcast/useLastEventKey";
import type { CompactState } from "@/lib/api/types";
import {
  GRAPHIC_DIGITS,
  GRAPHIC_WORDS,
  graphicHoldMs,
  latestGraphic,
  parseGraphicCue,
  type GraphicKind,
} from "@/lib/broadcast/eventKind";
import { animationEnabled } from "@/lib/broadcast/overlayRules";
import { cn } from "@/lib/utils";

export function EventGraphics({ state }: { state: CompactState | null }) {
  const eventKey = useLastEventKey(state);
  const cue = state?.graphics?.anim_cue ?? "";
  const [kind, setKind] = useState<GraphicKind>(null);
  const [playKey, setPlayKey] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const prevRuns = useRef<number | null>(null);
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const lastPlayed = useRef<string | null>(null);

  useEffect(() => {
    if (!state) return;
    const cueKey = cue ? `cue:${cue}` : "";
    let next: GraphicKind = null;
    let key: string | null = null;
    let sub: string | null = null;

    if (eventKey && eventKey !== lastPlayed.current) {
      key = eventKey;
      next = latestGraphic(state, prevRuns.current);
      const last = state.recent_balls?.[state.recent_balls.length - 1];
      if (next === "wicket" && (state.striker || last?.striker_name)) {
        sub = last?.striker_name ?? state.striker?.name ?? null;
      } else if ((next === "four" || next === "six") && state.striker) {
        sub = `${state.striker.name} · ${state.striker.runs}(${state.striker.balls_faced})`;
      } else if (next === "no_ball") {
        sub = "No ball";
      } else if (next === "wide") {
        sub = "Wide";
      }
      if (state.score) prevRuns.current = state.score.runs;
    } else if (cueKey && cueKey !== lastPlayed.current) {
      key = cueKey;
      next = parseGraphicCue(cue);
    }

    if (!key || !next || !animationEnabled(state.graphics, next)) return;
    lastPlayed.current = key;

    const frame = window.requestAnimationFrame(() => {
      setKind(next);
      setPlayKey(key);
      setSubtitle(sub);
    });
    const timer = window.setTimeout(() => {
      setKind(null);
      setPlayKey(null);
      setSubtitle(null);
    }, graphicHoldMs(next, reduceMotion));
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [eventKey, cue, state, reduceMotion]);

  if (!kind || !playKey) return null;

  const digit = GRAPHIC_DIGITS[kind];
  const word = GRAPHIC_WORDS[kind];
  const sweep = kind === "four";
  const boom = kind === "six";
  const stamp = kind === "wicket";
  const ribbon = kind === "no_ball" || kind === "wide";

  if (reduceMotion) {
    return (
      <div
        key={playKey}
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex h-[38%] items-start justify-end p-3 sm:p-4"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-1 rounded-[4px] border-2 border-chalk bg-ink px-5 py-3 text-chalk">
          <span className="font-sans text-3xl font-black tracking-[0.14em] uppercase">{word}</span>
          {subtitle ? <span className="font-sans text-[11px] uppercase">{subtitle}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div key={playKey} className="gfx-stage" aria-live="polite">
      <div className={cn("gfx-wash", `gfx-wash--${kind}`)} />
      {boom ? <div className="gfx-ring" /> : null}
      {boom ? <div className="gfx-ring gfx-ring--late" /> : null}

      <div
        className={cn(
          "gfx-plate",
          sweep && "gfx-plate--sweep",
          boom && "gfx-plate--boom",
          stamp && "gfx-plate--stamp",
          ribbon && "gfx-plate--ribbon",
          `gfx-plate--${kind}`,
        )}
      >
        {digit ? <span className={cn("gfx-digit", sweep && "gfx-digit--hover")}>{digit}</span> : null}
        <span className="gfx-word">{word}</span>
        {subtitle ? <span className="gfx-sub">{subtitle}</span> : null}
      </div>
    </div>
  );
}
