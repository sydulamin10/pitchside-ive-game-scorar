import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { useState } from "react";

import { ImageUpload } from "@/components/media/ImageUpload";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { awards as awardsApi, teams as teamsApi } from "@/lib/api/endpoints";
import type { PlayerRole } from "@/lib/api/types";
import { formNumber, formText } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

const ROLES: Array<[PlayerRole, string]> = [
  ["batter", "Batter"],
  ["bowler", "Bowler"],
  ["allrounder", "All-rounder"],
  ["wicket_keeper", "Wicket-keeper"],
  ["unknown", "Not sure"],
];

export default function PlayerEdit() {
  const { teamId, playerId } = useParams<{ teamId: string; playerId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [awardTitle, setAwardTitle] = useState("");
  const [awardKind, setAwardKind] = useState<"trophy" | "certificate" | "achievement">(
    "achievement",
  );

  const teamQuery = useQuery({
    queryKey: ["team", teamId],
    queryFn: () => teamsApi.get(teamId!),
    enabled: Boolean(teamId),
  });

  const awardsQuery = useQuery({
    queryKey: ["player-awards", teamId, playerId],
    queryFn: () => awardsApi.list(teamId!, playerId!),
    enabled: Boolean(teamId && playerId),
  });

  const player = teamQuery.data?.players.find((row) => row.id === playerId);

  const update = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      teamsApi.updatePlayer(teamId!, playerId!, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      void queryClient.invalidateQueries({ queryKey: ["teams"] });
      toast("Player saved.", "success");
    },
    onError: (error) => toastError(error, "Could not save the player."),
  });

  const addAward = useMutation({
    mutationFn: () =>
      awardsApi.create(teamId!, playerId!, { title: awardTitle.trim(), kind: awardKind }),
    onSuccess: () => {
      setAwardTitle("");
      void queryClient.invalidateQueries({ queryKey: ["player-awards", teamId, playerId] });
      toast("Award added.", "success");
    },
    onError: (error) => toastError(error, "Could not add that award."),
  });

  const removeAward = useMutation({
    mutationFn: (awardId: string) => awardsApi.remove(teamId!, playerId!, awardId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["player-awards", teamId, playerId] });
      toast("Award removed.", "success");
    },
    onError: (error) => toastError(error, "Could not remove that award."),
  });

  if (teamQuery.isLoading) return <Spinner label="Loading player" />;
  if (!player || !teamQuery.data) {
    return (
      <EmptyState
        title="Player not found"
        description="They may have been removed from this roster."
        action={
          <Button variant="secondary" onClick={() => navigate(`/app/teams/${teamId}`)}>
            Back
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link
          to={`/app/teams/${teamId}`}
          className="font-sans text-xs text-willow hover:text-chalk"
        >
          ← {teamQuery.data.name}
        </Link>
        <h1 className="mt-1 font-sans text-xl font-semibold text-chalk">{player.name}</h1>
        {player.public_slug && (
          <p className="pt-1 font-sans text-xs text-willow">
            Public:{" "}
            <Link className="text-flip hover:underline" to={`/p/${player.public_slug}`}>
              /p/{player.public_slug}
            </Link>
          </p>
        )}
      </header>

      <Panel>
        <SectionTitle>Photos</SectionTitle>
        <Seam className="my-3" />
        <div className="grid gap-4 md:grid-cols-2">
          <ImageUpload
            kind="player_photo"
            label="Headshot"
            round
            value={player.photo_url}
            onChange={(photo_url) => update.mutate({ photo_url })}
          />
          <ImageUpload
            kind="player_cover"
            label="Cover"
            value={player.cover_url}
            onChange={(cover_url) => update.mutate({ cover_url })}
          />
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Profile</SectionTitle>
        <Seam className="my-3" />
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const facebook = formText(data, "facebook");
            const instagram = formText(data, "instagram");
            const youtube = formText(data, "youtube");
            const website = formText(data, "website");
            const social_links: Record<string, string> = {};
            if (facebook) social_links.facebook = facebook;
            if (instagram) social_links.instagram = instagram;
            if (youtube) social_links.youtube = youtube;
            if (website) social_links.website = website;
            update.mutate({
              name: formText(data, "name"),
              nickname: formText(data, "nickname") || null,
              role: formText(data, "role") || "unknown",
              batting_hand: formText(data, "batting_hand") || null,
              bowling_style: formText(data, "bowling_style") || null,
              jersey_number: formNumber(data, "jersey_number"),
              date_of_birth: formText(data, "date_of_birth") || null,
              nationality: formText(data, "nationality") || null,
              location: formText(data, "location") || null,
              height_cm: formNumber(data, "height_cm"),
              weight_kg: formNumber(data, "weight_kg"),
              bio: formText(data, "bio") || null,
              career_summary: formText(data, "career_summary") || null,
              social_links,
            });
          }}
        >
          <TextField name="name" label="Full name" defaultValue={player.name} required />
          <TextField name="nickname" label="Nickname" defaultValue={player.nickname ?? ""} />
          <SelectField name="role" label="Role" defaultValue={player.role}>
            {ROLES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectField>
          <TextField
            name="jersey_number"
            label="Jersey #"
            type="number"
            defaultValue={player.jersey_number?.toString() ?? ""}
          />
          <SelectField name="batting_hand" label="Batting" defaultValue={player.batting_hand ?? ""}>
            <option value="">—</option>
            <option value="right">Right-hand</option>
            <option value="left">Left-hand</option>
          </SelectField>
          <SelectField
            name="bowling_style"
            label="Bowling"
            defaultValue={player.bowling_style ?? ""}
          >
            <option value="">—</option>
            <option value="right_arm_fast">Right-arm fast</option>
            <option value="right_arm_medium">Right-arm medium</option>
            <option value="right_arm_off_spin">Right-arm off-spin</option>
            <option value="right_arm_leg_spin">Right-arm leg-spin</option>
            <option value="left_arm_fast">Left-arm fast</option>
            <option value="left_arm_medium">Left-arm medium</option>
            <option value="left_arm_orthodox">Left-arm orthodox</option>
            <option value="left_arm_chinaman">Left-arm chinaman</option>
          </SelectField>
          <TextField
            name="date_of_birth"
            label="Date of birth"
            type="date"
            defaultValue={player.date_of_birth ?? ""}
          />
          <TextField
            name="nationality"
            label="Nationality"
            defaultValue={player.nationality ?? ""}
          />
          <TextField name="location" label="Location" defaultValue={player.location ?? ""} />
          <TextField
            name="height_cm"
            label="Height (cm)"
            type="number"
            defaultValue={player.height_cm?.toString() ?? ""}
          />
          <TextField
            name="weight_kg"
            label="Weight (kg)"
            type="number"
            defaultValue={player.weight_kg?.toString() ?? ""}
          />
          <div className="md:col-span-2">
            <TextField name="bio" label="Bio" defaultValue={player.bio ?? ""} />
          </div>
          <div className="md:col-span-2">
            <TextField
              name="career_summary"
              label="Career summary"
              defaultValue={player.career_summary ?? ""}
            />
          </div>
          <TextField
            name="facebook"
            label="Facebook"
            defaultValue={player.social_links.facebook ?? ""}
          />
          <TextField
            name="instagram"
            label="Instagram"
            defaultValue={player.social_links.instagram ?? ""}
          />
          <TextField
            name="youtube"
            label="YouTube"
            defaultValue={player.social_links.youtube ?? ""}
          />
          <TextField
            name="website"
            label="Website"
            defaultValue={player.social_links.website ?? ""}
          />
          <div className="md:col-span-2">
            <Button type="submit" loading={update.isPending}>
              Save player
            </Button>
          </div>
        </form>
      </Panel>

      <Panel>
        <SectionTitle>Awards</SectionTitle>
        <Seam className="my-3" />
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (awardTitle.trim()) addAward.mutate();
          }}
        >
          <TextField
            label="Title"
            value={awardTitle}
            onChange={(event) => setAwardTitle(event.target.value)}
            className="min-w-48 flex-1"
          />
          <SelectField
            label="Kind"
            value={awardKind}
            className="w-40"
            onChange={(event) =>
              setAwardKind(event.target.value as "trophy" | "certificate" | "achievement")
            }
          >
            <option value="achievement">Achievement</option>
            <option value="trophy">Trophy</option>
            <option value="certificate">Certificate</option>
          </SelectField>
          <Button type="submit" size="sm" loading={addAward.isPending} disabled={!awardTitle.trim()}>
            Add
          </Button>
        </form>
        <ul className="divide-y divide-willow/15">
          {(awardsQuery.data ?? []).map((award) => (
            <li key={award.id} className="flex items-center gap-3 py-2 font-sans text-sm">
              <span className="font-mono text-[10px] uppercase tracking-wide text-flip">
                {award.kind}
              </span>
              <span className="min-w-0 flex-1 text-chalk">{award.title}</span>
              <Button size="sm" variant="ghost" onClick={() => removeAward.mutate(award.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
