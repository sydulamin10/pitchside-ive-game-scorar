/**
 * International TV-style live score bars for camera / OBS overlays.
 * Multiple selectable designs inspired by broadcast lower-thirds.
 */

import type { BallSummary, CompactState } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import type { OverlayDesignId } from "./overlayThemes";

function lastEventLabel(state: CompactState): string | null {
  const last = state.recent_balls?.[state.recent_balls.length - 1];
  if (!last) return null;
  const d = last.display?.toLowerCase() ?? "";
  if (last.is_wicket || d.includes("w")) return "WICKET";
  if (d === "6" || last.batter_runs === 6) return "SIX";
  if (d === "4" || last.batter_runs === 4) return "FOUR";
  if (d.includes("wd")) return "WIDE";
  if (d.includes("nb")) return "NO BALL";
  if (last.runs_total > 0) return `${last.runs_total} RUN${last.runs_total === 1 ? "" : "S"}`;
  return "DOT";
}

/** Subtle brand line under the score — does not cover team/score. */
function OdccMark({ tone = "dark" }: { tone?: "dark" | "light" | "gold" | "muted" }) {
  const color =
    tone === "light"
      ? "text-chalk/50"
      : tone === "gold"
        ? "text-[#c9a227]/85"
        : tone === "muted"
          ? "text-ink/35"
          : "text-ink/45";
  return (
    <div className={cn("mt-0.5 flex items-center gap-1", color)}>
      <img src="/branding/odcc-live.png" alt="" className="h-3.5 w-3.5 object-contain" />
      <p className="font-sans text-[7px] font-semibold tracking-[0.2em] uppercase">ODCC LIVE</p>
    </div>
  );
}

function OverPills({
  balls,
  variant = "dark",
}: {
  balls: BallSummary[] | undefined;
  variant?: "dark" | "light" | "green" | "purple";
}) {
  const items = (balls ?? []).slice(-6);
  while (items.length < 6) items.push(null as unknown as BallSummary);
  const styles =
    variant === "light"
      ? "border-ink/30 bg-ink text-chalk"
      : variant === "green"
        ? "border-transparent bg-pitch text-chalk"
        : variant === "purple"
          ? "border-transparent bg-[#3a1a5c] text-chalk"
          : "border-white/40 bg-white/15 text-chalk";

  return (
    <div className="flex items-center gap-1">
      {items.map((ball, i) => {
        const label = ball ? (ball.is_wicket ? "W" : ball.display === "." ? "•" : ball.display) : "";
        const hot =
          ball &&
          (ball.is_wicket || ball.batter_runs >= 4 || (ball.display || "").includes("6"));
        return (
          <span
            key={i}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[9px] font-bold",
              styles,
              hot && variant === "green" && "bg-flip text-ink",
              hot && variant === "light" && "bg-flip text-ink border-flip",
              !ball && "opacity-30",
            )}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function LogoBadge({
  url,
  short,
  round,
  className,
}: {
  url?: string | null;
  short?: string | null;
  round?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border border-white/30 bg-ink/40 font-mono text-[9px] font-bold text-chalk",
        round ? "h-10 w-10 rounded-full" : "h-9 w-9 rounded-[2px]",
        className,
      )}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : (short ?? "—").slice(0, 3)}
    </div>
  );
}

function BatterCard({ state }: { state: CompactState }) {
  const batter = state.striker;
  if (!batter) return null;
  return (
    <div className="mb-2 flex max-w-sm overflow-hidden rounded-[4px] border border-willow/30 shadow-tile">
      <div className="flex w-28 items-end justify-center bg-pitch px-1 pt-2">
        {batter.photo_url ? (
          <img src={batter.photo_url} alt="" className="h-24 w-full object-cover object-top" />
        ) : (
          <div className="mb-2 grid h-20 w-20 place-items-center rounded-full bg-ink/40 font-sans text-lg text-chalk">
            {(batter.name[0] ?? "?").toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 bg-chalk px-3 py-2 text-ink">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {state.batting_team?.logo_url ? (
              <img
                src={state.batting_team.logo_url}
                alt=""
                className="h-7 w-7 rounded-[2px] object-cover"
              />
            ) : null}
            <p className="font-sans text-sm font-black tracking-wide uppercase">
              {batter.name}
            </p>
          </div>
          <p className="font-mono text-sm font-bold tabular">
            {batter.runs}
            <span className="text-xs font-normal opacity-60">({batter.balls_faced})</span>
          </p>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 border-t border-ink/10 pt-2 font-sans text-[10px]">
          <Stat label="Balls" value={batter.balls_faced} />
          <Stat label="Fours" value={batter.fours} />
          <Stat label="Sixes" value={batter.sixes} />
          <Stat label="S/R" value={batter.strike_rate.toFixed(1)} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="tracking-wide text-ink/50 uppercase">{label}</p>
      <p className="font-mono text-sm font-bold tabular">{value}</p>
    </div>
  );
}

/** Classic silver lower-third */
function ClassicBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const event = lastEventLabel(state);
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden rounded-[3px] border border-black/20 bg-gradient-to-b from-[#ececec] to-[#c8c8c8] text-ink shadow-tile">
      <div className="flex items-center gap-2 border-r border-ink/15 px-2 py-1.5">
        <LogoBadge url={state.batting_team?.logo_url} short={state.batting_team?.short_name} />
        <div>
          <p className="font-sans text-[10px] font-semibold tracking-wide uppercase">
            {state.batting_team?.short_name ?? state.batting_team?.name}
          </p>
          <p className="font-mono text-xl font-black tabular leading-none">
            {score.runs}/{score.wickets}{" "}
            <span className="text-sm font-semibold opacity-70">{score.overs_text}</span>
          </p>
          <OdccMark tone="muted" />
        </div>
      </div>
      <div className="flex min-w-[7rem] flex-col justify-center border-r border-ink/15 px-3">
        <p className="font-sans text-xs font-bold uppercase">{event ?? "LIVE"}</p>
        <p className="font-mono text-[11px] tabular">Run Rate {score.run_rate.toFixed(2)}</p>
      </div>
      <div className="flex flex-1 items-center justify-between gap-3 px-3 py-1.5">
        <div>
          <p className="font-sans text-[10px] font-semibold tracking-wide uppercase">
            {state.bowling_team?.short_name ?? state.bowling_team?.name}
          </p>
          <OverPills balls={state.recent_balls} variant="light" />
        </div>
        <LogoBadge url={state.bowling_team?.logo_url} short={state.bowling_team?.short_name} />
      </div>
    </div>
  );
}

/** Circle crest — batters | center | bowler */
function CircleBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? "BAT";
  const b = state.bowling_team?.short_name ?? "BWL";
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden rounded-md bg-gradient-to-r from-[#0d3d2e] via-[#145c42] to-[#0d3d2e] text-chalk shadow-tile">
      <div className="flex items-center gap-2 px-2 py-2">
        <LogoBadge url={state.batting_team?.logo_url} short={a} round className="ring-2 ring-white/40" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 pr-2 font-sans text-[11px]">
        {[state.striker, state.non_striker].map((bat, i) =>
          bat ? (
            <div key={bat.player_id} className="flex items-center gap-1.5">
              {i === 0 && <span className="text-flip">▸</span>}
              <span className={cn("truncate uppercase", i === 0 && "font-bold")}>{bat.name}</span>
              <span className="ml-auto font-mono tabular">
                {bat.runs} <span className="opacity-60">{bat.balls_faced}</span>
              </span>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex min-w-[11rem] flex-col justify-center bg-chalk px-3 py-1.5 text-ink">
        <div className="flex items-center justify-between gap-2 font-sans text-[10px] font-bold uppercase">
          <span>
            {a} vs {b}
          </span>
          {score.target_runs != null && (
            <span className="rounded-[2px] bg-pitch px-1.5 text-chalk">P1</span>
          )}
        </div>
        <div className="mt-0.5 flex items-end gap-2">
          <span className="rounded-[3px] bg-ink px-2 py-0.5 font-mono text-2xl font-black text-chalk tabular">
            {score.runs}-{score.wickets}
          </span>
          <span className="pb-0.5 font-mono text-xs font-semibold tabular">
            {score.overs_text} OV
          </span>
        </div>
        <OdccMark tone="muted" />
        {(state.toss?.decision || score.runs_needed != null) && (
          <p className="mt-0.5 truncate font-sans text-[9px] text-ink/70 uppercase">
            {score.runs_needed != null
              ? `Need ${score.runs_needed} from ${score.balls_remaining ?? "—"}`
              : state.toss?.winner?.short_name
                ? `Toss ${state.toss.winner.short_name} · ${state.toss.decision ?? ""}`
                : ""}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-2 py-2 font-sans text-[11px]">
        {state.bowler && (
          <>
            <div className="flex items-center gap-2">
              <span className="truncate font-bold uppercase">{state.bowler.name}</span>
              <span className="ml-auto font-mono tabular">
                {state.bowler.runs_conceded}-{state.bowler.wickets}{" "}
                <span className="opacity-70">{state.bowler.overs_text}</span>
              </span>
            </div>
            <OverPills balls={state.recent_balls} />
          </>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 py-2">
        <LogoBadge
          url={state.bowling_team?.logo_url}
          short={b}
          round
          className="ring-2 ring-white/40"
        />
      </div>
    </div>
  );
}

/** Split green/blue panels */
function SplitBar({ state }: { state: CompactState }) {
  const score = state.score!;
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden rounded-[2px] shadow-tile">
      <div className="flex min-w-0 flex-[1.1] items-center gap-2 bg-[#1a7a3c] px-2 py-2 text-chalk">
        <LogoBadge url={state.batting_team?.logo_url} short={state.batting_team?.short_name} />
        <div className="min-w-0 flex-1 font-sans text-[11px] uppercase">
          {[state.striker, state.non_striker].map((bat, i) =>
            bat ? (
              <div key={bat.player_id} className="flex gap-1 truncate">
                <span className={cn(i === 0 && "font-black")}>
                  {bat.name}
                  {i === 0 ? " /" : ""}
                </span>
                <span className="ml-auto font-mono tabular">
                  {bat.runs}
                  <span className="text-[9px] opacity-70"> {bat.balls_faced}</span>
                </span>
              </div>
            ) : null,
          )}
        </div>
      </div>
      <div className="flex min-w-[9rem] flex-col justify-center bg-gradient-to-b from-[#1a7a3c] to-[#1a4a8a] px-3 py-1.5 text-chalk">
        <div className="flex items-center justify-between font-sans text-[10px] font-bold uppercase">
          <span>{state.batting_team?.short_name ?? "BAT"}</span>
          <span className="font-mono text-xl tabular">
            {score.runs}-{score.wickets}
          </span>
        </div>
        <div className="flex justify-between font-sans text-[10px] uppercase opacity-90">
          <span>Overs</span>
          <span className="font-mono tabular">{score.overs_text}</span>
        </div>
        <OdccMark tone="light" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 bg-[#1a4a8a] px-2 py-2 text-chalk">
        {state.bowler && (
          <p className="truncate font-sans text-[11px] font-bold uppercase">
            {state.bowler.name}{" "}
            <span className="font-mono font-semibold">
              {state.bowler.wickets}-{state.bowler.runs_conceded} {state.bowler.overs_text}
            </span>
          </p>
        )}
        <OverPills balls={state.recent_balls} variant="green" />
      </div>
      <div className="flex items-center bg-[#1a4a8a] px-2">
        <LogoBadge url={state.bowling_team?.logo_url} short={state.bowling_team?.short_name} />
      </div>
    </div>
  );
}

/** Arena — angled panels, bold score */
function ArenaBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? "A";
  const b = state.bowling_team?.short_name ?? "B";
  return (
    <div className="flex w-full max-w-5xl items-stretch text-sm shadow-tile">
      <div className="flex items-center bg-chalk px-1.5">
        <LogoBadge url={state.batting_team?.logo_url} short={a} className="border-ink/20" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center bg-chalk px-2 py-1.5 text-ink">
        {[state.striker, state.non_striker].map((bat, i) =>
          bat ? (
            <div key={bat.player_id} className="flex font-sans text-[11px] uppercase">
              <span className={cn("truncate", i === 0 && "font-black")}>{bat.name}</span>
              <span className="ml-auto font-mono tabular">
                {String(bat.runs).padStart(2, "0")}{" "}
                <span className="opacity-50">{bat.balls_faced}</span>
              </span>
            </div>
          ) : null,
        )}
      </div>
      <div
        className="flex min-w-[12rem] flex-col justify-center px-3 py-1.5 text-chalk"
        style={{
          clipPath: "polygon(8% 0, 100% 0, 92% 100%, 0 100%)",
          background: "linear-gradient(180deg,#2a1848,#1a0f2e)",
        }}
      >
        <p className="text-center font-sans text-[10px] font-bold tracking-wider uppercase">
          {a} v {b}
        </p>
        <div className="mt-0.5 flex items-center justify-center gap-1.5">
          <span className="rounded-[3px] bg-[#e83e8c] px-2 py-0.5 font-mono text-xl font-black tabular">
            {score.runs}-{score.wickets}
          </span>
          <span className="rounded-[2px] bg-flip px-1.5 font-sans text-[10px] font-black text-ink">
            LIVE
          </span>
          <span className="font-mono text-xs tabular">{score.overs_text} OV</span>
        </div>
        <div className="flex flex-col items-center">
          <OdccMark tone="light" />
          <p className="font-mono text-[10px] opacity-80">
            Run Rate {score.run_rate.toFixed(2)}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center bg-chalk px-2 py-1.5 text-ink">
        {state.bowler && (
          <p className="font-sans text-[11px] font-bold uppercase">
            {state.bowler.name}{" "}
            <span className="font-mono">
              {state.bowler.wickets}-{state.bowler.runs_conceded} ({state.bowler.overs_text})
            </span>
          </p>
        )}
        <OverPills balls={state.recent_balls} variant="purple" />
      </div>
      <div className="flex items-center bg-chalk px-1.5">
        <LogoBadge url={state.bowling_team?.logo_url} short={b} className="border-ink/20" />
      </div>
    </div>
  );
}

/** Emerald slanted */
function EmeraldBar({ state, showCard }: { state: CompactState; showCard?: boolean }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? "BAT";
  const b = state.bowling_team?.short_name ?? "BWL";
  return (
    <div className="flex w-full max-w-5xl flex-col items-start">
      {showCard && <BatterCard state={state} />}
      <div className="flex w-full items-stretch overflow-hidden shadow-tile">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 bg-chalk px-2 py-2 text-ink"
          style={{ clipPath: "polygon(0 0, 100% 0, 96% 100%, 0 100%)" }}
        >
          <LogoBadge url={state.batting_team?.logo_url} short={a} round />
          <div className="min-w-0 flex-1 font-sans text-[11px] uppercase">
            {[state.striker, state.non_striker].map((bat, i) =>
              bat ? (
                <div key={bat.player_id} className="flex items-center gap-1">
                  {i === 0 && <span className="text-pitch">▶</span>}
                  <span className={cn("truncate", i === 0 && "font-black")}>{bat.name}</span>
                  <span className="ml-auto font-mono tabular">
                    {bat.runs} ({bat.balls_faced})
                  </span>
                </div>
              ) : null,
            )}
          </div>
        </div>
        <div className="flex min-w-[10rem] flex-col items-center justify-center bg-pitch px-3 py-1.5 text-chalk">
          <p className="font-sans text-[10px] font-bold tracking-wider uppercase">
            {a} v {b}
          </p>
          <p className="font-mono text-2xl font-black tabular">
            {score.runs} / {score.wickets}
          </p>
          <OdccMark tone="light" />
          <p className="font-sans text-[10px] uppercase">
            Overs {score.overs_text} · CRR {score.run_rate.toFixed(2)}
          </p>
        </div>
        <div
          className="flex min-w-0 flex-1 flex-col justify-center bg-chalk px-2 py-2 text-ink"
          style={{ clipPath: "polygon(4% 0, 100% 0, 100% 100%, 0 100%)" }}
        >
          {state.bowler && (
            <p className="font-sans text-[11px] font-bold uppercase">
              {state.bowler.name}{" "}
              <span className="font-mono">
                {state.bowler.runs_conceded}-{state.bowler.wickets} {state.bowler.overs_text}
              </span>
            </p>
          )}
          <p className="font-sans text-[10px] text-ink/60 uppercase">
            {lastEventLabel(state) ?? "Live"}
          </p>
        </div>
        <div className="flex items-center bg-chalk px-2">
          <LogoBadge url={state.bowling_team?.logo_url} short={b} round />
        </div>
      </div>
    </div>
  );
}

/** Chase bar with need-runs strip */
function ChaseBar({ state, showCard }: { state: CompactState; showCard?: boolean }) {
  const score = state.score!;
  const need =
    score.runs_needed != null
      ? `NEED ${score.runs_needed} RUNS FROM ${score.balls_remaining ?? "—"} BALLS`
      : null;
  return (
    <div className="flex w-full max-w-5xl flex-col items-start gap-2">
      {showCard && <BatterCard state={state} />}
      <div className="flex w-full items-stretch overflow-hidden rounded-sm shadow-tile">
        <div className="flex items-center bg-gradient-to-r from-pitch to-pitch-deep px-2">
          <LogoBadge url={state.batting_team?.logo_url} short={state.batting_team?.short_name} round />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center bg-chalk px-2 py-1.5 text-ink">
          {[state.striker, state.non_striker].map((bat, i) =>
            bat ? (
              <div key={bat.player_id} className="flex items-center gap-1 font-sans text-[11px] uppercase">
                {i === 0 && <span className="text-boundary">▶</span>}
                <span className={cn("truncate", i === 0 && "font-black")}>{bat.name}</span>
                <span className="ml-auto font-mono tabular">
                  {bat.runs} ({bat.balls_faced})
                </span>
              </div>
            ) : null,
          )}
        </div>
        <div className="flex min-w-[9rem] flex-col bg-[#0b1e4a] text-chalk">
          <div className="flex items-end justify-center gap-2 px-3 py-1.5">
            <span className="font-sans text-xs font-bold uppercase">
              {state.batting_team?.short_name ?? "BAT"}
            </span>
            <span className="font-mono text-2xl font-black tabular">
              {score.runs}-{score.wickets}
            </span>
            <span className="pb-0.5 font-mono text-xs tabular">{score.overs_text}</span>
          </div>
          <div className="flex justify-center pb-1">
            <OdccMark tone="light" />
          </div>
          {need && (
            <div className="bg-ink px-2 py-0.5 text-center font-sans text-[9px] font-bold tracking-wide text-flip uppercase">
              {need}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 bg-gradient-to-r from-pitch-deep to-pitch px-2 text-chalk">
          {need ? (
            <p className="hidden font-sans text-[10px] font-bold uppercase sm:block">{need}</p>
          ) : (
            <p className="font-mono text-xs tabular">CRR {score.run_rate.toFixed(2)}</p>
          )}
          <LogoBadge url={state.bowling_team?.logo_url} short={state.bowling_team?.short_name} round />
        </div>
      </div>
    </div>
  );
}

function MinimalBar({ state }: { state: CompactState }) {
  const score = state.score!;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <div className="flex items-center gap-3 rounded-[4px] border border-black/50 bg-ink/90 px-4 py-2 text-chalk shadow-tile">
        <LogoBadge url={state.batting_team?.logo_url} short={state.batting_team?.short_name} />
        <span className="font-mono text-3xl font-bold tabular">
          {score.runs}/{score.wickets}
        </span>
        <span className="font-mono text-sm opacity-80">{score.overs_text}</span>
      </div>
      <OdccMark tone="light" />
    </div>
  );
}

/** Modern flat navy strip */
function ModernBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? "BAT";
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden rounded-sm bg-[#12263a] text-chalk shadow-tile">
      <div className="flex items-center gap-2 border-r border-white/10 px-3 py-2">
        <LogoBadge url={state.batting_team?.logo_url} short={a} className="rounded-sm border-white/20" />
        <div>
          <p className="font-sans text-[10px] font-semibold tracking-wide uppercase opacity-80">
            {a}
          </p>
          <p className="font-mono text-2xl font-black tabular leading-none">
            {score.runs}
            <span className="text-base font-semibold opacity-70">/{score.wickets}</span>
          </p>
          <OdccMark tone="light" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0 font-sans text-[11px] uppercase">
          {[state.striker, state.non_striker].map((bat, i) =>
            bat ? (
              <div key={bat.player_id} className="flex gap-2 truncate">
                <span className={cn(i === 0 && "font-bold text-[#7ec8ff]")}>{bat.name}</span>
                <span className="font-mono tabular opacity-90">
                  {bat.runs}({bat.balls_faced})
                </span>
              </div>
            ) : null,
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-xs tabular opacity-80">{score.overs_text} ov</p>
          <OverPills balls={state.recent_balls} />
        </div>
      </div>
    </div>
  );
}

/** Premium dark + gold accents */
function PremiumBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? "BAT";
  const b = state.bowling_team?.short_name ?? "BWL";
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden border border-[#c9a227]/40 bg-[#14110c] text-chalk shadow-tile">
      <div className="flex items-center bg-[#c9a227]/15 px-2">
        <LogoBadge
          url={state.batting_team?.logo_url}
          short={a}
          round
          className="border-[#c9a227]/60 ring-1 ring-[#c9a227]/30"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1.5 font-sans text-[11px] uppercase">
        {[state.striker, state.non_striker].map((bat, i) =>
          bat ? (
            <div key={bat.player_id} className="flex gap-1">
              <span className={cn("truncate", i === 0 && "font-black text-[#e8d48b]")}>{bat.name}</span>
              <span className="ml-auto font-mono tabular">
                {bat.runs} <span className="opacity-50">{bat.balls_faced}</span>
              </span>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex min-w-[10rem] flex-col items-center justify-center border-x border-[#c9a227]/30 bg-[#1c1812] px-3 py-1.5">
        <p className="font-sans text-[9px] font-bold tracking-[0.18em] text-[#c9a227] uppercase">
          {a} · {b}
        </p>
        <p className="font-mono text-2xl font-black tabular text-[#f5e6b8]">
          {score.runs}-{score.wickets}
        </p>
        <OdccMark tone="gold" />
        <p className="font-mono text-[10px] text-[#c9a227]/80 tabular">{score.overs_text}</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1.5 font-sans text-[11px]">
        {state.bowler && (
          <p className="truncate font-bold uppercase text-[#e8d48b]">
            {state.bowler.name}{" "}
            <span className="font-mono font-semibold text-chalk">
              {state.bowler.wickets}-{state.bowler.runs_conceded}
            </span>
          </p>
        )}
        <OverPills balls={state.recent_balls} />
      </div>
      <div className="flex items-center bg-[#c9a227]/15 px-2">
        <LogoBadge
          url={state.bowling_team?.logo_url}
          short={b}
          round
          className="border-[#c9a227]/60"
        />
      </div>
    </div>
  );
}

/** Near-black night bar */
function DarkBar({ state }: { state: CompactState }) {
  const score = state.score!;
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden rounded-[3px] border border-white/10 bg-black text-chalk shadow-tile">
      <div className="flex items-center gap-2 px-2 py-2">
        <LogoBadge url={state.batting_team?.logo_url} short={state.batting_team?.short_name} />
        <div>
          <p className="font-sans text-[10px] font-semibold tracking-wide uppercase text-white/60">
            {state.batting_team?.short_name ?? state.batting_team?.name}
          </p>
          <p className="font-mono text-2xl font-black tabular leading-none text-[#39ff14]">
            {score.runs}
            <span className="text-base text-chalk">/{score.wickets}</span>
          </p>
          <OdccMark tone="light" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center border-l border-white/10 px-3 py-1.5 font-sans text-[11px] uppercase">
        {[state.striker, state.non_striker].map((bat, i) =>
          bat ? (
            <div key={bat.player_id} className="flex gap-2">
              <span className={cn("truncate", i === 0 && "font-bold text-[#39ff14]")}>{bat.name}</span>
              <span className="ml-auto font-mono tabular opacity-80">
                {bat.runs}({bat.balls_faced})
              </span>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex flex-col items-end justify-center gap-1 border-l border-white/10 px-3 py-1.5">
        <p className="font-mono text-xs tabular text-white/70">{score.overs_text} · RR {score.run_rate.toFixed(1)}</p>
        <OverPills balls={state.recent_balls} />
      </div>
    </div>
  );
}

/** Clean white panels */
function CleanBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? "BAT";
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden rounded-[2px] border border-ink/15 bg-white text-ink shadow-tile">
      <div className="flex items-center gap-2 border-r border-ink/10 px-3 py-2">
        <LogoBadge
          url={state.batting_team?.logo_url}
          short={a}
          className="border-ink/20 bg-ink/5 text-ink"
        />
        <div>
          <p className="font-sans text-[10px] font-semibold tracking-wide uppercase text-ink/55">
            {a}
          </p>
          <p className="font-mono text-2xl font-black tabular leading-none">
            {score.runs}/{score.wickets}
          </p>
          <OdccMark tone="muted" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-1.5 font-sans text-[11px] uppercase">
        {[state.striker, state.non_striker].map((bat, i) =>
          bat ? (
            <div key={bat.player_id} className="flex gap-2 border-b border-ink/5 last:border-0">
              <span className={cn("truncate", i === 0 && "font-black")}>{bat.name}</span>
              <span className="ml-auto font-mono tabular">
                {bat.runs} <span className="text-ink/40">{bat.balls_faced}</span>
              </span>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex flex-col items-end justify-center gap-1 border-l border-ink/10 bg-[#f7f7f5] px-3 py-1.5">
        <p className="font-mono text-xs tabular text-ink/60">{score.overs_text} ov</p>
        {state.bowler && (
          <p className="max-w-[9rem] truncate font-sans text-[10px] font-semibold uppercase text-ink/70">
            {state.bowler.name}
          </p>
        )}
        <OverPills balls={state.recent_balls} variant="light" />
      </div>
    </div>
  );
}

/** Tournament / event bold center */
function TournamentBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? "BAT";
  const b = state.bowling_team?.short_name ?? "BWL";
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden shadow-tile">
      <div className="flex min-w-0 flex-1 items-center gap-2 bg-[#0e3d2c] px-2 py-2 text-chalk">
        <LogoBadge url={state.batting_team?.logo_url} short={a} round />
        <div className="min-w-0 flex-1 font-sans text-[11px] uppercase">
          {[state.striker, state.non_striker].map((bat, i) =>
            bat ? (
              <div key={bat.player_id} className="flex gap-1">
                <span className={cn("truncate", i === 0 && "font-black")}>{bat.name}</span>
                <span className="ml-auto font-mono tabular">
                  {bat.runs}({bat.balls_faced})
                </span>
              </div>
            ) : null,
          )}
        </div>
      </div>
      <div className="flex min-w-[11rem] flex-col items-center justify-center bg-[#f0b429] px-3 py-1.5 text-ink">
        <p className="font-sans text-[9px] font-black tracking-[0.14em] uppercase">
          {state.tournament?.name?.slice(0, 28) || `${a} vs ${b}`}
        </p>
        <p className="font-mono text-2xl font-black tabular">
          {score.runs}-{score.wickets}
        </p>
        <OdccMark tone="dark" />
        <p className="font-mono text-[10px] font-semibold tabular">{score.overs_text} OV</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 bg-[#123a66] px-2 py-2 text-chalk">
        {state.bowler && (
          <p className="truncate font-sans text-[11px] font-bold uppercase">
            {state.bowler.name}{" "}
            <span className="font-mono">
              {state.bowler.wickets}-{state.bowler.runs_conceded}
            </span>
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          <OverPills balls={state.recent_balls} />
          <LogoBadge url={state.bowling_team?.logo_url} short={b} round />
        </div>
      </div>
    </div>
  );
}

/** Sample compact state for studio design tiles when SSE has no score yet. */
export function mockOverlayState(seed?: Partial<CompactState>): CompactState {
  return {
    status: "live",
    state_version: 1,
    title: "Sample Match",
    tournament: {
      id: "mock-t",
      name: "Old Dhaka Champion League",
      slug: "odcl",
      round: "Final",
      logo_url: null,
    },
    batting_team: {
      id: "a",
      name: "Old Dhaka XI",
      short_name: "ODX",
      logo_url: null,
      primary_color: null,
    },
    bowling_team: {
      id: "b",
      name: "River Side CC",
      short_name: "RSC",
      logo_url: null,
      primary_color: null,
    },
    score: {
      runs: 142,
      wickets: 3,
      overs_text: "14.2",
      run_rate: 9.95,
      required_run_rate: null,
      target_runs: null,
      runs_needed: null,
      balls_remaining: null,
      extras_total: 8,
      is_free_hit: false,
    },
    striker: {
      player_id: "s1",
      name: "R. Hasan",
      runs: 54,
      balls_faced: 32,
      fours: 5,
      sixes: 2,
      strike_rate: 168.8,
    },
    non_striker: {
      player_id: "s2",
      name: "M. Karim",
      runs: 21,
      balls_faced: 18,
      fours: 2,
      sixes: 0,
      strike_rate: 116.7,
    },
    bowler: {
      player_id: "b1",
      name: "A. Rahman",
      overs_text: "2.2",
      runs_conceded: 18,
      wickets: 1,
      economy: 7.7,
      maidens: 0,
    },
    recent_balls: [
      {
        delivery_id: "d1",
        sequence: 1,
        over_number: 14,
        ball_in_over: 1,
        over_ball_text: "14.1",
        display: "1",
        runs_total: 1,
        batter_runs: 1,
        extra_type: null,
        extra_runs: 0,
        is_wicket: false,
        is_legal: true,
        is_free_hit: false,
        striker_id: "s1",
        striker_name: "R. Hasan",
        bowler_id: "b1",
        bowler_name: "A. Rahman",
        commentary: null,
      },
      {
        delivery_id: "d2",
        sequence: 2,
        over_number: 14,
        ball_in_over: 2,
        over_ball_text: "14.2",
        display: "4",
        runs_total: 4,
        batter_runs: 4,
        extra_type: null,
        extra_runs: 0,
        is_wicket: false,
        is_legal: true,
        is_free_hit: false,
        striker_id: "s1",
        striker_name: "R. Hasan",
        bowler_id: "b1",
        bowler_name: "A. Rahman",
        commentary: null,
      },
    ],
    ...seed,
  };
}

export function TvScoreOverlay({
  state,
  design,
  showPlayerCard = true,
  className,
}: {
  state: CompactState;
  design: OverlayDesignId;
  showPlayerCard?: boolean;
  className?: string;
}) {
  if (!state.score) return null;

  const last = state.recent_balls?.[state.recent_balls.length - 1];
  const cardWorthy =
    showPlayerCard &&
    Boolean(
      last &&
        (last.batter_runs >= 4 ||
          last.is_wicket ||
          (state.striker &&
            (state.striker.runs === 50 ||
              state.striker.runs === 100 ||
              (state.striker.runs > 50 && state.striker.runs < 56) ||
              (state.striker.runs > 100 && state.striker.runs < 106)))),
    );

  const bar = (() => {
    switch (design) {
      case "classic":
        return <ClassicBar state={state} />;
      case "circle":
        return <CircleBar state={state} />;
      case "split":
        return <SplitBar state={state} />;
      case "arena":
        return <ArenaBar state={state} />;
      case "emerald":
        return <EmeraldBar state={state} showCard={cardWorthy} />;
      case "chase":
        return <ChaseBar state={state} showCard={cardWorthy} />;
      case "modern":
        return <ModernBar state={state} />;
      case "premium":
        return <PremiumBar state={state} />;
      case "dark":
        return <DarkBar state={state} />;
      case "clean":
        return <CleanBar state={state} />;
      case "tournament":
        return <TournamentBar state={state} />;
      case "minimal":
        return <MinimalBar state={state} />;
      default:
        return <CircleBar state={state} />;
    }
  })();

  return <div className={cn("w-full max-w-5xl", className)}>{bar}</div>;
}
