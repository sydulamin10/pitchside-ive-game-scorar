/**
 * Running one tournament: teams in, fixtures out, table and bracket kept current.
 *
 * Nothing on this page is a stored aggregate — the table is derived from finished
 * matches every time it is asked for, so correcting a ball in a fixture from last
 * week moves the points and the net run rate with it.
 */

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { StandingsTable } from "@/components/ledger/StandingsTable";
import { Button } from "@/components/ui/Button";
import { CheckField, SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge, EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { teams as teamsApi, tournaments as api } from "@/lib/api/endpoints";
import {
  copyToClipboard,
  formatDateTime,
  formNumber,
  formText,
  formTexts,
  toLocalInputValue,
} from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

export default function TournamentDetail() {
  const { tournamentId = "" } = useParams<{ tournamentId: string }>();
  const queryClient = useQueryClient();
  const [addingTeams, setAddingTeams] = useState(false);
  // `null` means the fixture dialog is closed; opening it stamps a default start
  // time, which has to be read from the clock in the handler rather than in render.
  const [fixtureStart, setFixtureStart] = useState<string | null>(null);
  const generating = fixtureStart !== null;

  const tournament = useQuery({
    queryKey: ["tournament", tournamentId],
    queryFn: () => api.get(tournamentId),
    enabled: Boolean(tournamentId),
  });
  const participants = useQuery({
    queryKey: ["tournament", tournamentId, "participants"],
    queryFn: () => api.participants(tournamentId),
    enabled: Boolean(tournamentId),
  });
  const standings = useQuery({
    queryKey: ["tournament", tournamentId, "standings"],
    queryFn: () => api.standings(tournamentId),
    enabled: Boolean(tournamentId),
  });
  const fixtures = useQuery({
    queryKey: ["tournament", tournamentId, "fixtures"],
    queryFn: () => api.fixtures(tournamentId),
    enabled: Boolean(tournamentId),
  });
  const bracket = useQuery({
    queryKey: ["tournament", tournamentId, "bracket"],
    queryFn: () => api.bracket(tournamentId),
    enabled: Boolean(tournamentId),
  });
  const myTeams = useQuery({ queryKey: ["teams"], queryFn: () => teamsApi.list() });

  const refreshAll = () => {
    for (const key of ["participants", "standings", "fixtures", "bracket"]) {
      void queryClient.invalidateQueries({ queryKey: ["tournament", tournamentId, key] });
    }
    void queryClient.invalidateQueries({ queryKey: ["tournament", tournamentId] });
  };

  const addParticipants = useMutation({
    mutationFn: (teamIds: string[]) =>
      api.addParticipants(
        tournamentId,
        teamIds.map((team_id) => ({ team_id })),
      ),
    onSuccess: () => {
      setAddingTeams(false);
      refreshAll();
      toast("Teams added.", "success");
    },
    onError: (error) => toastError(error, "Those teams could not be added."),
  });

  const generateFixtures = useMutation({
    mutationFn: (input: Parameters<typeof api.generateRoundRobin>[1]) =>
      api.generateRoundRobin(tournamentId, input),
    onSuccess: (created) => {
      setFixtureStart(null);
      refreshAll();
      toast(`${created.length} fixtures created.`, "success");
    },
    onError: (error) => toastError(error, "The fixtures could not be generated."),
  });

  const generateBracket = useMutation({
    mutationFn: () => api.generateBracket(tournamentId, { seed_from_standings: true }),
    onSuccess: () => {
      refreshAll();
      toast("Bracket generated from the table.", "success");
    },
    onError: (error) => toastError(error, "The bracket could not be generated."),
  });

  const enteredIds = useMemo(
    () => new Set((participants.data ?? []).map((p) => p.team_id)),
    [participants.data],
  );
  const addable = (myTeams.data ?? []).filter((team) => !enteredIds.has(team.id));

  if (tournament.isLoading) return <Spinner label="Loading the tournament" />;
  if (!tournament.data) {
    return (
      <EmptyState
        title="Tournament not found"
        description="It may have been removed."
        action={
          <Link to="/app/tournaments">
            <Button variant="ghost">Back to tournaments</Button>
          </Link>
        }
      />
    );
  }

  const detail = tournament.data;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-sans text-lg font-semibold text-chalk">{detail.name}</h1>
          <p className="pt-1 font-sans text-xs text-willow">
            {detail.tournament_format.replace("_", " ")} · {detail.team_count} teams ·{" "}
            {detail.match_count} matches
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.share_url && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void copyToClipboard(detail.share_url!).then((ok) =>
                  toast(
                    ok ? "Public link copied." : detail.share_url!,
                    ok ? "success" : "info",
                  ),
                )
              }
            >
              Copy public link
            </Button>
          )}
          <a href={`/t/${detail.public_slug}`} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost">
              Open public page
            </Button>
          </a>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Teams</SectionTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => setAddingTeams(true)}
              disabled={addable.length === 0}
            >
              Add teams
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setFixtureStart(toLocalInputValue(new Date(Date.now() + 24 * 3600_000)))
              }
              disabled={(participants.data?.length ?? 0) < 2}
            >
              Generate fixtures
            </Button>
            {detail.tournament_format !== "league" && (
              <Button
                size="sm"
                variant="ghost"
                loading={generateBracket.isPending}
                onClick={() => generateBracket.mutate()}
              >
                Generate bracket
              </Button>
            )}
          </div>
        </div>

        {participants.data?.length ? (
          <Panel className="flex flex-col">
            {participants.data.map((participant, index) => (
              <div key={participant.id}>
                {index > 0 && <Seam />}
                <div className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <span className="font-sans text-sm text-chalk">
                    <span className="mr-2 font-mono text-xs text-willow">{index + 1}</span>
                    {participant.team_name}
                    {participant.group_name && (
                      <span className="pl-2 text-xs text-willow">{participant.group_name}</span>
                    )}
                    {participant.points_adjustment !== 0 && (
                      <Badge tone="wicket" className="ml-2">
                        {participant.points_adjustment > 0 ? "+" : ""}
                        {participant.points_adjustment} pts
                      </Badge>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void api
                        .removeParticipant(tournamentId, participant.team_id)
                        .then(refreshAll)
                        .catch((error: unknown) => toastError(error))
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </Panel>
        ) : (
          <Panel className="p-6">
            <p className="font-sans text-sm text-willow-soft">
              No teams yet. Add the sides taking part, then generate the fixtures.
            </p>
          </Panel>
        )}
      </section>

      {standings.data && standings.data.standings.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Points table</SectionTitle>
          <StandingsTable
            rows={standings.data.standings}
            groups={standings.data.groups}
            advancing={detail.teams_advancing_per_group}
            useNetRunRate={detail.use_net_run_rate}
          />
        </section>
      )}

      {fixtures.data && fixtures.data.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Fixtures</SectionTitle>
          <Panel className="flex flex-col">
            {fixtures.data.map((fixture, index) => (
              <div key={fixture.id}>
                {index > 0 && <Seam />}
                <Link
                  to={`/app/matches/${fixture.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-pitch-line"
                >
                  <span className="font-sans text-sm text-chalk">
                    {fixture.team_a_name} <span className="text-willow">v</span>{" "}
                    {fixture.team_b_name}
                  </span>
                  <span className="flex items-center gap-2 font-sans text-xs text-willow">
                    {fixture.score_line ?? formatDateTime(fixture.scheduled_at)}
                    <Badge tone={fixture.status === "live" ? "live" : "quiet"}>
                      {fixture.status}
                    </Badge>
                  </span>
                </Link>
              </div>
            ))}
          </Panel>
        </section>
      )}

      {bracket.data && bracket.data.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Bracket</SectionTitle>
          <Panel className="flex flex-col">
            {bracket.data.map((node, index) => (
              <div key={node.id}>
                {index > 0 && <Seam />}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 font-sans text-sm text-chalk">
                  <span>
                    <span className="mr-2 text-xs tracking-[0.12em] text-willow uppercase">
                      {node.round.replace(/_/g, " ")}
                    </span>
                    {node.team_a_name ?? node.source_a_label ?? "TBD"}{" "}
                    <span className="text-willow">v</span>{" "}
                    {node.team_b_name ?? node.source_b_label ?? "TBD"}
                  </span>
                  {node.match_id && (
                    <Link
                      to={`/app/matches/${node.match_id}`}
                      className="text-xs text-flip underline"
                    >
                      Score it
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </Panel>
        </section>
      )}

      <Modal
        open={addingTeams}
        onClose={() => setAddingTeams(false)}
        title="Add teams"
        description="Only teams you have saved appear here."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddingTeams(false)}>
              Cancel
            </Button>
            <Button form="add-teams" type="submit" loading={addParticipants.isPending}>
              Add selected
            </Button>
          </>
        }
      >
        <form
          id="add-teams"
          className="flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            const ids = formTexts(new FormData(event.currentTarget), "team");
            if (ids.length > 0) addParticipants.mutate(ids);
          }}
        >
          {addable.length === 0 ? (
            <p className="font-sans text-sm text-willow-soft">
              Every saved team is already entered.
            </p>
          ) : (
            addable.map((team) => (
              <CheckField key={team.id} label={team.name} name="team" value={team.id} />
            ))
          )}
        </form>
      </Modal>

      <Modal
        open={generating}
        onClose={() => setFixtureStart(null)}
        title="Generate fixtures"
        description="A round robin across the entered teams. You can edit or delete any fixture afterwards."
        footer={
          <>
            <Button variant="ghost" onClick={() => setFixtureStart(null)}>
              Cancel
            </Button>
            <Button form="gen-fixtures" type="submit" loading={generateFixtures.isPending}>
              Generate
            </Button>
          </>
        }
      >
        <form
          id="gen-fixtures"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const start = formText(data, "start");
            generateFixtures.mutate({
              double_round: formText(data, "double") === "on",
              start_date: start ? new Date(start).toISOString() : null,
              interval_minutes: formNumber(data, "interval") ?? 180,
              venue: formText(data, "venue") || null,
              overs_limit: formNumber(data, "overs"),
            });
          }}
        >
          <TextField
            label="First match starts"
            name="start"
            type="datetime-local"
            defaultValue={fixtureStart ?? ""}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Minutes between matches"
              name="interval"
              type="number"
              min={30}
              step={30}
              defaultValue={180}
            />
            <TextField
              label="Overs per match"
              name="overs"
              type="number"
              min={1}
              max={90}
              defaultValue={detail.default_overs_limit ?? 20}
            />
          </div>
          <TextField label="Venue" name="venue" defaultValue={detail.venue ?? ""} />
          <SelectField label="Rounds" name="double" defaultValue="">
            <option value="">Single round robin</option>
            <option value="on">Double (home and away)</option>
          </SelectField>
        </form>
      </Modal>
    </div>
  );
}
