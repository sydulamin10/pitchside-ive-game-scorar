/**
 * Team branding and squad management — logos, colours, staff, and player links.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";

import { ImageUpload } from "@/components/media/ImageUpload";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { memberships as membershipsApi, teams as teamsApi } from "@/lib/api/endpoints";
import type { PlayerRole, TeamMemberRole } from "@/lib/api/types";
import { formNumber, formText, initials } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";
import { useState } from "react";

const ROLES: Array<[PlayerRole, string]> = [
  ["batter", "Batter"],
  ["bowler", "Bowler"],
  ["allrounder", "All-rounder"],
  ["wicket_keeper", "Wicket-keeper"],
  ["unknown", "Not sure"],
];

const MEMBER_ROLES: Array<[TeamMemberRole, string]> = [
  ["manager", "Manager"],
  ["coach", "Coach"],
  ["captain", "Captain"],
  ["vice_captain", "Vice-captain"],
  ["player", "Player"],
];

export default function TeamDetail() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamMemberRole>("player");

  const teamQuery = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => teamsApi.get(teamId!),
    enabled: Boolean(teamId),
  });

  const membersQuery = useQuery({
    queryKey: ["team-members", teamId],
    queryFn: () => membershipsApi.list(teamId!),
    enabled: Boolean(teamId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
    void queryClient.invalidateQueries({ queryKey: ["teams"] });
    void queryClient.invalidateQueries({ queryKey: ["team-members", teamId] });
  };

  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) => teamsApi.update(teamId!, input),
    onSuccess: () => {
      invalidate();
      toast("Team updated.", "success");
    },
    onError: (error) => toastError(error, "Could not save the team."),
  });

  const addPlayer = useMutation({
    mutationFn: (input: { name: string; role?: PlayerRole; jersey_number?: number | null }) =>
      teamsApi.addPlayer(teamId!, input),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      toast("Player added.", "success");
    },
    onError: (error) => toastError(error, "Could not add that player."),
  });

  const removePlayer = useMutation({
    mutationFn: (playerId: string) => teamsApi.removePlayer(teamId!, playerId),
    onSuccess: () => {
      invalidate();
      toast("Player removed.", "success");
    },
    onError: (error) => toastError(error, "Could not remove that player."),
  });

  const invite = useMutation({
    mutationFn: () =>
      membershipsApi.invite(teamId!, { email: inviteEmail.trim(), role: inviteRole }),
    onSuccess: (row) => {
      invalidate();
      setInviteEmail("");
      toast(
        row.invite_token
          ? `Invite created. Token: ${row.invite_token}`
          : "Invite sent.",
        "success",
      );
    },
    onError: (error) => toastError(error, "Could not invite that person."),
  });

  const setRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      membershipsApi.setRole(teamId!, memberId, role),
    onSuccess: () => {
      invalidate();
      toast("Role updated.", "success");
    },
    onError: (error) => toastError(error, "Could not change that role."),
  });

  const decide = useMutation({
    mutationFn: ({ memberId, accept }: { memberId: string; accept: boolean }) =>
      membershipsApi.decideRequest(teamId!, memberId, accept),
    onSuccess: () => {
      invalidate();
      toast("Request updated.", "success");
    },
    onError: (error) => toastError(error, "Could not update that request."),
  });

  if (teamQuery.isLoading) return <Spinner label="Loading team" />;
  if (!teamQuery.data) {
    return (
      <EmptyState
        title="Team not found"
        description="It may have been deleted."
        action={
          <Button variant="secondary" onClick={() => navigate("/app/teams")}>
            Back to teams
          </Button>
        }
      />
    );
  }

  const team = teamQuery.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/app/teams" className="font-sans text-xs text-willow hover:text-chalk">
            ← Teams
          </Link>
          <h1 className="mt-1 font-sans text-xl font-semibold text-chalk">{team.name}</h1>
          {team.public_slug && (
            <p className="pt-1 font-sans text-xs text-willow">
              Public:{" "}
              <Link className="text-flip hover:underline" to={`/club/${team.public_slug}`}>
                /club/{team.public_slug}
              </Link>
            </p>
          )}
        </div>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add player
        </Button>
      </header>

      <Panel>
        <SectionTitle>Branding</SectionTitle>
        <Seam className="my-3" />
        <div className="grid gap-4 md:grid-cols-2">
          <ImageUpload
            kind="team_logo"
            label="Logo"
            value={team.logo_url}
            onChange={(logo_url) => update.mutate({ logo_url })}
          />
          <ImageUpload
            kind="team_cover"
            label="Cover"
            value={team.cover_url}
            onChange={(cover_url) => update.mutate({ cover_url })}
          />
        </div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            update.mutate({
              name: formText(data, "name"),
              short_name: formText(data, "short_name") || null,
              primary_color: formText(data, "primary_color") || null,
              secondary_color: formText(data, "secondary_color") || null,
              home_ground: formText(data, "home_ground") || null,
              founded_year: formNumber(data, "founded_year"),
              description: formText(data, "description") || null,
              coach_name: formText(data, "coach_name") || null,
              manager_name: formText(data, "manager_name") || null,
              owner_label: formText(data, "owner_label") || null,
              sponsor: formText(data, "sponsor") || null,
              contact_email: formText(data, "contact_email") || null,
              contact_phone: formText(data, "contact_phone") || null,
            });
          }}
        >
          <TextField name="name" label="Name" defaultValue={team.name} required />
          <TextField name="short_name" label="Short name" defaultValue={team.short_name ?? ""} />
          <TextField
            name="primary_color"
            label="Primary colour"
            defaultValue={team.primary_color ?? ""}
            placeholder="#1a5c2e"
          />
          <TextField
            name="secondary_color"
            label="Secondary colour"
            defaultValue={team.secondary_color ?? ""}
          />
          <TextField name="home_ground" label="Home ground" defaultValue={team.home_ground ?? ""} />
          <TextField
            name="founded_year"
            label="Founded"
            type="number"
            defaultValue={team.founded_year?.toString() ?? ""}
          />
          <TextField name="coach_name" label="Coach" defaultValue={team.coach_name ?? ""} />
          <TextField name="manager_name" label="Manager" defaultValue={team.manager_name ?? ""} />
          <TextField name="owner_label" label="Owner" defaultValue={team.owner_label ?? ""} />
          <TextField name="sponsor" label="Sponsor" defaultValue={team.sponsor ?? ""} />
          <TextField
            name="contact_email"
            label="Contact email"
            defaultValue={team.contact_email ?? ""}
          />
          <TextField
            name="contact_phone"
            label="Contact phone"
            defaultValue={team.contact_phone ?? ""}
          />
          <div className="md:col-span-2">
            <TextField
              name="description"
              label="Description"
              defaultValue={team.description ?? ""}
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" loading={update.isPending}>
              Save details
            </Button>
          </div>
        </form>
      </Panel>

      <Panel>
        <SectionTitle>Members & roles</SectionTitle>
        <Seam className="my-3" />
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (inviteEmail.trim()) invite.mutate();
          }}
        >
          <TextField
            label="Invite by email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            type="email"
            className="min-w-48 flex-1"
          />
          <SelectField
            label="Role"
            value={inviteRole}
            className="w-40"
            onChange={(event) => setInviteRole(event.target.value as TeamMemberRole)}
          >
            {MEMBER_ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <Button type="submit" size="sm" loading={invite.isPending} disabled={!inviteEmail.trim()}>
            Invite
          </Button>
        </form>
        <ul className="divide-y divide-willow/15">
          {(membersQuery.data ?? []).map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-2 py-2 font-sans text-sm">
              <span className="min-w-0 flex-1 text-chalk">
                {member.invited_email ?? member.user_id ?? "Member"}
                <span className="ml-2 font-mono text-[10px] uppercase tracking-wide text-willow">
                  {member.status}
                </span>
              </span>
              <span className="rounded-[2px] border border-willow/40 px-2 py-0.5 font-mono text-[10px] uppercase text-flip">
                {member.role.replaceAll("_", " ")}
              </span>
              {member.status === "requested" && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => decide.mutate({ memberId: member.id, accept: true })}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => decide.mutate({ memberId: member.id, accept: false })}
                  >
                    Reject
                  </Button>
                </>
              )}
              {member.status === "active" && member.role !== "owner" && (
                <SelectField
                  label=""
                  className="w-36"
                  value={member.role}
                  onChange={(event) =>
                    setRole.mutate({ memberId: member.id, role: event.target.value })
                  }
                >
                  {MEMBER_ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </SelectField>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <SectionTitle>Squad ({team.players.length})</SectionTitle>
        <Seam className="my-3" />
        {team.players.length === 0 ? (
          <EmptyState
            title="Empty roster"
            description="Add players so match setup is one tap."
            action={<Button onClick={() => setAdding(true)}>Add player</Button>}
          />
        ) : (
          <ul className="divide-y divide-willow/15">
            {team.players.map((player) => (
              <li key={player.id} className="flex items-center gap-3 py-3">
                <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-willow/30 bg-ink/50 font-sans text-xs text-chalk">
                  {player.photo_url ? (
                    <img src={player.photo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initials(player.name)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/app/teams/${team.id}/players/${player.id}`}
                    className="font-sans text-sm font-medium text-chalk hover:text-flip"
                  >
                    {player.name}
                    {player.jersey_number != null ? ` #${player.jersey_number}` : ""}
                  </Link>
                  <p className="font-sans text-xs text-willow capitalize">
                    {player.role.replaceAll("_", " ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm(`Remove ${player.name}?`)) removePlayer.mutate(player.id);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AddPlayerModal
        open={adding}
        onClose={() => setAdding(false)}
        busy={addPlayer.isPending}
        onSubmit={(input) => addPlayer.mutate(input)}
      />
    </div>
  );
}

function AddPlayerModal({
  open,
  onClose,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  busy: boolean;
  onSubmit: (input: { name: string; role: PlayerRole; jersey_number?: number | null }) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add player">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onSubmit({
            name: formText(data, "name"),
            role: (formText(data, "role") || "unknown") as PlayerRole,
            jersey_number: formNumber(data, "jersey_number"),
          });
        }}
      >
        <TextField name="name" label="Full name" required autoFocus />
        <SelectField name="role" label="Role" defaultValue="unknown">
          {ROLES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <TextField name="jersey_number" label="Jersey #" type="number" />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Add
          </Button>
        </div>
      </form>
    </Modal>
  );
}
