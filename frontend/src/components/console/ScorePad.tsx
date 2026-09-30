/**
 * The keypad. One tap per ball, in the order a scorer thinks: what happened off
 * the bat, then anything unusual about the delivery.
 *
 * Choices worth knowing about:
 * - The extra is a *mode*, not a second dialog, so "wide, one run" is two taps.
 * - What the number keys mean changes with the mode, and the label above them
 *   says so, because "2" after tapping WIDE is two runs *run*, not off the bat.
 * - A boundary off a wide or a bye needs the flag: four wides and a wide plus
 *   three run are different events and rotate the strike differently.
 */

import { useEffect, useMemo, useState } from "react";

import type { ExtraType, InningsSnapshot } from "@/lib/api/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";

export interface BallDraft {
  batter_runs: number;
  extra_type: ExtraType | null;
  extra_runs: number;
  is_boundary: boolean;
  batters_crossed: boolean | null;
  commentary: string | null;
}

const RUNS = [0, 1, 2, 3, 4, 5, 6] as const;

const MODES: Array<{ value: ExtraType | null; label: string; key: string }> = [
  { value: null, label: "Off the bat", key: "1" },
  { value: "wide", label: "Wide", key: "w" },
  { value: "no_ball", label: "No ball", key: "n" },
  { value: "bye", label: "Bye", key: "b" },
  { value: "leg_bye", label: "Leg bye", key: "l" },
];

function runsMeaning(mode: ExtraType | null, byesOffNoBall: boolean): string {
  switch (mode) {
    case "wide":
      return "Runs run in addition to the wide";
    case "no_ball":
      return byesOffNoBall ? "Byes taken off the no-ball" : "Runs off the bat";
    case "bye":
      return "Byes taken";
    case "leg_bye":
      return "Leg byes taken";
    default:
      return "Runs off the bat";
  }
}

export function ScorePad({
  innings,
  disabled = false,
  busy = false,
  onRecord,
  onWicket,
  onUndo,
  onRetire,
}: {
  innings: InningsSnapshot;
  disabled?: boolean;
  busy?: boolean;
  onRecord: (draft: BallDraft) => void;
  onWicket: () => void;
  onUndo: () => void;
  onRetire: () => void;
}) {
  const [mode, setMode] = useState<ExtraType | null>(null);
  const [byesTicked, setByesOffNoBall] = useState(false);
  const [boundaryTicked, setBoundary] = useState(false);
  const state = innings.state;

  // A free hit is the one moment a scorer must not misread the pad.
  const freeHit = state.is_free_hit;

  // Both flags only mean anything in certain modes, so they are read through the
  // mode rather than reset when it changes — a stale tick cannot leak into a ball.
  const byesOffNoBall = mode === "no_ball" && byesTicked;
  const boundary = mode !== null && boundaryTicked;

  const submit = (runs: number) => {
    if (disabled) return;
    const draft: BallDraft = {
      batter_runs: 0,
      extra_type: mode,
      extra_runs: 0,
      is_boundary: false,
      batters_crossed: null,
      commentary: null,
    };
    if (mode === null) {
      draft.batter_runs = runs;
    } else if (mode === "no_ball") {
      if (byesOffNoBall) draft.extra_runs = runs;
      else draft.batter_runs = runs;
      draft.is_boundary = !byesOffNoBall && (runs === 4 || runs === 6);
    } else {
      draft.extra_runs = runs;
      draft.is_boundary = boundary;
    }
    onRecord(draft);
    setMode(null);
    setBoundary(false);
    setByesOffNoBall(false);
  };

  // Keyboard scoring for anyone at a laptop: numbers score, letters set the mode.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (disabled) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const digit = Number(event.key);
      if (!Number.isNaN(digit) && digit >= 0 && digit <= 6) {
        event.preventDefault();
        submit(digit);
        return;
      }
      const lower = event.key.toLowerCase();
      if (lower === "w" && event.shiftKey) {
        event.preventDefault();
        onWicket();
        return;
      }
      const found = MODES.find((entry) => entry.key === lower && entry.value !== null);
      if (found) {
        event.preventDefault();
        setMode((current) => (current === found.value ? null : found.value));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, mode, byesOffNoBall, boundary]);

  const showBoundaryToggle = mode === "wide" || mode === "bye" || mode === "leg_bye";
  const striker = useMemo(
    () => state.batting.find((b) => b.is_striker) ?? null,
    [state.batting],
  );

  return (
    <section aria-label="Scoring pad" className="flex flex-col">
      <div className="flex items-end justify-between gap-2 px-3 pt-3 pb-2 sm:px-4">
        <div>
          <p className="font-sans text-[0.65rem] font-bold tracking-[0.16em] text-willow uppercase">
            {runsMeaning(mode, byesOffNoBall)}
          </p>
          {freeHit && (
            <p className="pt-1">
              <Badge tone="live">Free hit</Badge>
            </p>
          )}
        </div>
        {striker && (
          <p className="font-sans text-[0.65rem] text-willow">
            on strike: <span className="text-chalk">{striker.name}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 px-3 sm:px-4">
        {RUNS.slice(0, 4).map((runs) => (
          <Button
            key={runs}
            variant="flap"
            size="lg"
            disabled={disabled || busy}
            onClick={() => submit(runs)}
            className="h-[3.35rem] text-xl sm:h-16 sm:text-2xl"
            aria-label={`${runs} ${runs === 1 ? "run" : "runs"}`}
          >
            {runs}
          </Button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 px-3 pb-3 sm:px-4">
        <Button
          variant="secondary"
          size="lg"
          disabled={disabled || busy}
          onClick={() => submit(4)}
          className="h-[3.35rem] text-xl sm:h-16 sm:text-2xl"
          aria-label="4 runs"
        >
          4
        </Button>
        <Button
          variant="flap"
          size="lg"
          disabled={disabled || busy}
          onClick={() => submit(5)}
          className="h-[3.35rem] text-xl sm:h-16 sm:text-2xl"
          aria-label="5 runs"
        >
          5
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={disabled || busy}
          onClick={() => submit(6)}
          className="h-[3.35rem] text-xl sm:h-16 sm:text-2xl"
          aria-label="6 runs"
        >
          6
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 px-3 pb-3 sm:px-4">
        {MODES.map((entry) => (
          <button
            key={entry.label}
            type="button"
            disabled={disabled}
            onClick={() => setMode(entry.value)}
            aria-pressed={mode === entry.value}
            className={cn(
              "tap min-h-9 rounded-[4px] border px-3 font-sans text-[0.72rem] font-semibold",
              mode === entry.value
                ? "border-chalk bg-chalk text-ink"
                : "border-willow/45 bg-transparent text-chalk hover:border-chalk",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {(showBoundaryToggle || mode === "no_ball") && (
        <div className="flex flex-wrap gap-4 px-3 pb-3 sm:px-4">
          {showBoundaryToggle && (
            <label className="tap flex items-center gap-2 font-sans text-xs text-chalk">
              <input
                type="checkbox"
                checked={boundary}
                onChange={(event) => setBoundary(event.target.checked)}
                className="size-4 accent-[var(--color-flip)]"
              />
              It reached the rope (the batters did not cross)
            </label>
          )}
          {mode === "no_ball" && (
            <label className="tap flex items-center gap-2 font-sans text-xs text-chalk">
              <input
                type="checkbox"
                checked={byesOffNoBall}
                onChange={(event) => setByesOffNoBall(event.target.checked)}
                className="size-4 accent-[var(--color-flip)]"
              />
              The runs were byes, not off the bat
            </label>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-3 py-3 sm:px-4">
        <Button variant="danger" disabled={disabled} onClick={onWicket}>
          Wicket
        </Button>
        <Button variant="ghost" disabled={disabled} onClick={onRetire}>
          Retire a batter
        </Button>
        <Button
          variant="ghost"
          disabled={disabled || (state.timeline?.length ?? 0) === 0}
          onClick={onUndo}
          className="ml-auto"
        >
          Undo last ball
        </Button>
      </div>

      <p className={cn("px-4 pb-3 font-sans text-[0.7rem] text-willow", "hidden sm:block")}>
        Keyboard: <kbd>0</kbd>–<kbd>6</kbd> score · <kbd>W</kbd>/<kbd>N</kbd>/<kbd>B</kbd>/
        <kbd>L</kbd> set wide, no-ball, bye, leg-bye · <kbd>Shift</kbd>+<kbd>W</kbd> wicket
      </p>
    </section>
  );
}
