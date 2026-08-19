/**
 * The scoring console: the screen a scorer holds for three hours.
 *
 * Layout rules that come from that fact: the pad never moves, the board is always
 * visible above it, and every state the match can be in (waiting for the toss,
 * between innings, finished) says what to do next in one sentence with one button.
 */

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { ScoreBoard } from "@/components/board/ScoreBoard";
import { BallEditor } from "@/components/console/BallEditor";
import { CreasePanel, type CreaseSelection } from "@/components/console/CreasePanel";
import { PendingQueue } from "@/components/console/PendingQueue";
import { ScorePad, type BallDraft } from "@/components/console/ScorePad";
import { WicketSheet, type WicketDraft } from "@/components/console/WicketSheet";
import { InningsScorecard } from "@/components/ledger/Scorecard";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import {
  Badge,
  EmptyState,
  LiveDot,
  Panel,
  Paper,
  Seam,
  SectionTitle,
  Spinner,
} from "@/components/ui/Surface";
import { compactFromSnapshot } from "@/lib/console/compact";
import { useConsole, type NewBall } from "@/lib/console/useConsole";
import { copyToClipboard, relativeTime } from "@/lib/utils";
import { toast } from "@/store/toast";

type Tab = "pad" | "card" | "log";

export default function ScoringConsole() {
  const { matchId } = useParams<{ matchId: string }>();
  const ctl = useConsole(matchId);
  const { snapshot, innings } = ctl;

  const [tab, setTab] = useState<Tab>("pad");
  const [selection, setSelection] = useState<CreaseSelection>({
    strikerId: null,
    nonStrikerId: null,
    bowlerId: null,
  });
  const [wicketMode, setWicketMode] = useState<"wicket" | "retire" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const squads = useMemo(() => snapshot?.squads ?? {}, [snapshot?.squads]);
  const bowlingSquad = innings ? (squads[innings.bowling_team_id] ?? []) : [];
  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const members of Object.values(squads)) {
      for (const member of members) map[member.id] = member.name;
    }
    return map;
  }, [squads]);

  const state = innings?.state ?? null;
  const strikerId = state?.striker_id ?? selection.strikerId;
  const nonStrikerId = state?.non_striker_id ?? selection.nonStrikerId;
  // Prefer an explicit mid-over bowler pick so offline scoring can change bowler
  // before the next ball without waiting for the crease API.
  const bowlerId =
    selection.bowlerId &&
    state?.current_bowler_id &&
    selection.bowlerId !== state.current_bowler_id
      ? selection.bowlerId
      : (state?.current_bowler_id ?? selection.bowlerId);
  const ready = Boolean(strikerId && nonStrikerId && bowlerId);

  const scorable =
    snapshot?.match.status === "live" ||
    snapshot?.match.status === "innings_break" ||
    snapshot?.match.status === "setup";

  const compose = (draft: BallDraft | WicketDraft): NewBall | null => {
    if (!strikerId || !nonStrikerId || !bowlerId) {
      toast("Choose the batters and the bowler first.", "warning");
      return null;
    }
    const wicket = "is_wicket" in draft ? draft : null;
    return {
      striker_id: strikerId,
      non_striker_id: nonStrikerId,
      bowler_id: bowlerId,
      batter_runs: draft.batter_runs,
      extra_type: draft.extra_type,
      extra_runs: draft.extra_runs,
      is_boundary: draft.is_boundary,
      batters_crossed: draft.batters_crossed,
      commentary: draft.commentary,
      is_wicket: Boolean(wicket),
      wicket_type: wicket?.wicket_type ?? null,
      dismissed_player_id: wicket?.dismissed_player_id ?? null,
      fielder_id: wicket?.fielder_id ?? null,
      replacement_batter_id: wicket?.replacement_batter_id ?? null,
    };
  };

  const record = async (draft: BallDraft | WicketDraft) => {
    const ball = compose(draft);
    if (!ball) return;
    await ctl.record(ball);
    // The engine decides the ends from here on, so drop the local picks.
    setSelection({ strikerId: null, nonStrikerId: null, bowlerId: null });
  };

  if (ctl.status === "loading") return <Spinner label="Opening the match" />;

  if (ctl.status === "error" || !snapshot) {
    return (
      <EmptyState
        title="This match could not be opened"
        description={
          ctl.error?.message ?? "Check the link, or open it again once you have a connection."
        }
        action={
          <Link to="/app">
            <Button variant="ghost">Back to my matches</Button>
          </Link>
        }
      />
    );
  }

  const match = snapshot.match;
  const editingEntry = ctl.log.find((entry) => entry.id === editingId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-sans text-lg font-semibold text-chalk">{match.title}</h1>
          <p className="flex flex-wrap items-center gap-2 pt-1 font-sans text-xs text-willow">
            {match.venue && <span>{match.venue}</span>}
            <span className="flex items-center gap-1.5">
              {ctl.streamStatus === "live" && <LiveDot />}
              {ctl.online
                ? ctl.streamStatus === "live"
                  ? `live · updated ${relativeTime(ctl.updatedAt)}`
                  : ctl.streamStatus === "polling"
                    ? "checking for updates"
                    : "connecting"
                : "offline — scoring saved on this device"}
            </span>
            {ctl.fromCache && <Badge tone="quiet">From this device</Badge>}
            {ctl.isProjected && <Badge tone="live">Unsynced balls included</Badge>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void copyToClipboard(match.share_url).then((ok) =>
                toast(ok ? "Share link copied." : match.share_url, ok ? "success" : "info"),
              )
            }
          >
            Copy share link
          </Button>
          <a href={`/s/${match.slug}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost">
              Open scorecard
            </Button>
          </a>
          <Link to={`/app/matches/${match.id}/broadcast`}>
            <Button size="sm" variant="secondary">
              Go Live
            </Button>
          </Link>
        </div>
      </header>

      <ScoreBoard
        state={compactFromSnapshot(snapshot, innings)}
        title={innings ? `${innings.batting_team_name} batting` : match.title}
        live={ctl.streamStatus === "live" && match.status === "live"}
      />

      <Lifecycle
        snapshot={snapshot}
        onToss={ctl.setToss}
        onStartInnings={() => void ctl.startInnings()}
      />

      <PendingQueue
        pending={ctl.pending}
        rejected={ctl.rejected}
        online={ctl.online}
        onSync={() => void ctl.syncNow()}
      />

      {innings && (
        <>
          <nav className="flex gap-2" aria-label="Console views">
            {(
              [
                ["pad", "Score"],
                ["card", "Scorecard"],
                ["log", "Over by over"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={tab === value ? "secondary" : "ghost"}
                onClick={() => setTab(value)}
                aria-current={tab === value}
              >
                {label}
              </Button>
            ))}
          </nav>

          {tab === "pad" && (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <Panel className="order-2 lg:order-1">
                {state?.is_complete ? (
                  <EmptyState
                    title="This innings is done"
                    description={
                      state.end_reason === "target_reached"
                        ? "The target was reached."
                        : state.end_reason === "all_out"
                          ? "All out."
                          : "The overs are complete."
                    }
                    action={
                      <Button onClick={() => void ctl.startInnings()}>
                        Start the next innings
                      </Button>
                    }
                  />
                ) : (
                  <ScorePad
                    innings={innings}
                    disabled={!scorable || !ready || ctl.busy}
                    busy={ctl.busy}
                    onRecord={(draft) => void record(draft)}
                    onWicket={() => setWicketMode("wicket")}
                    onRetire={() => setWicketMode("retire")}
                    onUndo={() => void ctl.undo()}
                  />
                )}
              </Panel>

              <div className="order-1 flex flex-col gap-4 lg:order-2">
                <CreasePanel
                  innings={innings}
                  bowlingSquad={bowlingSquad}
                  selection={{ strikerId, nonStrikerId, bowlerId }}
                  onChange={(patch) => setSelection((current) => ({ ...current, ...patch }))}
                  onChangeBowler={(id) => void ctl.changeBowler(id)}
                  onSwapEnds={() => void ctl.swapEnds()}
                  busy={ctl.busy}
                />
                <Panel className="p-4">
                  <SectionTitle>Innings</SectionTitle>
                  <p className="pt-2 font-sans text-sm text-willow-soft">
                    {innings.batting_team_name} · innings {innings.sequence}
                    {innings.overs_limit ? ` · ${innings.overs_limit} overs` : " · unlimited"}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-3">
                    <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>
                      Close this innings
                    </Button>
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {tab === "card" && (
            <div className="flex flex-col gap-6">
              {snapshot.innings.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <SectionTitle>
                      {entry.batting_team_name} · {entry.state.total_runs}/{entry.state.wickets}{" "}
                      ({entry.state.overs_text})
                    </SectionTitle>
                    {entry.id === innings.id && <Badge tone="live">Current</Badge>}
                  </div>
                  <InningsScorecard innings={entry} />
                </div>
              ))}
            </div>
          )}

          {tab === "log" && (
            <div className="flex flex-col gap-3">
              <Paper className="px-3 py-2">
                <p className="font-sans text-xs text-[color-mix(in_srgb,var(--color-ink)_65%,transparent)]">
                  Tap any ball to correct it. Everything after it is recalculated from the log —
                  the batters' cards, the bowler's figures and the result.
                </p>
              </Paper>
              <InningsScorecard innings={innings} onSelectBall={setEditingId} />
            </div>
          )}
        </>
      )}

      {!innings && (
        <EmptyState
          title="No innings yet"
          description="Set the toss, then start the first innings to open the pad."
        />
      )}

      {innings && (
        <WicketSheet
          open={wicketMode !== null}
          mode={wicketMode ?? "wicket"}
          onClose={() => setWicketMode(null)}
          innings={innings}
          fielders={bowlingSquad
            .filter((member) => member.is_playing)
            .map((member) => ({ id: member.id, name: member.name }))}
          onConfirm={(draft) => void record(draft)}
        />
      )}

      <BallEditor
        entry={editingEntry}
        names={names}
        onClose={() => setEditingId(null)}
        onSave={(patch) => ctl.editBall(editingEntry!.id, patch)}
        onDelete={(reason) => ctl.deleteBall(editingEntry!.id, reason)}
      />

      <CloseInningsDialog
        open={closing}
        onClose={() => setClosing(false)}
        onConfirm={(reason) => void ctl.closeInnings(reason)}
      />
    </div>
  );
}

function Lifecycle({
  snapshot,
  onToss,
  onStartInnings,
}: {
  snapshot: NonNullable<ReturnType<typeof useConsole>["snapshot"]>;
  onToss: (winnerTeamId: string, decision: "bat" | "bowl") => Promise<void>;
  onStartInnings: () => void;
}) {
  const match = snapshot.match;
  const [winner, setWinner] = useState(match.toss.winner_team_id ?? "");
  const [decision, setDecision] = useState<"bat" | "bowl">(match.toss.decision ?? "bat");

  if (match.status === "completed") {
    return (
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="font-sans text-sm font-semibold text-flip">{snapshot.result.summary}</p>
        <a href={`/s/${match.slug}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="ghost">
            Share the result
          </Button>
        </a>
      </Panel>
    );
  }

  const needsToss = !match.toss.winner_team_id;
  const noInnings = snapshot.innings.length === 0;

  if (!needsToss && !noInnings && match.status !== "innings_break") return null;

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <SectionTitle>{needsToss ? "The toss" : "Next innings"}</SectionTitle>
      {needsToss ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <SelectField
            label="Who won the toss"
            value={winner}
            onChange={(event) => setWinner(event.target.value)}
          >
            <option value="">Select…</option>
            <option value={match.teams.a.id}>{match.teams.a.name}</option>
            <option value={match.teams.b.id}>{match.teams.b.name}</option>
          </SelectField>
          <SelectField
            label="And chose to"
            value={decision}
            onChange={(event) => setDecision(event.target.value as "bat" | "bowl")}
          >
            <option value="bat">Bat</option>
            <option value="bowl">Bowl</option>
          </SelectField>
          <Button disabled={!winner} onClick={() => void onToss(winner, decision)}>
            Save the toss
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-sans text-sm text-willow-soft">
            {noInnings
              ? "The toss is set. Start the first innings when the players are ready."
              : "Innings break. Start the next innings when the sides have changed over."}
          </p>
          <Button onClick={onStartInnings}>
            {noInnings ? "Start the first innings" : "Start the next innings"}
          </Button>
        </div>
      )}
    </Panel>
  );
}

const END_REASONS: Array<[string, string]> = [
  ["overs_complete", "The overs are complete"],
  ["all_out", "All out"],
  ["declared", "Declared"],
  ["rain", "Rain stopped play"],
  ["forfeit", "Forfeited"],
  ["other", "Other"],
];

function CloseInningsDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("overs_complete");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Close this innings"
      description="The scorecard stays exactly as it is; the next innings can then be started."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm(reason);
              onClose();
            }}
          >
            Close the innings
          </Button>
        </>
      }
    >
      <SelectField
        label="Why is it ending"
        value={reason}
        data-autofocus
        onChange={(event) => setReason(event.target.value)}
      >
        {END_REASONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <Seam className="mt-4" />
    </Modal>
  );
}
