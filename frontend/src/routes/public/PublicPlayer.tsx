import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";

import { EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { profiles } from "@/lib/api/endpoints";
import type { CareerStats } from "@/lib/api/types";
import { initials } from "@/lib/utils";

export default function PublicPlayer() {
  const { slug } = useParams<{ slug: string }>();
  const query = useQuery({
    queryKey: ["public-player", slug],
    queryFn: () => profiles.player(slug!),
    enabled: Boolean(slug),
  });
  const statsQuery = useQuery({
    queryKey: ["public-player-stats", slug],
    queryFn: () => profiles.playerStats(slug!),
    enabled: Boolean(slug),
  });
  const awardsQuery = useQuery({
    queryKey: ["public-player-awards", slug],
    queryFn: () => profiles.playerAwards(slug!),
    enabled: Boolean(slug),
  });

  if (query.isLoading) return <Spinner label="Loading player" />;
  if (!query.data) {
    return (
      <EmptyState title="Player not found" description="This profile link is no longer valid." />
    );
  }

  const player = query.data;
  const bornYear = player.date_of_birth
    ? Number(player.date_of_birth.slice(0, 4))
    : null;
  const age =
    bornYear != null && Number.isFinite(bornYear) ? Math.max(0, 2026 - bornYear) : null;
  const qrUrl = profiles.playerQrUrl(player.public_slug ?? player.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div
        className="relative overflow-hidden rounded-[4px] border border-willow/25"
        style={{
          backgroundImage: player.cover_url ? `url(${player.cover_url})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          minHeight: 160,
          backgroundColor: "color-mix(in srgb, var(--color-ink) 90%, transparent)",
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 to-ink/20" />
        <div className="relative flex items-end gap-4 p-5">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-chalk/40 bg-ink font-sans text-xl text-chalk">
            {player.photo_url ? (
              <img src={player.photo_url} alt="" className="h-full w-full object-cover" />
            ) : (
              initials(player.name)
            )}
          </div>
          <div className="pb-1">
            <h1 className="font-sans text-2xl font-semibold text-chalk">
              {player.name}
              {player.jersey_number != null ? (
                <span className="ml-2 font-mono text-flip">#{player.jersey_number}</span>
              ) : null}
            </h1>
            {player.nickname && (
              <p className="font-serif text-sm text-willow italic">“{player.nickname}”</p>
            )}
            <p className="font-sans text-xs tracking-wide text-willow uppercase">
              {player.role.replaceAll("_", " ")}
              {age != null ? ` · ${age}` : ""}
              {player.nationality ? ` · ${player.nationality}` : ""}
            </p>
          </div>
        </div>
      </div>

      {player.team && (
        <p className="font-sans text-sm text-willow">
          Club:{" "}
          <Link
            className="text-flip hover:underline"
            to={player.team.public_slug ? `/club/${player.team.public_slug}` : "#"}
          >
            {player.team.name}
          </Link>
        </p>
      )}

      {(player.bio || player.career_summary) && (
        <Panel>
          <SectionTitle>About</SectionTitle>
          <Seam className="my-3" />
          {player.bio && <p className="font-serif text-sm leading-relaxed text-chalk">{player.bio}</p>}
          {player.career_summary && (
            <p className="mt-3 font-sans text-sm text-willow">{player.career_summary}</p>
          )}
        </Panel>
      )}

      <Panel>
        <SectionTitle>Career</SectionTitle>
        <Seam className="my-3" />
        {statsQuery.isLoading ? (
          <Spinner label="Loading stats" />
        ) : statsQuery.data ? (
          <CareerPanels stats={statsQuery.data} />
        ) : (
          <p className="font-sans text-sm text-willow">No scored matches yet.</p>
        )}
      </Panel>

      <Panel>
        <SectionTitle>Awards</SectionTitle>
        <Seam className="my-3" />
        {(awardsQuery.data ?? []).length === 0 ? (
          <p className="font-sans text-sm text-willow">No awards recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(awardsQuery.data ?? []).map((award) => (
              <li key={award.id} className="flex gap-3 font-sans text-sm">
                <span className="font-mono text-[10px] tracking-wide text-flip uppercase">
                  {award.kind}
                </span>
                <span>
                  <span className="block font-semibold text-chalk">{award.title}</span>
                  {award.description && (
                    <span className="block text-willow">{award.description}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <SectionTitle>Share</SectionTitle>
        <Seam className="my-3" />
        <div className="flex flex-wrap items-center gap-4">
          <img
            src={qrUrl}
            alt="Profile QR code"
            className="h-36 w-36 rounded-[2px] border border-willow/30 bg-chalk"
          />
          <div className="font-sans text-sm text-willow">
            <p>Scan to open this profile.</p>
            <a
              className="mt-2 inline-block text-flip hover:underline"
              href={qrUrl}
              download={`${player.public_slug ?? "player"}-qr.svg`}
            >
              Download QR (SVG)
            </a>
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Cricket</SectionTitle>
        <Seam className="my-3" />
        <dl className="grid grid-cols-2 gap-3 font-sans text-sm md:grid-cols-3">
          <Stat label="Batting" value={player.batting_hand ?? "—"} />
          <Stat label="Bowling" value={player.bowling_style?.replaceAll("_", " ") ?? "—"} />
          <Stat label="Location" value={player.location ?? "—"} />
          <Stat label="Height" value={player.height_cm ? `${player.height_cm} cm` : "—"} />
          <Stat label="Weight" value={player.weight_kg ? `${player.weight_kg} kg` : "—"} />
        </dl>
      </Panel>
    </div>
  );
}

function CareerPanels({ stats }: { stats: CareerStats }) {
  const bat = stats.batting ?? {};
  const bowl = stats.bowling ?? {};
  const field = stats.fielding ?? {};
  const recent = Array.isArray(stats.recent_matches) ? stats.recent_matches : [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 font-sans text-xs tracking-wide text-willow uppercase">Batting</p>
        <dl className="grid grid-cols-3 gap-2 font-sans text-sm md:grid-cols-5">
          <Stat label="Mat" value={String(bat.matches ?? 0)} />
          <Stat label="Inns" value={String(bat.innings ?? 0)} />
          <Stat label="Runs" value={String(bat.runs ?? 0)} />
          <Stat label="HS" value={formatHigh(bat.highest, bat.highest_not_out)} />
          <Stat label="Avg" value={formatNum(bat.average)} />
          <Stat label="SR" value={formatNum(bat.strike_rate)} />
          <Stat label="50s" value={String(bat.fifties ?? 0)} />
          <Stat label="100s" value={String(bat.hundreds ?? 0)} />
          <Stat label="4s" value={String(bat.fours ?? 0)} />
          <Stat label="6s" value={String(bat.sixes ?? 0)} />
        </dl>
        <FormChart
          label="Recent runs"
          values={recent.map((row) => Number((row as { batting?: { runs?: number } }).batting?.runs ?? 0))}
        />
      </div>
      <div>
        <p className="mb-2 font-sans text-xs tracking-wide text-willow uppercase">Bowling</p>
        <dl className="grid grid-cols-3 gap-2 font-sans text-sm md:grid-cols-5">
          <Stat label="Mat" value={String(bowl.matches ?? 0)} />
          <Stat label="Overs" value={String(bowl.overs_text ?? "0")} />
          <Stat label="Wkts" value={String(bowl.wickets ?? 0)} />
          <Stat label="Runs" value={String(bowl.runs_conceded ?? 0)} />
          <Stat label="Econ" value={formatNum(bowl.economy)} />
          <Stat label="Avg" value={formatNum(bowl.average)} />
          <Stat label="Best" value={String(bowl.best_figures ?? "—")} />
          <Stat label="Mdns" value={String(bowl.maidens ?? 0)} />
        </dl>
      </div>
      <div>
        <p className="mb-2 font-sans text-xs tracking-wide text-willow uppercase">Fielding</p>
        <dl className="grid grid-cols-3 gap-2 font-sans text-sm">
          <Stat label="Catches" value={String(field.catches ?? 0)} />
          <Stat label="Stumpings" value={String(field.stumpings ?? 0)} />
          <Stat label="Run outs" value={String(field.run_outs ?? 0)} />
        </dl>
      </div>
    </div>
  );
}

function FormChart({ label, values }: { label: string; values: number[] }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div className="mt-4">
      <p className="mb-2 font-sans text-[10px] tracking-wide text-willow uppercase">{label}</p>
      <div className="flex h-16 items-end gap-1">
        {values.map((value, index) => (
          <div
            key={index}
            title={String(value)}
            className="min-w-[6px] flex-1 rounded-t-[2px] bg-flip/80"
            style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function formatNum(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

function formatHigh(highest: unknown, notOut: unknown): string {
  if (typeof highest !== "number") return "—";
  return notOut ? `${highest}*` : String(highest);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-willow uppercase">{label}</dt>
      <dd className="mt-0.5 capitalize text-chalk">{value}</dd>
    </div>
  );
}
