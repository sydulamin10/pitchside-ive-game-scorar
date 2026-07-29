/**
 * Recording a wicket.
 *
 * The form only ever offers dismissals that are legal for the delivery being
 * described — a free hit or a no-ball leaves run-out style dismissals only, a
 * wide adds stumped and hit wicket — so an impossible entry is unreachable
 * rather than merely rejected. The engine still checks, of course.
 */

import { useMemo, useState } from "react";

import {
  WICKETS_NEEDING_FIELDER,
  WICKET_TYPE_LABELS,
  type ExtraType,
  type InningsSnapshot,
  type WicketType,
} from "@/lib/api/types";
import { Button } from "@/components/ui/Button";
import { CheckField, SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";

import type { BallDraft } from "./ScorePad";

export interface WicketDraft extends BallDraft {
  is_wicket: true;
  wicket_type: WicketType;
  dismissed_player_id: string;
  fielder_id: string | null;
  replacement_batter_id: string | null;
}

const OFF_A_LEGAL_BALL: WicketType[] = [
  "bowled",
  "caught",
  "caught_and_bowled",
  "lbw",
  "stumped",
  "hit_wicket",
  "run_out",
  "obstructing_the_field",
  "hit_ball_twice",
  "timed_out",
  "retired_out",
];
const OFF_A_NO_BALL: WicketType[] = [
  "run_out",
  "obstructing_the_field",
  "hit_ball_twice",
  "retired_out",
];
const OFF_A_WIDE: WicketType[] = [
  "run_out",
  "stumped",
  "hit_wicket",
  "obstructing_the_field",
  "retired_out",
];

/** Dismissals where the batters' ends are genuinely ambiguous. */
const NEEDS_CROSSED: WicketType[] = ["caught", "run_out", "obstructing_the_field"];

interface SheetProps {
  onClose: () => void;
  innings: InningsSnapshot;
  fielders: Array<{ id: string; name: string }>;
  onConfirm: (draft: WicketDraft) => void;
  /** `retire` keeps the batter's runs and does not count as a wicket. */
  mode?: "wicket" | "retire";
}

/**
 * Closing the sheet unmounts the form, which is how it starts empty next time:
 * a half-filled dismissal from the previous over must never be inherited.
 */
export function WicketSheet({ open, ...rest }: SheetProps & { open: boolean }) {
  if (!open) return null;
  return <Sheet {...rest} />;
}

function Sheet({ onClose, innings, fielders, onConfirm, mode = "wicket" }: SheetProps) {
  const state = innings.state;
  const striker = state.batting.find((b) => b.is_striker) ?? null;
  const nonStriker = state.batting.find((b) => b.is_non_striker) ?? null;

  const [extra, setExtra] = useState<ExtraType | null>(null);
  const [chosenType, setWicketType] = useState<WicketType>(
    mode === "retire" ? "retired_hurt" : "bowled",
  );
  const [dismissed, setDismissed] = useState<string>(
    striker?.player_id ?? nonStriker?.player_id ?? "",
  );
  const [fielder, setFielder] = useState<string>("");
  const [replacement, setReplacement] = useState<string>("");
  const [runs, setRuns] = useState(0);
  const [crossed, setCrossed] = useState(false);

  const available = useMemo(
    () =>
      state.available_batter_ids
        .map((id) => state.batting.find((b) => b.player_id === id))
        .filter((b): b is NonNullable<typeof b> => Boolean(b)),
    [state.available_batter_ids, state.batting],
  );

  const allowed = useMemo(() => {
    if (mode === "retire") return ["retired_hurt", "retired_out"] as WicketType[];
    if (extra === "no_ball" || state.is_free_hit) return OFF_A_NO_BALL;
    if (extra === "wide") return OFF_A_WIDE;
    return OFF_A_LEGAL_BALL;
  }, [mode, extra, state.is_free_hit]);

  // Changing the delivery can outlaw the dismissal already picked, so the choice
  // is read through the allowed list rather than corrected after the fact.
  const wicketType = allowed.includes(chosenType) ? chosenType : (allowed[0] ?? "run_out");

  const needsFielder = WICKETS_NEEDING_FIELDER.includes(wicketType);
  const isRetirement = wicketType === "retired_hurt";
  const canConfirm = Boolean(dismissed) && (!needsFielder || Boolean(fielder));

  const confirm = () => {
    if (!canConfirm) return;
    const draft: WicketDraft = {
      batter_runs: extra === "wide" || extra === "bye" || extra === "leg_bye" ? 0 : runs,
      extra_type: extra,
      extra_runs: extra === "wide" || extra === "bye" || extra === "leg_bye" ? runs : 0,
      is_boundary: false,
      // Ends are ambiguous for a catch or a run out, so the scorer says.
      batters_crossed: NEEDS_CROSSED.includes(wicketType) ? crossed : null,
      commentary: null,
      is_wicket: true,
      wicket_type: wicketType,
      dismissed_player_id: dismissed,
      fielder_id: needsFielder || fielder ? fielder || null : null,
      replacement_batter_id: replacement || null,
    };
    onConfirm(draft);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "retire" ? "Retire a batter" : "How was the batter out?"}
      description={
        state.is_free_hit && mode === "wicket"
          ? "It is a free hit, so only a run-out style dismissal is possible."
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={!canConfirm}>
            {isRetirement ? "Retire" : "Record the wicket"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SelectField
          label="Dismissal"
          value={wicketType}
          data-autofocus
          onChange={(event) => setWicketType(event.target.value as WicketType)}
        >
          {allowed.map((type) => (
            <option key={type} value={type}>
              {WICKET_TYPE_LABELS[type]}
            </option>
          ))}
        </SelectField>

        <SelectField
          label="Who is out"
          value={dismissed}
          onChange={(event) => setDismissed(event.target.value)}
        >
          {[striker, nonStriker].map((batter) =>
            batter ? (
              <option key={batter.player_id} value={batter.player_id}>
                {batter.name} {batter.is_striker ? "(on strike)" : "(non-striker)"} ·{" "}
                {batter.runs} ({batter.balls_faced})
              </option>
            ) : null,
          )}
        </SelectField>

        {(needsFielder || wicketType === "run_out") && (
          <SelectField
            label={wicketType === "stumped" ? "Wicket-keeper" : "Fielder"}
            hint={needsFielder ? undefined : "Optional — it appears in the scorebook line."}
            value={fielder}
            required={needsFielder}
            onChange={(event) => setFielder(event.target.value)}
          >
            <option value="">Select…</option>
            {fielders.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </SelectField>
        )}

        {mode === "wicket" && (
          <SelectField
            label="Delivery"
            hint="A run out can happen off any delivery."
            value={extra ?? ""}
            onChange={(event) => setExtra((event.target.value || null) as ExtraType | null)}
          >
            <option value="">Fair delivery</option>
            <option value="no_ball">No ball</option>
            <option value="wide">Wide</option>
            <option value="bye">Bye</option>
            <option value="leg_bye">Leg bye</option>
          </SelectField>
        )}

        <TextField
          label="Runs completed before the wicket"
          type="number"
          min={0}
          max={6}
          value={runs}
          onChange={(event) => setRuns(Math.max(0, Number(event.target.value) || 0))}
        />

        {NEEDS_CROSSED.includes(wicketType) && (
          <CheckField
            label="The batters crossed"
            hint="Tick this if they had changed ends when the wicket fell — it decides who is on strike."
            checked={crossed}
            onChange={(event) => setCrossed(event.target.checked)}
          />
        )}

        {!isRetirement && (
          <SelectField
            label="Next batter"
            hint={
              available.length > 0
                ? "You can also leave this and pick from the crease panel."
                : "No batters left — this ends the innings."
            }
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
          >
            <option value="">Decide after the ball</option>
            {available.map((batter) => (
              <option key={batter.player_id} value={batter.player_id}>
                {batter.name}
              </option>
            ))}
          </SelectField>
        )}
      </div>
    </Modal>
  );
}
