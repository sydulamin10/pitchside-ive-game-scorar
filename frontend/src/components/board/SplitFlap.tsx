/**
 * The mechanical split-flap board.
 *
 * A tile settles on its value by cycling through a few characters first, the way
 * a stadium board does. This is the one deliberate animation in the product, so
 * it is also the one place that has to be careful:
 *
 * - `prefers-reduced-motion` skips the cycling entirely and renders the value.
 * - The cycling is driven by one interval per tile and always terminates.
 * - Screen readers get the settled value, never the intermediate flicker.
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const GLYPHS = "0123456789";
const STEP_MS = 55;
const STEPS_PER_TILE = 4;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

interface FlapProps {
  char: string;
  /** Tiles further right settle later, so the number reads left to right. */
  delayMs?: number;
  tone?: "chalk" | "live" | "wicket";
  className?: string;
}

function Flap({ char, delayMs = 0, tone = "chalk", className }: FlapProps) {
  // The tile's truth is always `char`; this holds only the glyph being flicked
  // through on the way there, so nothing has to be mirrored into state.
  const [rollingGlyph, setRollingGlyph] = useState<string | null>(null);
  const previous = useRef(char);
  const shown = rollingGlyph ?? char;

  useEffect(() => {
    if (previous.current === char) return;
    previous.current = char;
    if (prefersReducedMotion() || !GLYPHS.includes(char)) return;

    let step = 0;
    let interval: number | undefined;
    const start = window.setTimeout(() => {
      setRollingGlyph(GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? char);
      interval = window.setInterval(() => {
        step += 1;
        if (step >= STEPS_PER_TILE) {
          window.clearInterval(interval);
          setRollingGlyph(null);
          return;
        }
        setRollingGlyph(GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? char);
      }, STEP_MS);
    }, delayMs);

    return () => {
      window.clearTimeout(start);
      if (interval !== undefined) window.clearInterval(interval);
      setRollingGlyph(null);
    };
  }, [char, delayMs]);

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flap",
        tone === "live" && "flap--live",
        tone === "wicket" && "flap--wicket",
        rollingGlyph !== null && "flap-rolling",
        className,
      )}
    >
      {shown === " " ? "\u00A0" : shown}
    </span>
  );
}

interface FlapNumberProps {
  value: number | string;
  /** Pad to this many tiles so the board does not jump when 9 becomes 10. */
  minTiles?: number;
  tone?: "chalk" | "live" | "wicket";
  className?: string;
  label?: string;
}

/** A number rendered as a row of tiles. */
export function FlapNumber({
  value,
  minTiles = 1,
  tone = "chalk",
  className,
  label,
}: FlapNumberProps) {
  const text = String(value);
  const chars = text.padStart(Math.max(minTiles, text.length), " ").split("");

  return (
    <span
      className={cn("inline-flex items-stretch gap-[2px]", className)}
      role="img"
      aria-label={label ?? text}
    >
      {chars.map((char, index) => (
        <Flap key={index} char={char} delayMs={index * 70} tone={tone} />
      ))}
    </span>
  );
}

/** A short static label on the board, e.g. a team's short name. */
export function FlapText({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] bg-ink px-2 py-1 font-mono text-sm font-semibold",
        "tracking-[0.12em] text-chalk uppercase shadow-tile",
        className,
      )}
    >
      {text}
    </span>
  );
}
