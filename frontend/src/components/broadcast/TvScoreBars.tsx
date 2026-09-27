/**
 * International TV-style live score bars for camera / OBS overlays.
 * Multiple selectable designs inspired by broadcast lower-thirds.
 */

import type { BallSummary, CompactState } from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { chaseCaption } from "@/lib/broadcast/chase";
import { overlayBrandLogo, overlayBrandMode, overlayBrandName } from "@/lib/broadcast/overlayBrand";
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
      <img src="/branding/odcc-live.png" alt="" className="h-7 w-7 object-contain" />
      <p className="font-sans text-[12px] font-semibold tracking-[0.18em] uppercase">ODCC LIVE</p>
    </div>
  );
}

function OverPills({
  balls,
  variant = "dark",
  size = "md",
}: {
  balls: BallSummary[] | undefined;
  variant?: "dark" | "light" | "green" | "purple";
  size?: "md" | "sm";
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
    <div className={cn("flex items-center", size === "sm" ? "gap-0.5" : "gap-1")}>
      {items.map((ball, i) => {
        const label = ball ? (ball.is_wicket ? "W" : ball.display === "." ? "•" : ball.display) : "";
        const hot =
          ball &&
          (ball.is_wicket || ball.batter_runs >= 4 || (ball.display || "").includes("6"));
        const tone =
          ball && ball.is_wicket
            ? "border-[#c0392b] bg-[#c0392b] text-white"
            : ball && (ball.batter_runs >= 6 || ball.display === "6" || (ball.display || "").startsWith("6"))
              ? "border-[#8e44ad] bg-[#8e44ad] text-white"
              : ball && (ball.batter_runs >= 4 || ball.display === "4" || (ball.display || "").startsWith("4"))
                ? "border-[#f1c40f] bg-[#f1c40f] text-ink"
                : styles;
        return (
          <span
            key={i}
            className={cn(
              "inline-flex items-center justify-center rounded-full border font-mono font-bold",
              size === "sm" ? "h-4 w-4 text-[8px]" : "h-5 w-5 text-[9px]",
              tone,
              hot && variant === "green" && !ball?.is_wicket && ball.batter_runs < 4 && "bg-flip text-ink",
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

/**
 * Circle crest — batters | center | bowler.
 *
 * Two compositions rather than one that stretches: the five-panel bar reads
 * well across a 1920px OBS canvas and collapses into an unreadable sliver on a
 * phone held in portrait, where the same information wants to stack. The
 * switch is a container query, so it follows the width the plate is actually
 * given rather than the viewport — the plate sits in a phone-sized frame even
 * on a desktop broadcast screen.
 */
function CircleBar({ state, dense = false }: { state: CompactState; dense?: boolean }) {
  if (dense) return <LandscapePlate state={state} />;
  return (
    <div className="@container w-full max-w-5xl">
      <div className="@3xl:hidden">
        <CompactPlate state={state} />
      </div>
      <div className="hidden @3xl:block">
        <CircleBarWide state={state} />
      </div>
    </div>
  );
}

/** Half-height strip for landscape camera — one row so the frame stays visible. */
function LandscapePlate({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? state.batting_team?.name ?? "BAT";
  const chase = chaseCaption(score, state.innings_sequence);

  return (
    <div className="flex w-full items-center gap-1.5 overflow-hidden rounded-[3px] border border-white/15 bg-ink/85 px-1.5 py-0.5 text-chalk shadow-tile backdrop-blur-sm">
      <LogoBadge
        url={state.batting_team?.logo_url}
        short={a}
        round
        className="h-4 w-4 ring-1 ring-white/30"
      />
      <p className="flex min-w-0 shrink-0 items-baseline gap-1">
        <span className="truncate font-sans text-[0.5rem] font-bold tracking-wide uppercase">
          {a}
        </span>
        <span className="font-mono text-sm leading-none font-black tabular">
          {score.runs}
          <span className="text-chalk/45">-</span>
          {score.wickets}
        </span>
        <span className="font-mono text-[0.48rem] font-semibold text-chalk/70 tabular">
          {score.overs_text}
        </span>
      </p>
      {chase ? (
        <p className="min-w-0 truncate font-sans text-[0.48rem] font-semibold text-flip">
          {chase}
        </p>
      ) : null}
      <div className="min-w-0 flex-1 truncate font-sans text-[0.5rem]">
        {[state.striker, state.non_striker].map((bat, i) =>
          bat ? (
            <span key={bat.player_id} className={cn(i > 0 && "ml-1.5 text-chalk/70")}>
              {i === 0 ? <span className="text-flip">▸ </span> : null}
              {bat.name}{" "}
              <span className="font-mono tabular">
                {bat.runs}({bat.balls_faced})
              </span>
            </span>
          ) : null,
        )}
        {state.bowler ? (
          <span className="ml-1.5 text-chalk/60">
            {state.bowler.name} {state.bowler.overs_text}-{state.bowler.runs_conceded}-{state.bowler.wickets}
          </span>
        ) : null}
      </div>
      <OverPills balls={state.recent_balls} size="sm" />
    </div>
  );
}

/**
 * The phone-shaped plate: score on top, then the crease, then the bowler and
 * the over. Everything is one glance deep and nothing truncates to initials.
 */
function CompactPlate({ state }: { state: CompactState }) {
  const score = state.score!;
  const a = state.batting_team?.short_name ?? state.batting_team?.name ?? "BAT";
  const b = state.bowling_team?.short_name ?? state.bowling_team?.name ?? "BWL";
  const chase = chaseCaption(score, state.innings_sequence);
  const brandName = overlayBrandName(state);
  const brandLogo = overlayBrandLogo(state);
  const brandMode = overlayBrandMode(state);
  const showBrand = brandMode === "name" ? Boolean(brandName) : brandMode === "logo" ? Boolean(brandLogo) : false;

  return (
    <div className="w-full overflow-hidden rounded-[4px] border border-white/15 bg-ink/85 text-chalk shadow-tile backdrop-blur-sm">
      {showBrand && (
        <div className="flex items-center gap-1 border-b border-white/10 px-1.5 py-0.5">
          {brandMode === "logo" && brandLogo ? (
            <img src={brandLogo} alt="" className="h-3 w-3 rounded-[2px] object-contain" />
          ) : null}
          {brandMode === "name" && brandName ? (
            <p className="truncate font-sans text-[0.48rem] font-bold tracking-[0.1em] uppercase text-chalk/80">
              {brandName}
            </p>
          ) : null}
        </div>
      )}
      <div className="flex items-center gap-1.5 border-b border-white/10 px-1.5 py-1">
        <LogoBadge
          url={state.batting_team?.logo_url}
          short={a}
          round
          className="h-5 w-5 ring-1 ring-white/30"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-sans text-[0.55rem] font-bold tracking-[0.08em] uppercase leading-tight">
            {a} <span className="text-chalk/45">v</span> {b}
          </p>
          {chase ? (
            <p className="truncate font-sans text-[0.5rem] font-semibold leading-tight text-flip">{chase}</p>
          ) : (
            <p className="truncate font-sans text-[0.5rem] leading-tight text-chalk/55 tabular">
              CRR {score.run_rate.toFixed(2)}
            </p>
          )}
        </div>
        <p className="flex shrink-0 items-baseline gap-1">
          <span className="font-mono text-base leading-none font-black tabular">
            {score.runs}
            <span className="text-chalk/45">-</span>
            {score.wickets}
          </span>
          <span className="font-mono text-[0.52rem] font-semibold text-chalk/70 tabular">
            {score.overs_text}
          </span>
        </p>
      </div>

      {(state.striker || state.non_striker) && (
        <div className="grid grid-cols-2 gap-x-2 px-1.5 py-0.5 font-sans text-[0.58rem]">
          {[state.striker, state.non_striker].map((bat, i) =>
            bat ? (
              <div key={bat.player_id} className="flex min-w-0 items-center gap-1">
                <span className={cn("min-w-0 truncate", i === 0 && "font-bold")}>
                  {i === 0 && <span className="text-flip">▸ </span>}
                  {bat.name}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[0.62rem] font-bold tabular">
                  {bat.runs}
                  <span className="text-chalk/50">({bat.balls_faced})</span>
                </span>
              </div>
            ) : null,
          )}
        </div>
      )}

      {state.bowler && (
        <div className="flex items-center gap-1.5 border-t border-white/10 px-1.5 py-0.5">
          <div className="min-w-0 flex-1 font-sans text-[0.58rem] leading-tight">
            <span className="truncate font-semibold">{state.bowler.name}</span>
            <span className="ml-1 font-mono text-chalk/70 tabular">
              {state.bowler.overs_text}-{state.bowler.runs_conceded}-{state.bowler.wickets}
            </span>
          </div>
          <OverPills balls={state.recent_balls} size="sm" />
        </div>
      )}
    </div>
  );
}

function CircleBarWide({ state }: { state: CompactState }) {
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
            <span className="rounded-[2px] bg-pitch px-1.5 text-chalk">
              Tgt {score.target_runs}
            </span>
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
        {(state.toss?.decision || score.target_runs != null || score.runs_needed != null) && (
          <p className="mt-0.5 truncate font-sans text-[9px] text-ink/70 uppercase">
            {chaseCaption(score, state.innings_sequence) ??
              (state.toss?.winner?.short_name
                ? `Toss ${state.toss.winner.short_name} · ${state.toss.decision ?? ""}`
                : "")}
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
  const need = chaseCaption(score, state.innings_sequence);
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
  const brandMode = overlayBrandMode(state);
  const brandName = overlayBrandName(state);
  const brandLogo = overlayBrandLogo(state);
  const heading =
    brandMode === "name" && brandName
      ? brandName.slice(0, 28)
      : brandMode === "logo"
        ? ""
        : `${a} vs ${b}`;
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
        {brandMode === "logo" && brandLogo ? (
          <img src={brandLogo} alt="" className="mb-0.5 h-6 w-6 rounded-[2px] object-contain" />
        ) : heading ? (
          <p className="font-sans text-[9px] font-black tracking-[0.14em] uppercase">{heading}</p>
        ) : null}
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

function ChaseBanner({ state }: { state: CompactState }) {
  const chase = chaseCaption(state.score, state.innings_sequence);
  if (!chase) return null;
  return (
    <div className="mb-1 w-full max-w-5xl rounded-[3px] border border-flip/45 bg-ink/90 px-2 py-1 text-center shadow-tile">
      <p className="font-sans text-[11px] font-black tracking-[0.14em] text-flip uppercase">{chase}</p>
    </div>
  );
}

/** ICC 2021–2024 lower third: flags, crease, centre score, bowler, this over. */
function IccBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const bat = state.batting_team?.short_name ?? "BAT";
  const bowl = state.bowling_team?.short_name ?? "BWL";
  const chase = chaseCaption(score, state.innings_sequence);
  return (
    <div className="flex w-full max-w-5xl items-stretch overflow-hidden rounded-sm bg-[#071018]/92 text-chalk shadow-tile">
      <LogoBadge
        url={state.batting_team?.logo_url}
        short={bat}
        round
        className="m-1 h-11 w-11 self-center ring-2 ring-white/40"
      />
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1 font-sans text-[11px] uppercase">
        {[state.striker, state.non_striker].map((batter, i) =>
          batter ? (
            <div key={batter.player_id} className="flex items-baseline gap-2">
              <span className={cn("min-w-0 truncate", i === 0 && "font-black text-flip")}>
                {i === 0 ? "▸ " : ""}
                {batter.name}
              </span>
              <span className="ml-auto font-mono tabular">
                <span className="font-black">{batter.runs}</span>{" "}
                <span className="opacity-55">{batter.balls_faced}</span>
              </span>
            </div>
          ) : null,
        )}
      </div>
      <div className="flex min-w-[11rem] flex-col items-center justify-center bg-[#123a66] px-3 py-1.5">
        <p className="font-sans text-[10px] font-bold tracking-wide uppercase opacity-80">
          {bat} v {bowl}
        </p>
        <p className="font-mono text-2xl font-black tabular leading-none">
          {score.runs}-{score.wickets}
          <span className="ml-1 text-sm font-semibold opacity-80">{score.overs_text}</span>
        </p>
        {chase ? (
          <p className="max-w-[14rem] truncate font-sans text-[9px] font-bold tracking-wide text-[#f3d36a] uppercase">
            {chase}
          </p>
        ) : (
          <p className="font-sans text-[9px] uppercase opacity-70">CRR {score.run_rate.toFixed(2)}</p>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col items-end justify-center gap-0.5 px-2 py-1">
        {state.bowler ? (
          <p className="max-w-full truncate font-sans text-[11px] font-bold uppercase">
            {state.bowler.name}{" "}
            <span className="font-mono font-semibold tabular opacity-80">
              {state.bowler.overs_text}-{state.bowler.runs_conceded}-{state.bowler.wickets}
            </span>
          </p>
        ) : null}
        <OverPills balls={state.recent_balls} size="sm" />
      </div>
      <LogoBadge
        url={state.bowling_team?.logo_url}
        short={bowl}
        round
        className="m-1 h-11 w-11 self-center ring-2 ring-white/40"
      />
    </div>
  );
}

/** Broadcast strip: this-over balls, target, batters and bowler. */
function StatBar({ state }: { state: CompactState }) {
  const score = state.score!;
  const bat = state.batting_team?.short_name ?? "BAT";
  const target = score.target_runs;
  return (
    <div className="w-full max-w-5xl overflow-hidden rounded-sm bg-gradient-to-r from-[#2a1050] via-[#4a1a7a] to-[#2a1050] text-chalk shadow-tile">
      <div className="flex items-center gap-2 px-2 py-1">
        <LogoBadge url={state.batting_team?.logo_url} short={bat} round className="h-9 w-9 ring-1 ring-white/30" />
        <div className="flex items-center gap-2 rounded-sm bg-[#1a0a33] px-2 py-1">
          <span className="font-sans text-[11px] font-black tracking-wide uppercase">{bat}</span>
          <span className="font-mono text-lg font-black tabular leading-none">
            {score.runs}-{score.wickets}
          </span>
          <span className="font-mono text-[11px] tabular opacity-80">{score.overs_text}</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 font-sans text-[9px] font-bold tracking-[0.12em] uppercase opacity-70">
            This over
          </span>
          <OverPills balls={state.recent_balls} variant="purple" />
        </div>
        {target != null ? (
          <div className="rounded-sm bg-[#6d28d9] px-2 py-1 text-center">
            <p className="font-sans text-[8px] font-bold tracking-[0.14em] uppercase opacity-80">Target</p>
            <p className="font-mono text-lg font-black leading-none tabular">{target}</p>
          </div>
        ) : (
          <p className="font-mono text-xs tabular opacity-80">CRR {score.run_rate.toFixed(2)}</p>
        )}
        <LogoBadge
          url={state.bowling_team?.logo_url}
          short={state.bowling_team?.short_name}
          round
          className="h-9 w-9 ring-1 ring-white/30"
        />
      </div>
      <div className="flex items-center gap-3 border-t border-white/10 bg-black/20 px-3 py-1 font-sans text-[11px] uppercase">
        {[state.striker, state.non_striker].map((batter, i) =>
          batter ? (
            <span key={batter.player_id} className={cn("flex gap-1.5", i === 0 && "font-black text-[#c4b5fd]")}>
              {i === 0 ? "▸ " : ""}
              {batter.name}{" "}
              <span className="font-mono tabular">
                {batter.runs}({batter.balls_faced})
              </span>
            </span>
          ) : null,
        )}
        {state.bowler ? (
          <span className="ml-auto font-semibold">
            {state.bowler.name}{" "}
            <span className="font-mono tabular">
              {state.bowler.wickets}-{state.bowler.runs_conceded} {state.bowler.overs_text}
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function TvScoreOverlay({
  state,
  design,
  showPlayerCard = true,
  className,
  dense = false,
}: {
  state: CompactState;
  design: OverlayDesignId;
  showPlayerCard?: boolean;
  className?: string;
  /** Landscape camera: half-height strip so more of the frame is visible. */
  dense?: boolean;
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
    if (dense) return <LandscapePlate state={state} />;
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
      case "icc":
        return <IccBar state={state} />;
      case "stat":
        return <StatBar state={state} />;
      default:
        return <CircleBar state={state} />;
    }
  })();

  return (
    <div className={cn("flex w-full max-w-5xl flex-col items-center", className)}>
      {design === "icc" || design === "stat" ? null : <ChaseBanner state={state} />}
      {bar}
    </div>
  );
}
