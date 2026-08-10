import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { profiles } from "@/lib/api/endpoints";
import { initials } from "@/lib/utils";

export default function PublicClub() {
  const { slug } = useParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ["public-club", slug],
    queryFn: () => profiles.club(slug!),
    enabled: Boolean(slug),
  });

  if (query.isLoading) return <Spinner label="Loading club" />;
  if (!query.data) {
    return <EmptyState title="Club not found" description="This club link is no longer valid." />;
  }

  const club = query.data;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div
        className="relative overflow-hidden rounded-[4px] border border-willow/25"
        style={{
          backgroundImage: club.cover_url ? `url(${club.cover_url})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          minHeight: 180,
          backgroundColor: club.primary_color ?? "color-mix(in srgb, var(--color-ink) 90%, transparent)",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-ink/95 to-ink/30" />
        <div className="relative flex items-end gap-4 p-5">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[4px] border border-chalk/30 bg-ink font-sans text-lg text-chalk">
            {club.logo_url ? (
              <img src={club.logo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              club.short_name ?? initials(club.name)
            )}
          </div>
          <div>
            <h1 className="font-sans text-2xl font-semibold text-chalk">{club.name}</h1>
            <p className="font-sans text-xs text-willow">
              {[club.home_ground, club.founded_year ? `Est. ${club.founded_year}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </div>

      {club.description && (
        <Panel>
          <SectionTitle>About</SectionTitle>
          <Seam className="my-3" />
          <p className="font-serif text-sm leading-relaxed text-chalk">{club.description}</p>
        </Panel>
      )}

      <Panel>
        <SectionTitle>Staff</SectionTitle>
        <Seam className="my-3" />
        <dl className="grid grid-cols-2 gap-3 font-sans text-sm">
          <div>
            <dt className="text-xs text-willow uppercase">Coach</dt>
            <dd className="text-chalk">{club.coach_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-willow uppercase">Manager</dt>
            <dd className="text-chalk">{club.manager_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-willow uppercase">Owner</dt>
            <dd className="text-chalk">{club.owner_label ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-willow uppercase">Sponsor</dt>
            <dd className="text-chalk">{club.sponsor ?? "—"}</dd>
          </div>
        </dl>
      </Panel>

      <Panel>
        <SectionTitle>Squad</SectionTitle>
        <Seam className="my-3" />
        <ul className="divide-y divide-willow/15">
          {club.players.map((player) => (
            <li key={player.id} className="flex items-center gap-3 py-2.5">
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-willow/30 bg-ink/40 font-sans text-[10px] text-chalk">
                {player.photo_url ? (
                  <img src={player.photo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(player.name)
                )}
              </div>
              <div className="min-w-0 flex-1">
                {player.public_slug ? (
                  <Link to={`/p/${player.public_slug}`} className="font-sans text-sm text-chalk hover:text-flip">
                    {player.name}
                  </Link>
                ) : (
                  <span className="font-sans text-sm text-chalk">{player.name}</span>
                )}
                <p className="font-sans text-xs text-willow capitalize">
                  {player.role.replaceAll("_", " ")}
                  {player.jersey_number != null ? ` · #${player.jersey_number}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
