/**
 * Operator info overlays on the camera / device preview:
 * Scorecard, Squad, 1st / 2nd innings — toggled over the video.
 */

import { useState } from "react";

import type { CompactState, InningsSnapshot, MatchSnapshot, SquadMember } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export type LiveInfoPanelId = "scorecard" | "squad" | "innings1" | "innings2";

const TOGGLES: { id: LiveInfoPanelId; label: string }[] = [
  { id: "scorecard", label: "Scorecard" },
  { id: "squad", label: "Squad" },
  { id: "innings1", label: "1st" },
  { id: "innings2", label: "2nd" },
];

function batterLine(b: InningsSnapshot["state"]["batting"][number]): string {
  const mark = b.is_striker ? "*" : b.is_non_striker ? "†" : "";
  if (!b.has_batted && !b.is_out) return `${b.name}${mark} —`;
  const how = b.is_out ? (b.dismissal_text ?? "out") : "not out";
  return `${b.name}${mark} ${b.runs}(${b.balls_faced}) · ${how}`;
}

function bowlerLine(b: InningsSnapshot["state"]["bowling"][number]): string {
  const cur = b.is_current_bowler ? " ▶" : "";
  return `${b.name}${cur} ${b.overs_text}-${b.maidens}-${b.runs_conceded}-${b.wickets}`;
}

function CompactInnings({ innings }: { innings: InningsSnapshot }) {
  const batters = innings.state.batting.filter((b) => b.has_batted || b.is_out || b.is_striker || b.is_non_striker);
  const bowlers = innings.state.bowling.filter((b) => b.balls_bowled > 0 || b.is_current_bowler);
  return (
    <div className="space-y-2">
      <p className="font-sans text-[10px] font-semibold tracking-wide text-chalk uppercase">
        {innings.batting_team_name}{" "}
        <span className="text-willow">
          {innings.state.total_runs}/{innings.state.wickets} ({innings.state.overs_text})
        </span>
      </p>
      <ul className="space-y-0.5 font-sans text-[10px] text-chalk/90">
        {batters.slice(0, 11).map((b) => (
          <li key={b.player_id}>{batterLine(b)}</li>
        ))}
      </ul>
      {bowlers.length > 0 && (
        <>
          <p className="pt-1 font-sans text-[10px] font-semibold tracking-wide text-willow uppercase">
            Bowling
          </p>
          <ul className="space-y-0.5 font-sans text-[10px] text-chalk/90">
            {bowlers.map((b) => (
              <li key={b.player_id}>{bowlerLine(b)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CompactScorecard({ state, snapshot }: { state: CompactState | null; snapshot: MatchSnapshot | null }) {
  if (snapshot) {
    const current =
      snapshot.innings.find((i) => i.id === snapshot.current_innings_id) ?? snapshot.innings.at(-1);
    if (current) return <CompactInnings innings={current} />;
  }
  if (!state?.score) {
    return <p className="font-sans text-[10px] text-willow">Waiting for score…</p>;
  }
  const s = state.score;
  return (
    <div className="space-y-1.5 font-sans text-[10px] text-chalk/90">
      <p className="text-[11px] font-semibold text-chalk">
        {state.batting_team?.short_name ?? state.batting_team?.name ?? "Bat"}{" "}
        {s.runs}/{s.wickets} ({s.overs_text})
      </p>
      {state.striker && (
        <p>
          * {state.striker.name} {state.striker.runs}({state.striker.balls_faced})
        </p>
      )}
      {state.non_striker && (
        <p>
          † {state.non_striker.name} {state.non_striker.runs}({state.non_striker.balls_faced})
        </p>
      )}
      {state.bowler && (
        <p>
          {state.bowler.name} {state.bowler.overs_text}-{state.bowler.runs_conceded}-{state.bowler.wickets}
        </p>
      )}
      {s.target_runs != null && (
        <p className="text-willow">
          Need {s.runs_needed ?? "—"} of {s.target_runs}
          {s.balls_remaining != null ? ` · ${s.balls_remaining} balls` : ""}
        </p>
      )}
    </div>
  );
}

function SquadPanel({ snapshot }: { snapshot: MatchSnapshot | null }) {
  const squads = snapshot?.squads;
  const teams = snapshot?.match?.teams
    ? [snapshot.match.teams.a, snapshot.match.teams.b]
    : [];

  if (!squads || teams.length === 0) {
    return <p className="font-sans text-[10px] text-willow">Squad not loaded yet.</p>;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {teams.map((team) => {
        const members: SquadMember[] = (squads[team.id] ?? []).filter((m) => m.is_playing);
        return (
          <div key={team.id}>
            <p className="mb-1 font-sans text-[10px] font-semibold tracking-wide text-chalk uppercase">
              {team.name}
            </p>
            <ol className="list-decimal space-y-0.5 pl-3 font-sans text-[10px] text-chalk/90">
              {members.map((m) => (
                <li key={m.id}>
                  {m.name}
                  {m.is_captain ? " (c)" : ""}
                  {m.is_wicket_keeper ? " (wk)" : ""}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

export function LiveInfoPanelToggles({
  active,
  onToggle,
  className,
}: {
  active: Set<LiveInfoPanelId>;
  onToggle: (id: LiveInfoPanelId) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {TOGGLES.map((t) => {
        const on = active.has(t.id);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onToggle(t.id)}
            className={
              on
                ? "rounded-[3px] border border-boundary bg-boundary/30 px-2 py-1 font-sans text-[10px] font-semibold text-chalk"
                : "rounded-[3px] border border-willow/30 px-2 py-1 font-sans text-[10px] text-willow"
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function LiveInfoOverlays({
  active,
  state,
  snapshot,
  className,
}: {
  active: Set<LiveInfoPanelId>;
  state: CompactState | null;
  snapshot: MatchSnapshot | null;
  className?: string;
}) {
  const innings1 = snapshot?.innings.find((i) => i.sequence === 1) ?? snapshot?.innings[0];
  const innings2 = snapshot?.innings.find((i) => i.sequence === 2) ?? snapshot?.innings[1];

  if (active.size === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 top-10 z-10 flex max-h-[55%] flex-col gap-2 overflow-y-auto",
        className,
      )}
    >
      {active.has("scorecard") && (
        <div className="rounded-[3px] border border-willow/25 bg-ink/85 px-2.5 py-2 backdrop-blur-sm">
          <p className="mb-1 font-sans text-[9px] tracking-wide text-willow uppercase">Scorecard</p>
          <CompactScorecard state={state} snapshot={snapshot} />
        </div>
      )}
      {active.has("squad") && (
        <div className="rounded-[3px] border border-willow/25 bg-ink/85 px-2.5 py-2 backdrop-blur-sm">
          <p className="mb-1 font-sans text-[9px] tracking-wide text-willow uppercase">Squad</p>
          <SquadPanel snapshot={snapshot} />
        </div>
      )}
      {active.has("innings1") && (
        <div className="rounded-[3px] border border-willow/25 bg-ink/85 px-2.5 py-2 backdrop-blur-sm">
          <p className="mb-1 font-sans text-[9px] tracking-wide text-willow uppercase">1st innings</p>
          {innings1 ? (
            <CompactInnings innings={innings1} />
          ) : (
            <p className="font-sans text-[10px] text-willow">Not started.</p>
          )}
        </div>
      )}
      {active.has("innings2") && (
        <div className="rounded-[3px] border border-willow/25 bg-ink/85 px-2.5 py-2 backdrop-blur-sm">
          <p className="mb-1 font-sans text-[9px] tracking-wide text-willow uppercase">2nd innings</p>
          {innings2 ? (
            <CompactInnings innings={innings2} />
          ) : (
            <p className="font-sans text-[10px] text-willow">Not started.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Hook-friendly toggle set for camera / studio pages. */
export function useLiveInfoPanels(initial?: LiveInfoPanelId[]) {
  const [active, setActive] = useState<Set<LiveInfoPanelId>>(
    () => new Set(initial ?? []),
  );

  const onToggle = (id: LiveInfoPanelId) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return { active, onToggle };
}
