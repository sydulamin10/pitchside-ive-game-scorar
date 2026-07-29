/**
 * Teams and rosters.
 *
 * A saved team means the next match takes seconds to set up: pick two teams and
 * the squads come with them. Players are kept per team and can be marked inactive
 * rather than deleted, because a scorecard from last season still names them.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { teams as teamsApi } from "@/lib/api/endpoints";
import type { Player, PlayerRole, Team } from "@/lib/api/types";
import { formText, initials } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

const ROLES: Array<[PlayerRole, string]> = [
  ["batter", "Batter"],
  ["bowler", "Bowler"],
  ["allrounder", "All-rounder"],
  ["wicket_keeper", "Wicket-keeper"],
  ["unknown", "Not sure"],
];

export default function Teams() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

  const list = useQuery({ queryKey: ["teams"], queryFn: () => teamsApi.list() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["teams"] });

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      short_name?: string | null;
      home_ground?: string | null;
    }) => teamsApi.create(input),
    onSuccess: (team) => {
      invalidate();
      setCreating(false);
      setOpenTeamId(team.id);
      toast(`${team.name} saved. Add the players next.`, "success");
    },
    onError: (error) => toastError(error, "That team could not be saved."),
  });

  if (list.isLoading) return <Spinner label="Loading your teams" />;

  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-sans text-lg font-semibold text-chalk">Teams</h1>
          <p className="pt-1 font-sans text-xs text-willow">
            Saved squads, ready to drop into a match.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New team</Button>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No teams yet"
          description="Save a team once and every future match with them is two taps away."
          action={<Button onClick={() => setCreating(true)}>Create a team</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              open={openTeamId === team.id}
              onToggle={() => setOpenTeamId(openTeamId === team.id ? null : team.id)}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New team"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button form="new-team" type="submit" loading={create.isPending}>
              Save the team
            </Button>
          </>
        }
      >
        <form
          id="new-team"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const name = formText(data, "name");
            if (!name) return;
            create.mutate({
              name,
              short_name: formText(data, "short_name") || null,
              home_ground: formText(data, "home_ground") || null,
            });
          }}
        >
          <TextField label="Team name" name="name" required data-autofocus maxLength={80} />
          <TextField
            label="Short name"
            name="short_name"
            maxLength={6}
            hint="Three or four letters for the scoreboard, e.g. MUM."
          />
          <TextField label="Home ground" name="home_ground" maxLength={120} />
        </form>
      </Modal>
    </div>
  );
}

function TeamCard({
  team,
  open,
  onToggle,
  onChanged,
}: {
  team: Team;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<PlayerRole>("batter");

  const addPlayer = useMutation({
    mutationFn: () => teamsApi.addPlayer(team.id, { name: name.trim(), role }),
    onSuccess: () => {
      setName("");
      onChanged();
    },
    onError: (error) => toastError(error, "That player could not be added."),
  });

  const removePlayer = useMutation({
    mutationFn: (playerId: string) => teamsApi.removePlayer(team.id, playerId),
    onSuccess: onChanged,
    onError: (error) => toastError(error, "That player could not be removed."),
  });

  const removeTeam = useMutation({
    mutationFn: () => teamsApi.remove(team.id),
    onSuccess: () => {
      toast(`${team.name} removed.`, "success");
      onChanged();
    },
    onError: (error) => toastError(error, "That team could not be removed."),
  });

  return (
    <Panel className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-[2px] border border-willow/50 font-mono text-xs text-chalk"
            style={team.primary_color ? { borderColor: team.primary_color } : undefined}
          >
            {team.short_name ?? initials(team.name)}
          </span>
          <span>
            <span className="block font-sans text-sm font-semibold text-chalk">
              {team.name}
            </span>
            <span className="block font-sans text-xs text-willow">
              {team.players.length} {team.players.length === 1 ? "player" : "players"}
              {team.home_ground ? ` · ${team.home_ground}` : ""}
            </span>
          </span>
        </span>
        <span aria-hidden="true" className="font-mono text-willow">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <>
          <Seam />
          <ul className="flex flex-col">
            {team.players.map((player: Player, index) => (
              <li
                key={player.id}
                className="flex items-center justify-between gap-2 px-4 py-2 font-sans text-sm text-chalk"
              >
                <span>
                  <span className="mr-2 font-mono text-xs text-willow">{index + 1}</span>
                  {player.name}
                  <span className="pl-2 text-xs text-willow">
                    {player.role !== "unknown" ? player.role.replace("_", " ") : ""}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removePlayer.mutate(player.id)}
                  aria-label={`Remove ${player.name}`}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <Seam />
          <form
            className="flex flex-wrap items-end gap-2 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) addPlayer.mutate();
            }}
          >
            <TextField
              label="Add a player"
              value={name}
              maxLength={80}
              className="min-w-40 flex-1"
              onChange={(event) => setName(event.target.value)}
            />
            <SelectField
              label="Role"
              value={role}
              className="w-36"
              onChange={(event) => setRole(event.target.value as PlayerRole)}
            >
              {ROLES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectField>
            <Button type="submit" loading={addPlayer.isPending} disabled={!name.trim()}>
              Add
            </Button>
          </form>

          <Seam />
          <div className="px-4 py-3">
            <SectionTitle>Danger zone</SectionTitle>
            <Button
              size="sm"
              variant="danger"
              className="mt-2"
              loading={removeTeam.isPending}
              onClick={() => removeTeam.mutate()}
            >
              Delete this team
            </Button>
            <p className="pt-1 font-sans text-xs text-willow">
              Matches already scored keep their own copy of the squad.
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}
