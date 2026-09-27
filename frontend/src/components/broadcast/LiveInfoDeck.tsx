/**
 * A swipeable deck of live match information: what is happening at the crease,
 * the current scorecard, each innings in full, and the squads.
 *
 * Built on CSS scroll-snap rather than a carousel library. That gives native
 * momentum, rubber-banding and horizontal-swipe handling on a phone for free,
 * keeps the panels reachable by keyboard and screen reader, and adds nothing to
 * the bundle. The tab strip and the dots are two views of the same index, so
 * dragging the deck and tapping a tab stay in sync.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  BallSummary,
  BatterCard,
  BowlerCard,
  CompactState,
  InningsSnapshot,
  MatchSnapshot,
  SquadMember,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { RunRateGraph, WormGraph } from "@/components/broadcast/BroadcastMatchCharts";

export type LiveDeckPanelId =
  | "live"
  | "scorecard"
  | "innings1"
  | "innings2"
  | "squad"
  | "over"
  | "worm"
  | "runrate"
  | "sponsor"
  | "summary";

const PANEL_LABELS: Record<LiveDeckPanelId, { tab: string; title: string }> = {
  live: { tab: "Live", title: "At the crease" },
  scorecard: { tab: "Card", title: "Scorecard" },
  over: { tab: "Overs", title: "Over analysis" },
  worm: { tab: "Worm", title: "Worm graph" },
  runrate: { tab: "Run rate", title: "Run rate" },
  innings1: { tab: "1st", title: "1st innings" },
  innings2: { tab: "2nd", title: "2nd innings" },
  squad: { tab: "Squads", title: "Squads" },
  sponsor: { tab: "Sponsor", title: "Sponsors" },
  summary: { tab: "Summary", title: "Match summary" },
};

const DEFAULT_PANELS: LiveDeckPanelId[] = [
  "live",
  "scorecard",
  "over",
  "worm",
  "runrate",
  "innings1",
  "innings2",
  "squad",
  "summary",
  "sponsor",
];

// --------------------------------------------------------------- small pieces

function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-willow-soft", className)}>{children}</span>;
}

function PanelHeading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <p className="font-sans text-[0.6rem] font-bold tracking-[0.16em] text-willow-soft uppercase">
        {children}
      </p>
      {right}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-6 text-center font-sans text-xs text-willow-soft">{children}</p>
  );
}

/** Runs off the bat, wickets and extras all read differently at a glance. */
function BallPills({ balls, limit = 8 }: { balls: BallSummary[] | undefined; limit?: number }) {
  if (!balls?.length) return null;
  const shown = balls.slice(-limit);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((ball) => (
        <span
          key={ball.delivery_id}
          className={cn(
            "grid h-6 min-w-6 place-items-center rounded-full border px-1.5",
            "font-mono text-[0.65rem] font-bold tabular-nums",
            ball.is_wicket
              ? "border-boundary bg-boundary/25 text-chalk"
              : ball.batter_runs >= 4
                ? "border-flip bg-flip/20 text-flip"
                : ball.extra_type
                  ? "border-willow/50 bg-willow/10 text-willow-soft"
                  : "border-willow/30 text-chalk/80",
          )}
        >
          {ball.display}
        </span>
      ))}
    </div>
  );
}

function dismissal(batter: BatterCard): string {
  if (batter.is_out) return batter.dismissal_text ?? "out";
  if (batter.is_striker || batter.is_non_striker) return "batting";
  if (batter.has_batted) return "not out";
  return "yet to bat";
}

// ------------------------------------------------------------------ hero score

function ScoreHero({
  battingName,
  bowlingName,
  runs,
  wickets,
  oversText,
  runRate,
  requiredRunRate,
  target,
  runsNeeded,
  ballsRemaining,
}: {
  battingName: string;
  bowlingName?: string;
  runs: number;
  wickets: number;
  oversText: string;
  runRate?: number | null;
  requiredRunRate?: number | null;
  target?: number | null;
  runsNeeded?: number | null;
  ballsRemaining?: number | null;
}) {
  return (
    <div className="mb-2 rounded-[4px] border border-willow/20 bg-pitch/50 px-2 py-1.5">
      <p className="font-sans text-[0.55rem] font-bold tracking-[0.16em] text-willow-soft uppercase">
        {battingName}
        {bowlingName ? <Muted> v {bowlingName}</Muted> : null}
      </p>
      <p className="mt-0.5 flex items-baseline gap-1.5">
        <span className="font-mono text-[1.35rem] leading-none font-black text-chalk tabular-nums">
          {runs}
          <span className="text-willow-soft">/</span>
          {wickets}
        </span>
        <span className="font-mono text-sm text-chalk/70 tabular-nums">{oversText} ov</span>
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-sans text-[0.65rem] text-willow-soft tabular-nums">
        {runRate != null && <span>CRR {runRate.toFixed(2)}</span>}
        {requiredRunRate != null && <span>RRR {requiredRunRate.toFixed(2)}</span>}
        {target != null && <span>Target {target}</span>}
      </div>
      {runsNeeded != null && runsNeeded > 0 && (
        <p className="mt-1.5 rounded-[2px] border border-flip/50 bg-flip/10 px-2 py-1 font-sans text-[0.7rem] font-semibold text-flip">
          Need {runsNeeded}
          {ballsRemaining != null ? ` from ${ballsRemaining} ball${ballsRemaining === 1 ? "" : "s"}` : ""}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ innings tables

function BattingTable({ innings }: { innings: InningsSnapshot }) {
  const all = innings.state.batting;
  const shown = all.filter(
    (b) => b.has_batted || b.is_out || b.is_striker || b.is_non_striker,
  );
  const yetToBat = all.filter((b) => !b.has_batted && !b.is_out);
  const extras = innings.state.extras;

  if (shown.length === 0) return <Empty>No one has batted yet.</Empty>;

  return (
    <div>
      <table className="w-full border-collapse font-sans text-[0.7rem]">
        <thead>
          <tr className="text-willow-soft">
            <th className="pb-1 text-left font-semibold">Batter</th>
            <th className="pb-1 pl-2 text-right font-semibold">R</th>
            <th className="pb-1 pl-2 text-right font-semibold">B</th>
            <th className="hidden pb-1 pl-2 text-right font-semibold @xs:table-cell">4s</th>
            <th className="hidden pb-1 pl-2 text-right font-semibold @xs:table-cell">6s</th>
            <th className="pb-1 pl-2 text-right font-semibold">SR</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((b) => (
            <tr key={b.player_id} className="border-t border-willow/15 align-top">
              <td className="py-1 pr-1">
                <span className="font-medium text-chalk">
                  {b.name}
                  {b.is_striker && <span className="text-flip"> *</span>}
                  {b.is_non_striker && <span className="text-willow-soft"> †</span>}
                </span>
                <span className="block text-[0.6rem] leading-tight text-willow-soft">
                  {dismissal(b)}
                </span>
              </td>
              <td className="py-1 pl-2 text-right font-mono font-bold text-chalk tabular-nums">
                {b.runs}
              </td>
              <td className="py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums">
                {b.balls_faced}
              </td>
              <td className="hidden py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums @xs:table-cell">
                {b.fours}
              </td>
              <td className="hidden py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums @xs:table-cell">
                {b.sixes}
              </td>
              <td className="py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums">
                {b.strike_rate.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-willow/30 font-sans">
            <td className="py-1 text-left text-willow-soft">
              Extras
              <Muted className="pl-1 text-[0.6rem]">
                (b {extras.bye}, lb {extras.leg_bye}, w {extras.wide}, nb {extras.no_ball}
                {extras.penalty > 0 ? `, pen ${extras.penalty}` : ""})
              </Muted>
            </td>
            <td
              colSpan={5}
              className="py-1 pl-2 text-right font-mono font-bold text-chalk tabular-nums"
            >
              {extras.total}
            </td>
          </tr>
          <tr className="border-t border-willow/30">
            <td className="py-1 text-left font-semibold text-chalk">
              Total
              <Muted className="pl-1 text-[0.6rem] font-normal">
                {innings.state.overs_text} ov · RR {innings.state.run_rate.toFixed(2)}
              </Muted>
            </td>
            <td
              colSpan={5}
              className="py-1 pl-2 text-right font-mono font-bold text-chalk tabular-nums"
            >
              {innings.state.total_runs}/{innings.state.wickets}
            </td>
          </tr>
        </tfoot>
      </table>
      {yetToBat.length > 0 && (
        <p className="mt-1.5 font-sans text-[0.6rem] leading-snug text-willow-soft">
          <span className="font-semibold">Yet to bat: </span>
          {yetToBat.map((b) => b.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function BowlingTable({ bowlers }: { bowlers: BowlerCard[] }) {
  const shown = bowlers.filter((b) => b.balls_bowled > 0 || b.is_current_bowler);
  if (shown.length === 0) return null;
  return (
    <table className="w-full border-collapse font-sans text-[0.7rem]">
      <thead>
        <tr className="text-willow-soft">
          <th className="pb-1 text-left font-semibold">Bowler</th>
          <th className="pb-1 pl-2 text-right font-semibold">O</th>
          <th className="hidden pb-1 pl-2 text-right font-semibold @xs:table-cell">M</th>
          <th className="pb-1 pl-2 text-right font-semibold">R</th>
          <th className="pb-1 pl-2 text-right font-semibold">W</th>
          <th className="pb-1 pl-2 text-right font-semibold">Econ</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((b) => (
          <tr key={b.player_id} className="border-t border-willow/15">
            <td className="py-1 pr-1 font-medium text-chalk">
              {b.name}
              {b.is_current_bowler && <span className="text-flip"> ▸</span>}
            </td>
            <td className="py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums">
              {b.overs_text}
            </td>
            <td className="hidden py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums @xs:table-cell">
              {b.maidens}
            </td>
            <td className="py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums">
              {b.runs_conceded}
            </td>
            <td className="py-1 pl-2 text-right font-mono font-bold text-chalk tabular-nums">
              {b.wickets}
            </td>
            <td className="py-1 pl-2 text-right font-mono text-chalk/70 tabular-nums">
              {b.economy.toFixed(2)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FallOfWickets({ innings }: { innings: InningsSnapshot }) {
  const fow = innings.state.fall_of_wickets;
  if (!fow.length) return null;
  return (
    <p className="font-sans text-[0.6rem] leading-relaxed text-willow-soft">
      <span className="font-semibold">Fall of wickets: </span>
      {fow
        .map((w) => `${w.runs_at_fall}-${w.wicket_number} (${w.batter_name}, ${w.overs_text})`)
        .join(", ")}
    </p>
  );
}

function InningsPanel({ innings }: { innings: InningsSnapshot }) {
  return (
    <div className="space-y-3">
      <ScoreHero
        battingName={innings.batting_team_name}
        bowlingName={innings.bowling_team_name}
        runs={innings.state.total_runs}
        wickets={innings.state.wickets}
        oversText={innings.state.overs_text}
        runRate={innings.state.run_rate}
        requiredRunRate={innings.state.required_run_rate}
        target={innings.state.target_runs}
        runsNeeded={innings.state.runs_needed}
        ballsRemaining={innings.state.balls_remaining}
      />
      <BattingTable innings={innings} />
      <FallOfWickets innings={innings} />
      <div>
        <PanelHeading>Bowling</PanelHeading>
        <BowlingTable bowlers={innings.state.bowling} />
      </div>
    </div>
  );
}

// -------------------------------------------------------------- live / crease

function Face({
  src,
  name,
  accent,
}: {
  src?: string | null;
  name: string;
  accent?: boolean;
}) {
  return (
    <span
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border bg-pitch-line font-sans text-[0.7rem] font-bold text-chalk",
        accent ? "border-flip/70 ring-1 ring-flip/40" : "border-willow/30",
      )}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        (name[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

function CreaseRow({
  name,
  detail,
  sub,
  photo,
  mark,
  emphasis,
}: {
  name: string;
  detail: string;
  sub?: string;
  photo?: string | null;
  mark?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-[6px] border px-2 py-2",
        emphasis
          ? "border-flip/50 bg-gradient-to-r from-flip/15 to-transparent"
          : "border-willow/20 bg-white/[0.03]",
      )}
    >
      <Face src={photo} name={name} accent={emphasis} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-sans text-[0.74rem] font-semibold text-chalk">
          {mark && <span className="text-flip">{mark} </span>}
          {name}
        </p>
        {sub && (
          <p className="truncate font-sans text-[0.6rem] text-willow-soft">{sub}</p>
        )}
      </div>
      <span className="shrink-0 font-mono text-[0.78rem] font-bold text-chalk tabular-nums">
        {detail}
      </span>
    </div>
  );
}

function LivePanel({
  state,
  innings,
}: {
  state: CompactState | null;
  innings: InningsSnapshot | null;
}) {
  const score = state?.score;
  if (!score && !innings) return <Empty>Waiting for the first ball…</Empty>;

  const battingName =
    state?.batting_team?.short_name ??
    state?.batting_team?.name ??
    innings?.batting_team_name ??
    "Batting";
  const bowlingName =
    state?.bowling_team?.short_name ??
    state?.bowling_team?.name ??
    innings?.bowling_team_name;

  const partnership = state?.current_partnership ?? innings?.state.current_partnership ?? null;
  const recent = state?.recent_balls ?? innings?.state.recent_balls ?? innings?.state.timeline;

  return (
    <div className="space-y-3">
      <ScoreHero
        battingName={battingName}
        bowlingName={bowlingName}
        runs={score?.runs ?? innings?.state.total_runs ?? 0}
        wickets={score?.wickets ?? innings?.state.wickets ?? 0}
        oversText={score?.overs_text ?? innings?.state.overs_text ?? "0.0"}
        runRate={score?.run_rate ?? innings?.state.run_rate}
        requiredRunRate={score?.required_run_rate ?? innings?.state.required_run_rate}
        target={score?.target_runs ?? innings?.state.target_runs}
        runsNeeded={score?.runs_needed ?? innings?.state.runs_needed}
        ballsRemaining={score?.balls_remaining ?? innings?.state.balls_remaining}
      />

      {score?.is_free_hit && (
        <p className="rounded-[2px] border border-flip bg-flip/20 px-2 py-1 text-center font-sans text-[0.65rem] font-bold tracking-[0.14em] text-flip uppercase">
          Free hit
        </p>
      )}

      <div className="space-y-1.5">
        <PanelHeading>Batting</PanelHeading>
        {state?.striker && (
          <CreaseRow
            emphasis
            mark="*"
            name={state.striker.name}
            photo={state.striker.photo_url}
            sub={`${state.striker.fours}×4 · ${state.striker.sixes}×6 · SR ${state.striker.strike_rate.toFixed(0)}`}
            detail={`${state.striker.runs} (${state.striker.balls_faced})`}
          />
        )}
        {state?.non_striker && (
          <CreaseRow
            mark="†"
            name={state.non_striker.name}
            photo={state.non_striker.photo_url}
            sub={`${state.non_striker.fours}×4 · ${state.non_striker.sixes}×6 · SR ${state.non_striker.strike_rate.toFixed(0)}`}
            detail={`${state.non_striker.runs} (${state.non_striker.balls_faced})`}
          />
        )}
        {!state?.striker && !state?.non_striker && (
          <Empty>No batters at the crease.</Empty>
        )}
        {partnership && (
          <p className="pt-0.5 font-sans text-[0.62rem] text-willow-soft tabular-nums">
            Partnership {partnership.runs} ({partnership.balls})
          </p>
        )}
      </div>

      {state?.bowler && (
        <div className="space-y-1.5">
          <PanelHeading>Bowling</PanelHeading>
          <CreaseRow
            name={state.bowler.name}
            photo={state.bowler.photo_url}
            sub={`Econ ${state.bowler.economy.toFixed(2)}${state.bowler.maidens > 0 ? ` · ${state.bowler.maidens} md` : ""}`}
            detail={`${state.bowler.overs_text}-${state.bowler.maidens}-${state.bowler.runs_conceded}-${state.bowler.wickets}`}
          />
        </div>
      )}

      {recent && recent.length > 0 && (
        <div>
          <PanelHeading>This over</PanelHeading>
          <BallPills balls={recent} />
        </div>
      )}
    </div>
  );
}

function OverPanel({
  innings,
  state,
}: {
  innings: InningsSnapshot | null;
  state: CompactState | null;
}) {
  const overs = innings?.state.overs ?? [];
  const recent = state?.recent_balls ?? innings?.state.recent_balls ?? innings?.state.timeline;
  const target = state?.score?.target_runs ?? innings?.state.target_runs;
  const needed = state?.score?.runs_needed ?? innings?.state.runs_needed;
  const ballsLeft = state?.score?.balls_remaining ?? innings?.state.balls_remaining;
  const maxRuns = Math.max(1, ...overs.map((o) => o.runs), 1);

  if (!overs.length && !recent?.length) {
    return <Empty>Waiting for the first over.</Empty>;
  }

  return (
    <div className="space-y-3">
      {(target || needed != null) && (
        <p className="rounded-[2px] border border-flip/40 bg-flip/10 px-2 py-1.5 text-center font-sans text-[0.7rem] font-semibold text-chalk">
          {target ? `Target ${target}` : null}
          {needed != null && ballsLeft != null
            ? `${target ? " · " : ""}Need ${needed} from ${ballsLeft}`
            : null}
        </p>
      )}

      {recent && recent.length > 0 && (
        <div>
          <PanelHeading>This over</PanelHeading>
          <BallPills balls={recent} limit={12} />
        </div>
      )}

      {overs.length > 0 && (
        <div>
          <PanelHeading right={<Muted className="font-mono text-[0.62rem]">{overs.length} ov</Muted>}>
            Runs per over
          </PanelHeading>
          <ol className="grid grid-cols-6 gap-1 sm:grid-cols-8">
            {overs.map((over) => (
              <li
                key={over.over_number}
                className="flex flex-col items-center rounded-[2px] border border-willow/25 bg-ink/40 px-0.5 py-1"
              >
                <span className="font-mono text-[0.55rem] text-willow-soft tabular-nums">
                  {over.over_number}
                </span>
                <span
                  className="mt-0.5 w-full rounded-[1px] bg-flip/80"
                  style={{ height: `${Math.max(4, (over.runs / maxRuns) * 28)}px` }}
                  title={`${over.runs} runs`}
                />
                <span
                  className={cn(
                    "font-mono text-[0.62rem] font-bold tabular-nums",
                    over.wickets > 0 ? "text-boundary" : "text-chalk",
                  )}
                >
                  {over.runs}
                  {over.wickets > 0 ? `/${over.wickets}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {overs.length > 0 && (
        <ol className="space-y-1">
          {overs.slice(-8).reverse().map((over) => (
            <li
              key={`row-${over.over_number}`}
              className="flex items-baseline justify-between gap-2 border-t border-willow/15 py-1 font-sans text-[0.68rem] first:border-t-0"
            >
              <span className="text-willow-soft">
                Ov {over.over_number}
                {over.bowler_name ? ` · ${over.bowler_name}` : ""}
                {over.is_maiden ? " · maiden" : ""}
              </span>
              <span className="font-mono font-bold text-chalk tabular-nums">
                {over.runs}
                {over.wickets ? `/${over.wickets}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- squads

const ROLE_SHORT: Record<string, string> = {
  batter: "Bat",
  bowler: "Bowl",
  allrounder: "AR",
  wicket_keeper: "WK",
};

function PlayerAvatar({ member }: { member: SquadMember }) {
  const initials = member.name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  if (member.photo_url) {
    return (
      <img
        src={member.photo_url}
        alt=""
        className="size-6 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-willow/20 font-sans text-[0.55rem] font-bold text-flip">
      {initials || "•"}
    </span>
  );
}

function SquadPanel({ snapshot }: { snapshot: MatchSnapshot | null }) {
  const squads = snapshot?.squads;
  const teams = snapshot?.match?.teams
    ? [snapshot.match.teams.a, snapshot.match.teams.b]
    : [];

  if (!squads || teams.length === 0) return <Empty>Squads are not loaded yet.</Empty>;

  return (
    <div className="grid gap-2 @md:grid-cols-2">
      {teams.map((team) => {
        const members: SquadMember[] = (squads[team.id] ?? []).filter((m) => m.is_playing);
        return (
          <div key={team.id}>
            <PanelHeading>{team.name}</PanelHeading>
            {members.length === 0 ? (
              <Empty>Not announced.</Empty>
            ) : (
              <ol className="space-y-0">
                {members.slice(0, 11).map((m, i) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-1.5 border-t border-willow/15 py-0.5 font-sans text-[0.65rem] first:border-t-0"
                  >
                    <span className="w-3.5 shrink-0 font-mono text-[0.55rem] text-willow-soft tabular-nums">
                      {i + 1}
                    </span>
                    <PlayerAvatar member={m} />
                    <span className="min-w-0 flex-1 truncate text-chalk">
                      {m.jersey_number != null ? (
                        <Muted className="mr-1 text-[0.55rem]">#{m.jersey_number}</Muted>
                      ) : null}
                      {m.name}
                      {m.is_captain && <Muted className="text-[0.55rem]"> (c)</Muted>}
                      {m.is_wicket_keeper && <Muted className="text-[0.55rem]"> (wk)</Muted>}
                    </span>
                    {m.role && ROLE_SHORT[m.role] ? (
                      <Muted className="shrink-0 text-[0.5rem] uppercase">{ROLE_SHORT[m.role]}</Muted>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SponsorPanel({ state }: { state: CompactState | null }) {
  const urls = (state?.graphics?.sponsors ?? [])
    .filter((item) => item.on !== false && item.url?.trim())
    .map((item) => item.url.trim());
  const legacy = state?.graphics?.sponsor_logo_url?.trim();
  const list = urls.length > 0 ? urls : legacy ? [legacy] : [];
  if (list.length === 0) {
    return <Empty>Upload a sponsor logo from On the live screen.</Empty>;
  }
  const grid = list.length > 1 || state?.graphics?.sponsor_layout === "grid";
  if (!grid) {
    return (
      <div className="flex min-h-[10rem] items-center justify-center py-3">
        <img src={list[0]} alt="Sponsor" className="max-h-48 max-w-full object-contain" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 py-2 @md:grid-cols-3">
      {list.map((url, i) => (
        <div key={`${url}-${i}`} className="flex min-h-[4.5rem] items-center justify-center rounded-[3px] bg-ink/40 p-2">
          <img src={url} alt="Sponsor" className="max-h-24 max-w-full object-contain" />
        </div>
      ))}
    </div>
  );
}

function SummaryPanel({ snapshot, state }: { snapshot: MatchSnapshot | null; state: CompactState | null }) {
  const inns = snapshot?.innings ?? [];
  const summary = snapshot?.result?.summary || state?.result_summary;
  if (inns.length === 0 && !summary) return <Empty>Match summary will appear here.</Empty>;
  return (
    <div className="flex flex-col gap-2">
      {summary ? <p className="font-sans text-sm font-semibold text-flip">{summary}</p> : null}
      {inns.map((inn) => (
        <p key={inn.id} className="font-sans text-[0.75rem] text-chalk">
          {inn.batting_team_name}{" "}
          <span className="font-mono font-bold">
            {inn.state.total_runs}/{inn.state.wickets}
          </span>{" "}
          <Muted>({inn.state.overs_text} ov)</Muted>
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------- deck

export function LiveInfoDeck({
  state,
  snapshot,
  panels = DEFAULT_PANELS,
  variant = "overlay",
  className,
  onClose,
  activePanel,
}: {
  state: CompactState | null;
  snapshot: MatchSnapshot | null;
  panels?: LiveDeckPanelId[];
  /** `overlay` sits over video; `panel` is an opaque block in a page. */
  variant?: "overlay" | "panel";
  className?: string;
  onClose?: () => void;
  /** When set, the deck follows the live director instead of a local swipe. */
  activePanel?: LiveDeckPanelId;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const programmatic = useRef(false);
  const visiblePanels = activePanel ? [activePanel] : panels;

  const current = useMemo(
    () =>
      snapshot?.innings.find((i) => i.id === snapshot.current_innings_id) ??
      snapshot?.innings.at(-1) ??
      null,
    [snapshot],
  );
  const innings1 = snapshot?.innings.find((i) => i.sequence === 1) ?? snapshot?.innings[0] ?? null;
  const innings2 = snapshot?.innings.find((i) => i.sequence === 2) ?? snapshot?.innings[1] ?? null;

  // The deck is the source of truth for the index while the finger is down;
  // a tab tap flips that around for the duration of the smooth scroll.
  const handleScroll = useCallback(() => {
    const el = trackRef.current;
    if (!el || programmatic.current) return;
    const width = el.clientWidth || 1;
    const next = Math.max(0, Math.min(visiblePanels.length - 1, Math.round(el.scrollLeft / width)));
    setIndex((prev) => (prev === next ? prev : next));
  }, [visiblePanels.length]);

  const goTo = useCallback((next: number) => {
    const el = trackRef.current;
    setIndex(next);
    if (!el) return;
    programmatic.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const left = next * el.clientWidth;
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ left, behavior: reduce ? "auto" : "smooth" });
    } else {
      el.scrollLeft = left;
    }
    // Re-arm scroll tracking once the smooth scroll has settled.
    window.setTimeout(() => {
      programmatic.current = false;
    }, 420);
  }, []);

  useEffect(() => {
    if (!activePanel) return;
    goTo(0);
  }, [activePanel, goTo]);

  // Keep the visible panel pinned to its slide when the container is resized
  // (phone rotation, or the drawer that holds the deck changing width).
  useEffect(() => {
    const el = trackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      el.scrollLeft = index * el.clientWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [index]);

  const body = (id: LiveDeckPanelId) => {
    switch (id) {
      case "live":
        return <LivePanel state={state} innings={current} />;
      case "scorecard":
        return current ? <InningsPanel innings={current} /> : <Empty>No innings yet.</Empty>;
      case "innings1":
        return innings1 ? <InningsPanel innings={innings1} /> : <Empty>Not started.</Empty>;
      case "innings2":
        return innings2 ? <InningsPanel innings={innings2} /> : <Empty>Not started.</Empty>;
      case "over":
        return <OverPanel innings={current} state={state} />;
      case "worm":
        return <WormGraph snapshot={snapshot} />;
      case "runrate":
        return <RunRateGraph snapshot={snapshot} />;
      case "squad":
        return <SquadPanel snapshot={snapshot} />;
      case "summary":
        return <SummaryPanel snapshot={snapshot} state={state} />;
      case "sponsor":
        return <SponsorPanel state={state} />;
    }
  };

  const overlay = variant === "overlay";

  return (
    <section
      aria-label="Live match information"
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-[4px] border",
        overlay
          ? "border-willow/25 bg-ink/88 shadow-lg backdrop-blur-md"
          : "border-pitch-line bg-pitch-deep",
        className,
      )}
    >
      <header className="flex items-center gap-1 border-b border-willow/20 px-1.5 py-1.5">
        <div
          role="tablist"
          aria-label="Match information panels"
          className="deck-track flex min-w-0 flex-1 gap-1 overflow-x-auto"
        >
          {visiblePanels.map((id, i) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={i === index}
              onClick={() => goTo(i)}
              className={cn(
                "shrink-0 rounded-[2px] border px-2 py-1 font-sans text-[0.62rem] font-bold tracking-[0.1em] uppercase transition-colors",
                i === index
                  ? "border-flip/70 bg-flip/15 text-flip"
                  : "border-transparent text-willow-soft hover:border-willow/40 hover:text-chalk",
              )}
            >
              {PANEL_LABELS[id].tab}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide match information"
            className="shrink-0 rounded-[2px] border border-willow/30 px-1.5 py-1 font-sans text-[0.7rem] leading-none text-willow-soft hover:border-willow/60 hover:text-chalk"
          >
            ✕
          </button>
        )}
      </header>

      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="deck-track flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {visiblePanels.map((id, i) => (
          <div
            key={id}
            role="tabpanel"
            aria-hidden={i !== index}
            // A container, so the tables drop their 4s/6s/maidens columns based
            // on the deck's own width rather than the viewport's.
            className="@container w-full shrink-0 snap-center overflow-y-auto px-2 py-1.5"
          >
            <PanelHeading>{PANEL_LABELS[id].title}</PanelHeading>
            {body(id)}
          </div>
        ))}
      </div>

      {visiblePanels.length > 1 && (
        <footer className="flex items-center justify-center gap-1.5 border-t border-willow/20 py-1.5">
          {visiblePanels.map((id, i) => (
            <button
              key={id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show ${PANEL_LABELS[id].title}`}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-4 bg-flip" : "w-1.5 bg-willow/50 hover:bg-willow",
              )}
            />
          ))}
        </footer>
      )}
    </section>
  );
}
