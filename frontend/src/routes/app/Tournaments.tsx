/**
 * Tournaments the signed-in organiser runs.
 */

import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { CheckField, SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge, EmptyState, Panel, Seam, Spinner } from "@/components/ui/Surface";
import { tournaments as api } from "@/lib/api/endpoints";
import type { TournamentFormat } from "@/lib/api/types";
import { formatDate, formFlag, formNumber, formText } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

const FORMATS: Array<[TournamentFormat, string, string]> = [
  ["league", "League", "Everyone plays everyone; the table decides it."],
  ["group_knockout", "Groups + knockout", "Groups first, then a bracket from the qualifiers."],
  ["knockout", "Knockout", "Straight bracket, one defeat and you are out."],
];

export default function Tournaments() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [format, setFormat] = useState<TournamentFormat>("league");

  const list = useQuery({ queryKey: ["tournaments"], queryFn: () => api.list() });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof api.create>[0]) => api.create(input),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["tournaments"] });
      setCreating(false);
      toast(`${created.name} created. Add the teams next.`, "success");
    },
    onError: (error) => toastError(error, "That tournament could not be created."),
  });

  if (list.isLoading) return <Spinner label="Loading your tournaments" />;

  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-sans text-lg font-semibold text-chalk">Tournaments</h1>
          <p className="pt-1 font-sans text-xs text-willow">
            Fixtures, points table and bracket on one public link.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New tournament</Button>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No tournaments yet"
          description="Create one, add the teams, and Pitchside will generate the fixtures and keep the table."
          action={<Button onClick={() => setCreating(true)}>Create a tournament</Button>}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((tournament) => (
            <Panel key={tournament.id}>
              <Link
                to={`/app/tournaments/${tournament.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-pitch-line"
              >
                <span>
                  <span className="block font-sans text-sm font-semibold text-chalk">
                    {tournament.name}
                  </span>
                  <span className="block font-sans text-xs text-willow">
                    {tournament.tournament_format.replace("_", " ")} · {tournament.team_count}{" "}
                    teams · {tournament.match_count} matches
                    {tournament.start_date
                      ? ` · from ${formatDate(tournament.start_date)}`
                      : ""}
                  </span>
                </span>
                <Badge tone={tournament.status === "active" ? "live" : "quiet"}>
                  {tournament.status}
                </Badge>
              </Link>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New tournament"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button form="new-tournament" type="submit" loading={create.isPending}>
              Create
            </Button>
          </>
        }
      >
        <form
          id="new-tournament"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const name = formText(data, "name");
            if (!name) return;
            create.mutate({
              name,
              tournament_format: format,
              venue: formText(data, "venue") || null,
              default_overs_limit: formNumber(data, "overs"),
              teams_advancing_per_group: formNumber(data, "advancing") ?? 2,
              groups: formText(data, "groups")
                .split(",")
                .map((value) => value.trim())
                .filter(Boolean),
              points: {
                points_per_win: 2,
                points_per_tie: 1,
                points_per_loss: 0,
                points_per_no_result: 1,
                use_net_run_rate: formFlag(data, "nrr"),
              },
            });
          }}
        >
          <TextField label="Name" name="name" required data-autofocus maxLength={120} />
          <SelectField
            label="Format"
            value={format}
            hint={FORMATS.find(([value]) => value === format)?.[2]}
            onChange={(event) => setFormat(event.target.value as TournamentFormat)}
          >
            {FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <TextField label="Venue" name="venue" maxLength={120} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Overs per match"
              name="overs"
              type="number"
              min={1}
              max={90}
              defaultValue={20}
            />
            <TextField
              label="Teams advancing per group"
              name="advancing"
              type="number"
              min={1}
              max={8}
              defaultValue={2}
            />
          </div>
          {format === "group_knockout" && (
            <TextField
              label="Groups"
              name="groups"
              placeholder="Group A, Group B"
              hint="Comma separated. You can add more later."
            />
          )}
          <Seam />
          <CheckField
            label="Rank by net run rate"
            name="nrr"
            defaultChecked
            hint="Standard for limited-overs leagues. Turn it off to rank by wins only."
          />
        </form>
      </Modal>
    </div>
  );
}
