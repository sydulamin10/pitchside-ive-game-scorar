/**
 * The scoreboard strip: the one thing a viewer opens the link to see.
 *
 * Everything here is driven by the compact realtime frame, so it is identical on
 * the scorer's console, the public scorecard, and the broadcast overlay.
 */

import { cn } from "@/lib/utils";
import type { BallSummary, CompactState } from "@/lib/api/types";
import { Badge, LiveDot, Seam } from "@/components/ui/Surface";

import { FlapNumber, FlapText } from "./SplitFlap";

function ballTone(ball: BallSummary): string {
  if (ball.is_wicket) return "border-boundary bg-boundary/25 text-chalk";
  if (ball.batter_runs >= 4) return "border-flip bg-flip/20 text-flip";
  if (!ball.is_legal) return "border-willow bg-willow/15 text-chalk";
  if (ball.runs_total === 0) return "border-willow/40 text-willow-soft";
  return "border-willow/60 text-chalk";
}

/** The last few balls, in the notation a scorer would write in the book. */
export function RecentBalls({
  balls,
  className,
  label = "This over",
}: {
  balls: BallSummary[] | undefined;
  className?: string;
  /** `false` drops the caption, which the broadcast overlay has no room for. */
  label?: string | false;
}) {
  if (!balls?.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {label !== false && (
        <span className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
          {label}
        </span>
      )}
      {balls.map((ball) => (
        <span
          key={ball.delivery_id}
          title={`${ball.over_ball_text} · ${ball.bowler_name} to ${ball.striker_name}`}
          className={cn(
            "inline-flex min-w-7 items-center justify-center rounded-[2px] border px-1.5 py-0.5",
            "font-mono text-xs font-semibold tabular",
            ballTone(ball),
          )}
        >
          {ball.display}
        </span>
      ))}
    </div>
  );
}

interface ScoreBoardProps {
  state: CompactState;
  /** Shown above the score, e.g. "India vs Australia". */
  title?: string | null;
  live?: boolean;
  className?: string;
}

export function ScoreBoard({ state, title, live = false, className }: ScoreBoardProps) {
  const score = state.score;
  const battingName = state.batting_team?.short_name ?? state.batting_team?.name ?? "—";
  const bowlingName = state.bowling_team?.short_name ?? state.bowling_team?.name ?? "—";

  return (
    <section
      className={cn("rounded-[3px] border border-pitch-line bg-pitch-deep", className)}
      aria-label="Scoreboard"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          {live && <LiveDot />}
          <p className="font-sans text-xs tracking-[0.12em] text-willow-soft uppercase">
            {title ?? state.title ?? "Live"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {score?.is_free_hit && <Badge tone="live">Free hit</Badge>}
          {state.status === "innings_break" && <Badge tone="neutral">Innings break</Badge>}
          {state.status === "completed" && <Badge tone="quiet">Result</Badge>}
        </div>
      </header>

      <Seam />

      <div className="flex flex-wrap items-end gap-x-5 gap-y-4 px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {state.batting_team?.logo_url ? (
              <img
                src={state.batting_team.logo_url}
                alt=""
                className="h-7 w-7 rounded-[2px] object-cover"
              />
            ) : null}
            <FlapText text={battingName} />
          </div>
          <div className="flex items-end gap-1 text-4xl leading-none sm:text-5xl">
            <FlapNumber
              value={score?.runs ?? 0}
              minTiles={score && score.runs >= 100 ? 3 : 2}
              tone={live ? "live" : "chalk"}
              label={`${score?.runs ?? 0} runs`}
            />
            <span aria-hidden="true" className="px-0.5 font-mono text-willow">
              /
            </span>
            <FlapNumber
              value={score?.wickets ?? 0}
              tone="wicket"
              label={`${score?.wickets ?? 0} wickets`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
            Overs
          </span>
          <div className="flex items-end text-2xl leading-none sm:text-3xl">
            <FlapNumber
              value={score?.overs_text ?? "0.0"}
              label={`${score?.overs_text ?? "0.0"} overs`}
            />
          </div>
        </div>

        <dl className="flex flex-1 flex-wrap items-end gap-x-6 gap-y-2">
          <Figure label="CRR" value={score ? score.run_rate.toFixed(2) : "—"} />
          {score?.required_run_rate != null && (
            <Figure label="RRR" value={score.required_run_rate.toFixed(2)} tone="live" />
          )}
          {score?.target_runs != null && <Figure label="Target" value={score.target_runs} />}
          {score?.extras_total != null && <Figure label="Extras" value={score.extras_total} />}
        </dl>
      </div>

      {score?.runs_needed != null && score.balls_remaining != null && score.runs_needed > 0 && (
        <>
          <Seam />
          <p className="px-4 py-2.5 font-sans text-sm text-chalk">
            <span className="text-flip">{bowlingName}</span> defending ·{" "}
            <strong className="tabular">{score.runs_needed}</strong> needed from{" "}
            <strong className="tabular">{score.balls_remaining}</strong>{" "}
            {score.balls_remaining === 1 ? "ball" : "balls"}
          </p>
        </>
      )}

      {state.result_summary && state.status === "completed" && (
        <>
          <Seam />
          <p className="px-4 py-2.5 font-sans text-sm font-semibold text-flip">
            {state.result_summary}
          </p>
        </>
      )}

      <Seam />

      <div className="grid gap-2 px-3 py-3 sm:grid-cols-3">
        {[state.striker, state.non_striker].map((batter, index) =>
          batter ? (
            <div
              key={batter.player_id}
              className={cn(
                "flex items-center gap-2.5 rounded-[6px] border px-2.5 py-2",
                index === 0
                  ? "border-flip/45 bg-flip/10"
                  : "border-willow/20 bg-white/[0.03]",
              )}
            >
              {batter.photo_url ? (
                <img
                  src={batter.photo_url}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover ring-1 ring-white/20"
                />
              ) : state.batting_team?.logo_url ? (
                <img
                  src={state.batting_team.logo_url}
                  alt=""
                  className="h-11 w-11 rounded-full object-cover opacity-80"
                />
              ) : (
                <span className="grid h-11 w-11 place-items-center rounded-full bg-pitch-line font-sans text-sm font-bold">
                  {(batter.name[0] ?? "?").toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-[0.72rem] font-semibold text-chalk">
                  {batter.jersey_number != null ? `#${batter.jersey_number} ` : ""}
                  {batter.name}
                  {index === 0 && <span className="text-flip"> *</span>}
                </p>
                <p className="font-mono text-sm font-bold text-chalk tabular">
                  {batter.runs}
                  <span className="text-willow-soft"> ({batter.balls_faced})</span>
                </p>
                <p className="font-sans text-[0.6rem] text-willow">
                  {batter.fours}×4 · {batter.sixes}×6 · SR {batter.strike_rate.toFixed(0)}
                </p>
              </div>
            </div>
          ) : null,
        )}

        {state.bowler && (
          <div className="flex items-center gap-2.5 rounded-[6px] border border-willow/20 bg-white/[0.03] px-2.5 py-2">
            {state.bowler.photo_url ? (
              <img
                src={state.bowler.photo_url}
                alt=""
                className="h-11 w-11 rounded-full object-cover ring-1 ring-white/20"
              />
            ) : (
              <span className="grid h-11 w-11 place-items-center rounded-full bg-pitch-line font-sans text-sm font-bold">
                {(state.bowler.name[0] ?? "?").toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-[0.72rem] font-semibold text-chalk">
                {state.bowler.jersey_number != null ? `#${state.bowler.jersey_number} ` : ""}
                {state.bowler.name}
              </p>
              <p className="font-mono text-sm font-bold text-chalk tabular">
                {state.bowler.wickets}/{state.bowler.runs_conceded}
              </p>
              <p className="font-sans text-[0.6rem] text-willow tabular">
                {state.bowler.overs_text} ov · econ {state.bowler.economy.toFixed(2)}
                {state.bowler.maidens > 0 && ` · ${state.bowler.maidens} md`}
              </p>
            </div>
          </div>
        )}

        {state.current_partnership && state.current_partnership.balls > 0 && (
          <p className="col-span-full font-sans text-xs text-willow">
            Partnership{" "}
            <span className="tabular">
              {state.current_partnership.runs} ({state.current_partnership.balls})
            </span>
          </p>
        )}
      </div>

      {state.recent_balls?.length ? (
        <>
          <Seam />
          <RecentBalls balls={state.recent_balls} className="px-4 py-3" />
        </>
      ) : null}
    </section>
  );
}

function Figure({
  label,
  value,
  tone = "chalk",
}: {
  label: string;
  value: string | number;
  tone?: "chalk" | "live";
}) {
  return (
    <div className="flex flex-col">
      <dt className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "font-mono text-lg tabular",
          tone === "live" ? "text-flip" : "text-chalk",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
