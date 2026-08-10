/**
 * Teams and rosters.
 *
 * A saved team means the next match takes seconds to set up: pick two teams and
 * the squads come with them. Branding and public club pages live on the detail
 * screen.
 */

import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { memberships as membershipsApi, teams as teamsApi } from "@/lib/api/endpoints";
import type { Team } from "@/lib/api/types";
import { formText, initials } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

export default function Teams() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [inviteToken, setInviteToken] = useState("");

  const list = useQuery({ queryKey: ["teams"], queryFn: () => teamsApi.list() });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["teams"] });

  const create = useMutation({
    mutationFn: (input: {
      name: string;
      short_name?: string | null;
      home_ground?: string | null;
      primary_color?: string | null;
    }) => teamsApi.create(input),
    onSuccess: (team) => {
      invalidate();
      setCreating(false);
      toast(`${team.name} saved. Add branding and players next.`, "success");
      window.location.assign(`/app/teams/${team.id}`);
    },
    onError: (error) => toastError(error, "That team could not be saved."),
  });

  const acceptInvite = useMutation({
    mutationFn: () => membershipsApi.acceptInvite(inviteToken.trim()),
    onSuccess: () => {
      setInviteToken("");
      invalidate();
      toast("Invite accepted.", "success");
    },
    onError: (error) => toastError(error, "Could not accept that invite."),
  });

  if (list.isLoading) return <Spinner label="Loading your teams" />;

  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-sans text-lg font-semibold text-chalk">Teams</h1>
          <p className="pt-1 font-sans text-xs text-willow">
            Saved squads with logos, colours, and public club pages.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New team</Button>
      </header>

      <Panel>
        <SectionTitle>Accept invite</SectionTitle>
        <Seam className="my-3" />
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (inviteToken.trim()) acceptInvite.mutate();
          }}
        >
          <TextField
            label="Invite token"
            value={inviteToken}
            onChange={(event) => setInviteToken(event.target.value)}
            className="min-w-64 flex-1"
            placeholder="Paste the token from your invite"
          />
          <Button
            type="submit"
            size="sm"
            loading={acceptInvite.isPending}
            disabled={!inviteToken.trim()}
          >
            Join team
          </Button>
        </form>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState
          title="No teams yet"
          description="Save a team once and every future match with them is two taps away."
          action={<Button onClick={() => setCreating(true)}>Create a team</Button>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((team) => (
            <TeamCard key={team.id} team={team} />
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
            const color = formText(data, "primary_color");
            create.mutate({
              name,
              short_name: formText(data, "short_name") || null,
              home_ground: formText(data, "home_ground") || null,
              primary_color: color || null,
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
          <TextField
            label="Primary colour"
            name="primary_color"
            placeholder="#1e3a2d"
            hint="Hex colour for jerseys and overlays."
          />
        </form>
      </Modal>
    </div>
  );
}

function TeamCard({ team }: { team: Team }) {
  return (
    <Panel className="flex flex-col">
      <Link
        to={`/app/teams/${team.id}`}
        className="flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-pitch-line/40"
      >
        <span className="flex items-center gap-3">
          {team.logo_url ? (
            <img
              src={team.logo_url}
              alt=""
              className="size-9 rounded-[2px] border border-willow/40 object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-[2px] border border-willow/50 font-mono text-xs text-chalk"
              style={team.primary_color ? { borderColor: team.primary_color } : undefined}
            >
              {team.short_name ?? initials(team.name)}
            </span>
          )}
          <span>
            <span className="block font-sans text-sm font-semibold text-chalk">{team.name}</span>
            <span className="block font-sans text-xs text-willow">
              {team.players.length} {team.players.length === 1 ? "player" : "players"}
              {team.home_ground ? ` · ${team.home_ground}` : ""}
            </span>
          </span>
        </span>
        <span aria-hidden="true" className="font-mono text-willow">
          →
        </span>
      </Link>
    </Panel>
  );
}
