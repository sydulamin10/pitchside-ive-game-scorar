/**
 * Correcting a ball that was already recorded.
 *
 * This is the feature that makes the product trustworthy: the delivery log is the
 * only stored truth, so changing one entry and replaying fixes the over, both
 * batters' cards, the bowler's figures, the fall of wickets and the result — no
 * aggregate is edited by hand anywhere.
 */

import { useState } from "react";

import type {
  DeliveryLogEntry,
  DeliveryUpdateInput,
  ExtraType,
  WicketType,
} from "@/lib/api/types";
import { WICKET_TYPE_LABELS } from "@/lib/api/types";
import { Button } from "@/components/ui/Button";
import { CheckField, SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";

interface EditorProps {
  onClose: () => void;
  onSave: (patch: DeliveryUpdateInput) => Promise<void>;
  onDelete: (reason: string) => Promise<void>;
  names: Record<string, string>;
}

/**
 * The form is keyed on the ball being corrected, so opening a different ball
 * mounts a fresh form rather than copying values into existing state.
 */
export function BallEditor({
  entry,
  ...rest
}: EditorProps & { entry: DeliveryLogEntry | null }) {
  if (!entry) return null;
  return <Editor key={`${entry.id}:${entry.revision}`} entry={entry} {...rest} />;
}

function Editor({
  entry,
  onClose,
  onSave,
  onDelete,
  names,
}: EditorProps & { entry: DeliveryLogEntry }) {
  const [runs, setRuns] = useState(entry.batter_runs);
  const [extra, setExtra] = useState<ExtraType | "">(entry.extra_type ?? "");
  const [extraRuns, setExtraRuns] = useState(entry.extra_runs);
  const [boundary, setBoundary] = useState(entry.is_boundary);
  const [isWicket, setIsWicket] = useState(entry.is_wicket);
  const [wicketType, setWicketType] = useState<WicketType | "">(entry.wicket_type ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const patch: DeliveryUpdateInput = {
        batter_runs: runs,
        extra_runs: extraRuns,
        is_boundary: boundary,
        is_wicket: isWicket,
        reason: reason || null,
      };
      if (extra === "") patch.clear_extra = true;
      else patch.extra_type = extra;
      if (isWicket) patch.wicket_type = wicketType || "bowled";
      else patch.wicket_type = null;
      await onSave(patch);
      onClose();
    } catch {
      // The toast from the mutation already explains what the server refused.
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await onDelete(reason || "Removed by the scorer");
      onClose();
    } catch {
      /* handled by the caller's toast */
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Correct ball ${entry.sequence}`}
      description={`${names[entry.bowler_id] ?? "Bowler"} to ${names[entry.striker_id] ?? "the striker"} · revision ${entry.revision}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void remove()} loading={saving}>
            Delete the ball
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            Save the correction
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Runs off the bat"
            type="number"
            min={0}
            max={12}
            value={runs}
            data-autofocus
            onChange={(event) => setRuns(Math.max(0, Number(event.target.value) || 0))}
          />
          <TextField
            label="Extra runs"
            type="number"
            min={0}
            max={12}
            value={extraRuns}
            onChange={(event) => setExtraRuns(Math.max(0, Number(event.target.value) || 0))}
          />
        </div>

        <SelectField
          label="Delivery"
          value={extra}
          onChange={(event) => setExtra(event.target.value as ExtraType | "")}
        >
          <option value="">Fair delivery</option>
          <option value="wide">Wide</option>
          <option value="no_ball">No ball</option>
          <option value="bye">Bye</option>
          <option value="leg_bye">Leg bye</option>
          <option value="penalty">Penalty runs</option>
        </SelectField>

        <CheckField
          label="It reached the rope"
          checked={boundary}
          onChange={(event) => setBoundary(event.target.checked)}
        />

        <CheckField
          label="A wicket fell on this ball"
          checked={isWicket}
          onChange={(event) => setIsWicket(event.target.checked)}
        />

        {isWicket && (
          <SelectField
            label="Dismissal"
            value={wicketType}
            onChange={(event) => setWicketType(event.target.value as WicketType)}
          >
            {Object.entries(WICKET_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
        )}

        <TextField
          label="Why (kept in the correction log)"
          placeholder="e.g. it was a leg bye, not a bye"
          value={reason}
          maxLength={240}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </Modal>
  );
}
