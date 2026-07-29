import { useMutation, useQuery } from "@tanstack/react-query";
import { Coins, Trash2, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/Button";
import { CheckField, SelectField, TextField } from "@/components/ui/Field";
import { Panel, Seam, SectionTitle } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
import { matches, teams as teamsApi, tools, tournaments } from "@/lib/api/endpoints";
import type {
  MatchCreateInput,
  MatchFormat,
  SquadPlayerInput,
  TossDecision,
} from "@/lib/api/types";
import { MATCH_FORMAT_LABELS, MATCH_FORMATS } from "@/lib/api/types";
import { toastError } from "@/store/toast";

/** Sensible overs for each format, so the common case needs no typing. */
const DEFAULT_OVERS: Record<MatchFormat, number | null> = {
  t20: 20,
  t10: 10,
  odi: 50,
  test: null,
  box: 6,
  turf: 8,
  gully: 8,
  tape_ball: 12,
  tennis_ball: 12,
  custom: 20,
};

interface SideDraft {
  teamId: string;
  name: string;
  shortName: string;
  /** One name per line: how a scorer actually enters a walk-up side. */
  roster: string;
}

const EMPTY_SIDE: SideDraft = { teamId: "", name: "", shortName: "", roster: "" };

function parseRoster(roster: string): SquadPlayerInput[] {
  return roster
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((name, index) => ({ name, batting_order: index + 1 }));
}

export default function NewMatch() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tournamentId = params.get("tournament");

  const { data: savedTeams } = useQuery({ queryKey: ["teams"], queryFn: teamsApi.list });
  const { data: tournamentList } = useQuery({
    queryKey: ["tournaments"],
    queryFn: tournaments.list,
  });

  const [format, setFormat] = useState<MatchFormat>("t20");
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [oversLimit, setOversLimit] = useState<string>("20");
  const [playersPerSide, setPlayersPerSide] = useState("11");
  const [ballsPerOver, setBallsPerOver] = useState("6");
  const [maxOversPerBowler, setMaxOversPerBowler] = useState("");
  const [allowBoundaries, setAllowBoundaries] = useState(true);
  const [freeHit, setFreeHit] = useState(true);
  const [lastBatterAlone, setLastBatterAlone] = useState(false);
  const [dls, setDls] = useState(false);

  const [sideA, setSideA] = useState<SideDraft>(EMPTY_SIDE);
  const [sideB, setSideB] = useState<SideDraft>(EMPTY_SIDE);

  const [tossWinner, setTossWinner] = useState<"" | "a" | "b">("");
  const [tossDecision, setTossDecision] = useState<TossDecision>("bat");
  const [coinResult, setCoinResult] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const changeFormat = (next: MatchFormat) => {
    setFormat(next);
    const overs = DEFAULT_OVERS[next];
    setOversLimit(overs === null ? "" : String(overs));
    // Box cricket is the format that usually bans boundaries outright.
    setAllowBoundaries(next !== "box");
  };

  const flip = useMutation({
    mutationFn: () => tools.coinFlip({}),
    onSuccess: (result) => setCoinResult(result.result),
    onError: (error) => toastError(error, "Could not flip the coin."),
  });

  const create = useMutation({
    mutationFn: async (input: MatchCreateInput) => {
      const snapshot = await matches.create(input);
      // The toss can only be recorded once the sides have ids, which is why it
      // is a second call rather than part of the create body.
      if (tossWinner) {
        const winnerId = snapshot.match.teams[tossWinner].id;
        return await matches.update(snapshot.match.id, {
          toss: { winner_team_id: winnerId, decision: tossDecision },
        });
      }
      return snapshot;
    },
    onSuccess: (snapshot) => void navigate(`/app/matches/${snapshot.match.id}`),
    onError: (error) => {
      if (error instanceof ApiError) setErrors(error.fieldErrors);
      toastError(error, "Could not create the match.");
    },
  });

  const sideName = (side: SideDraft, fallback: string) => {
    if (side.teamId) {
      return savedTeams?.find((team) => team.id === side.teamId)?.name ?? fallback;
    }
    return side.name.trim() || fallback;
  };

  const teamAName = sideName(sideA, "Team A");
  const teamBName = sideName(sideB, "Team B");

  const validate = (): string | null => {
    if (!sideA.teamId && !sideA.name.trim()) return "Give the first side a name.";
    if (!sideB.teamId && !sideB.name.trim()) return "Give the second side a name.";
    if (sideA.teamId && sideA.teamId === sideB.teamId)
      return "A match needs two different sides.";
    if (format !== "test" && !oversLimit)
      return "Set an overs limit, or choose the Test format.";
    return null;
  };

  const buildSide = (side: SideDraft) => {
    if (side.teamId) {
      const team = savedTeams?.find((candidate) => candidate.id === side.teamId);
      return {
        team_id: side.teamId,
        players: (team?.players ?? []).slice(0, 20).map((player, index) => ({
          player_id: player.id,
          batting_order: index + 1,
        })),
      };
    }
    return {
      name: side.name.trim(),
      short_name: side.shortName.trim() || undefined,
      players: parseRoster(side.roster),
    };
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setErrors({ form: problem });
      return;
    }
    setErrors({});

    const input: MatchCreateInput = {
      title: title.trim() || `${teamAName} vs ${teamBName}`,
      venue: venue.trim() || null,
      match_format: format,
      rules: {
        overs_limit: oversLimit ? Number(oversLimit) : null,
        balls_per_over: Number(ballsPerOver) || 6,
        players_per_side: Number(playersPerSide) || 11,
        max_overs_per_bowler: maxOversPerBowler ? Number(maxOversPerBowler) : null,
        free_hit_after_no_ball: freeHit,
        allow_boundaries: allowBoundaries,
        last_batter_can_bat_alone: lastBatterAlone,
        dls_enabled: dls,
      },
      team_a: buildSide(sideA),
      team_b: buildSide(sideB),
      tournament_id: tournamentId,
    };

    create.mutate(input);
  };

  const tournamentName = useMemo(
    () => tournamentList?.find((t) => t.id === tournamentId)?.name,
    [tournamentList, tournamentId],
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <div>
        <h1 className="text-2xl">New match</h1>
        <p className="mt-1 text-sm text-willow-soft">
          {tournamentName
            ? `This fixture will be part of ${tournamentName}.`
            : "Only the two side names are required. You can add players as they arrive, and set the toss later."}
        </p>
      </div>

      <Panel className="p-5">
        <SectionTitle>Match</SectionTitle>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            label="Title"
            placeholder={`${teamAName} vs ${teamBName}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            hint="Optional. Left blank, the two side names are used."
          />
          <TextField
            label="Ground"
            placeholder="Dhanmondi Club Ground"
            value={venue}
            onChange={(event) => setVenue(event.target.value)}
          />
          <SelectField
            label="Format"
            value={format}
            onChange={(event) => changeFormat(event.target.value as MatchFormat)}
          >
            {MATCH_FORMATS.map((option) => (
              <option key={option} value={option}>
                {MATCH_FORMAT_LABELS[option]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Overs per innings"
            type="number"
            min={1}
            max={200}
            value={oversLimit}
            onChange={(event) => setOversLimit(event.target.value)}
            hint={format === "test" ? "Leave blank for an unlimited innings." : undefined}
          />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { side: sideA, setSide: setSideA, label: "First side", fallback: "Team A" },
          { side: sideB, setSide: setSideB, label: "Second side", fallback: "Team B" },
        ].map(({ side, setSide, label, fallback }) => (
          <Panel key={label} className="p-5">
            <SectionTitle>{label}</SectionTitle>

            {savedTeams && savedTeams.length > 0 && (
              <SelectField
                label="Use a saved team"
                className="mt-4"
                value={side.teamId}
                onChange={(event) => setSide({ ...side, teamId: event.target.value })}
              >
                <option value="">Type a new side instead</option>
                {savedTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} ({team.players.length} players)
                  </option>
                ))}
              </SelectField>
            )}

            {!side.teamId && (
              <div className="mt-4 flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                  <TextField
                    label="Side name"
                    required
                    placeholder={fallback}
                    value={side.name}
                    onChange={(event) => setSide({ ...side, name: event.target.value })}
                  />
                  <TextField
                    label="Short"
                    maxLength={6}
                    placeholder="KCC"
                    value={side.shortName}
                    onChange={(event) => setSide({ ...side, shortName: event.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor={`roster-${label}`}
                    className="font-sans text-xs font-semibold tracking-wide text-willow-soft"
                  >
                    Players, one per line
                  </label>
                  <textarea
                    id={`roster-${label}`}
                    rows={8}
                    value={side.roster}
                    onChange={(event) => setSide({ ...side, roster: event.target.value })}
                    placeholder={"Rakib\nImran\nSajid\n…"}
                    className="w-full rounded-[3px] border border-chalk-deep bg-chalk px-3 py-2 font-sans text-sm text-ink"
                  />
                  <p className="flex items-center gap-1.5 font-sans text-xs text-willow">
                    <UserPlus aria-hidden="true" className="size-3.5" />
                    {parseRoster(side.roster).length} in the batting order. You can change this
                    during the match.
                  </p>
                </div>
              </div>
            )}
          </Panel>
        ))}
      </div>

      <Panel className="p-5">
        <SectionTitle>Toss</SectionTitle>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Who won it"
            value={tossWinner}
            onChange={(event) => setTossWinner(event.target.value as "" | "a" | "b")}
            hint="Optional now — you can set it before the first ball."
          >
            <option value="">Not decided yet</option>
            <option value="a">{teamAName}</option>
            <option value="b">{teamBName}</option>
          </SelectField>
          <SelectField
            label="And chose to"
            value={tossDecision}
            disabled={!tossWinner}
            onChange={(event) => setTossDecision(event.target.value as TossDecision)}
          >
            <option value="bat">Bat</option>
            <option value="bowl">Bowl</option>
          </SelectField>
          <div className="flex flex-col justify-end gap-1.5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => flip.mutate()}
              loading={flip.isPending}
            >
              <Coins aria-hidden="true" className="size-4" />
              Flip a coin
            </Button>
            {coinResult && (
              <p className="font-sans text-xs text-flip">
                Server flip: <strong className="uppercase">{coinResult}</strong> — stamped with
                a receipt.
              </p>
            )}
          </div>
        </div>
        <p className="mt-3 font-sans text-xs text-willow">
          The toss is recorded on the match, so the batting order of the innings follows from
          it.
        </p>
      </Panel>

      <details className="rounded-[3px] border border-pitch-line bg-pitch-deep">
        <summary className="tap flex cursor-pointer items-center px-5 font-sans text-sm text-chalk">
          Local rules — squad size, bowler quota, boundaries
        </summary>
        <Seam />
        <div className="grid gap-4 p-5 sm:grid-cols-3">
          <TextField
            label="Players per side"
            type="number"
            min={2}
            max={15}
            value={playersPerSide}
            onChange={(event) => setPlayersPerSide(event.target.value)}
          />
          <TextField
            label="Balls per over"
            type="number"
            min={1}
            max={12}
            value={ballsPerOver}
            onChange={(event) => setBallsPerOver(event.target.value)}
          />
          <TextField
            label="Max overs per bowler"
            type="number"
            min={1}
            value={maxOversPerBowler}
            onChange={(event) => setMaxOversPerBowler(event.target.value)}
            hint="Blank for no quota."
          />
          <div className="sm:col-span-3">
            <CheckField
              label="Boundaries allowed"
              hint="Turn off for box cricket where the walls are in play."
              checked={allowBoundaries}
              onChange={(event) => setAllowBoundaries(event.target.checked)}
            />
            <CheckField
              label="Free hit after a no-ball"
              checked={freeHit}
              onChange={(event) => setFreeHit(event.target.checked)}
            />
            <CheckField
              label="Last batter may bat alone"
              hint="Some gully formats let the eleventh batter continue without a partner."
              checked={lastBatterAlone}
              onChange={(event) => setLastBatterAlone(event.target.checked)}
            />
            <CheckField
              label="Rain-affected target (DLS) may be set"
              checked={dls}
              onChange={(event) => setDls(event.target.checked)}
            />
          </div>
        </div>
      </details>

      {(errors.form || create.isError) && (
        <p role="alert" className="font-sans text-sm text-boundary-soft">
          {errors.form ?? "Could not create the match."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" loading={create.isPending}>
          Create match
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => void navigate("/app")}>
          <Trash2 aria-hidden="true" className="size-4" />
          Discard
        </Button>
      </div>
    </form>
  );
}
