/**
 * Who is at the crease and who is bowling.
 *
 * The engine says what it needs next — openers, a bowler, an incoming batter —
 * and this panel asks for exactly that and nothing else. Ends are never edited
 * here: which batter is on strike is a *consequence* of the log, so a mistaken
 * crossing is fixed by correcting the ball, not by swapping the names.
 */

import type { InningsSnapshot, SquadMember } from "@/lib/api/types";
import { SelectField } from "@/components/ui/Field";
import { Badge, Panel, SectionTitle } from "@/components/ui/Surface";

export interface CreaseSelection {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
}

export function CreasePanel({
  innings,
  bowlingSquad,
  selection,
  onChange,
}: {
  innings: InningsSnapshot;
  bowlingSquad: SquadMember[];
  selection: CreaseSelection;
  onChange: (patch: Partial<CreaseSelection>) => void;
}) {
  const state = innings.state;
  const action = state.next_action;

  const available = state.available_batter_ids
    .map((id) => state.batting.find((b) => b.player_id === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  const bowlers = bowlingSquad.filter((member) => member.is_playing);
  const strikerName = state.batting.find((b) => b.player_id === selection.strikerId)?.name;
  const nonStrikerName = state.batting.find(
    (b) => b.player_id === selection.nonStrikerId,
  )?.name;
  const bowlerName = bowlers.find((b) => b.id === selection.bowlerId)?.name;

  const emptyEnd = state.striker_id === null ? "strike" : "the other end";

  return (
    <Panel className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>At the crease</SectionTitle>
        {action === "select_openers" && <Badge tone="live">Open the innings</Badge>}
        {action === "select_batter" && <Badge tone="wicket">New batter needed</Badge>}
        {action === "select_bowler" && <Badge tone="live">New bowler</Badge>}
      </div>

      {action === "select_openers" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="On strike"
            value={selection.strikerId ?? ""}
            onChange={(event) => onChange({ strikerId: event.target.value || null })}
          >
            <option value="">Select…</option>
            {available
              .filter((b) => b.player_id !== selection.nonStrikerId)
              .map((b) => (
                <option key={b.player_id} value={b.player_id}>
                  {b.name}
                </option>
              ))}
          </SelectField>
          <SelectField
            label="Non-striker"
            value={selection.nonStrikerId ?? ""}
            onChange={(event) => onChange({ nonStrikerId: event.target.value || null })}
          >
            <option value="">Select…</option>
            {available
              .filter((b) => b.player_id !== selection.strikerId)
              .map((b) => (
                <option key={b.player_id} value={b.player_id}>
                  {b.name}
                </option>
              ))}
          </SelectField>
        </div>
      ) : action === "select_batter" ? (
        <SelectField
          label={`Next batter (comes in on ${emptyEnd})`}
          hint={
            state.fall_of_wickets.at(-1)
              ? `${state.fall_of_wickets.at(-1)!.batter_name} — ${state.fall_of_wickets.at(-1)!.dismissal_text}`
              : undefined
          }
          value={
            (state.striker_id === null ? selection.strikerId : selection.nonStrikerId) ?? ""
          }
          onChange={(event) =>
            onChange(
              state.striker_id === null
                ? { strikerId: event.target.value || null }
                : { nonStrikerId: event.target.value || null },
            )
          }
        >
          <option value="">Select…</option>
          {available.map((b) => (
            <option key={b.player_id} value={b.player_id}>
              {b.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <dl className="grid grid-cols-2 gap-3 font-sans text-sm">
          <div>
            <dt className="text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
              On strike
            </dt>
            <dd className="text-chalk">{strikerName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
              Non-striker
            </dt>
            <dd className="text-chalk">{nonStrikerName ?? "—"}</dd>
          </div>
        </dl>
      )}

      {state.current_bowler_id && action !== "select_bowler" ? (
        <p className="font-sans text-sm text-chalk">
          <span className="text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
            Bowling{" "}
          </span>
          {bowlerName ?? "—"}
          <span className="pl-2 text-xs text-willow">
            mid-over — the same bowler must finish it
          </span>
        </p>
      ) : (
        <SelectField
          label="Bowler for this over"
          hint={
            state.previous_over_bowler_id
              ? "The bowler of the previous over cannot bowl this one."
              : undefined
          }
          value={selection.bowlerId ?? ""}
          onChange={(event) => onChange({ bowlerId: event.target.value || null })}
        >
          <option value="">Select…</option>
          {bowlers.map((member) => {
            const blocked = state.ineligible_bowler_ids.includes(member.id);
            const figures = state.bowling.find((b) => b.player_id === member.id);
            return (
              <option key={member.id} value={member.id} disabled={blocked}>
                {member.name}
                {figures
                  ? ` — ${figures.overs_text} ov, ${figures.wickets}/${figures.runs_conceded}`
                  : ""}
                {blocked ? " (not eligible)" : ""}
              </option>
            );
          })}
        </SelectField>
      )}
    </Panel>
  );
}
