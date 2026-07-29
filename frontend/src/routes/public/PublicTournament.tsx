/**
 * The public tournament page: table, fixtures and bracket on one shareable link.
 */

import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { SeamMark } from "@/components/layout/Brand";
import { StandingsTable } from "@/components/ledger/StandingsTable";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
import { publicApi } from "@/lib/api/endpoints";
import type { BracketRound, MatchStatus } from "@/lib/api/types";
import { copyToClipboard, formatDateTime } from "@/lib/utils";
import { toast } from "@/store/toast";

const ROUND_LABELS: Record<BracketRound, string> = {
  round_of_16: "Round of 16",
  quarter_final: "Quarter-finals",
  semi_final: "Semi-finals",
  third_place: "Third place",
  final: "Final",
};

const STATUS_TONE: Record<MatchStatus, "live" | "neutral" | "quiet"> = {
  setup: "quiet",
  live: "live",
  innings_break: "live",
  completed: "neutral",
  abandoned: "quiet",
};

export default function PublicTournament() {
  const { slug } = useParams<{ slug: string }>();

  const query = useQuery({
    queryKey: ["public-tournament", slug],
    enabled: Boolean(slug),
    queryFn: () => publicApi.tournament(slug!),
    // A tournament page changes when a fixture finishes, not every second.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (query.isLoading) return <Spinner label="Loading the tournament" />;

  if (!query.data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          title="That tournament is not available"
          description={
            query.error instanceof ApiError
              ? query.error.message
              : "The link may be wrong, or the organiser may have removed it."
          }
          action={
            <Link to="/">
              <Button variant="ghost">Go to Pitchside</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const { tournament, standings, groups, fixtures, bracket } = query.data;
  const rounds = [...new Set(bracket.map((node) => node.round))];

  return (
    <div className="min-h-dvh bg-pitch">
      <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link to="/" className="flex items-center gap-2">
          <SeamMark className="size-6" />
          <span className="font-sans text-sm font-semibold tracking-wide text-chalk">
            Pitchside
          </span>
        </Link>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void copyToClipboard(window.location.href).then((ok) =>
              toast(ok ? "Link copied." : window.location.href, ok ? "success" : "info"),
            )
          }
        >
          Share
        </Button>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 pb-16">
        <div>
          <h1 className="font-sans text-xl font-semibold text-chalk">{tournament.name}</h1>
          <p className="pt-1 font-sans text-xs text-willow">
            {tournament.format.replace("_", " ")} · {tournament.status}
          </p>
        </div>

        <StandingsTable
          rows={standings}
          groups={groups}
          advancing={tournament.teams_advancing_per_group}
          useNetRunRate={tournament.use_net_run_rate}
        />

        {rounds.length > 0 && (
          <section className="flex flex-col gap-3">
            <SectionTitle>Knockout</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rounds.map((round) => (
                <Panel key={round} className="flex flex-col">
                  <p className="px-3 py-2 font-sans text-xs font-bold tracking-[0.14em] text-willow uppercase">
                    {ROUND_LABELS[round]}
                  </p>
                  <Seam />
                  <ul className="flex flex-col">
                    {bracket
                      .filter((node) => node.round === round)
                      .map((node) => (
                        <li key={node.id} className="px-3 py-2 font-sans text-sm text-chalk">
                          <span className={node.winner_team_id ? "font-semibold" : undefined}>
                            {node.team_a ?? "TBD"}
                          </span>
                          <span className="text-willow"> v </span>
                          <span>{node.team_b ?? "TBD"}</span>
                          {node.match_slug && (
                            <Link
                              to={`/s/${node.match_slug}`}
                              className="block text-xs text-flip underline"
                            >
                              Scorecard
                            </Link>
                          )}
                        </li>
                      ))}
                  </ul>
                </Panel>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3">
          <SectionTitle>Fixtures &amp; results</SectionTitle>
          {fixtures.length === 0 ? (
            <Panel className="p-6">
              <p className="font-sans text-sm text-willow-soft">
                No fixtures have been published yet.
              </p>
            </Panel>
          ) : (
            <Panel className="flex flex-col">
              {fixtures.map((fixture, index) => (
                <div key={fixture.id}>
                  {index > 0 && <Seam />}
                  <Link
                    to={`/s/${fixture.slug}`}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 hover:bg-pitch-line"
                  >
                    <span className="font-sans text-sm text-chalk">
                      {fixture.team_a ?? "TBD"} <span className="text-willow">v</span>{" "}
                      {fixture.team_b ?? "TBD"}
                      {fixture.round && (
                        <span className="pl-2 text-xs text-willow">{fixture.round}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {fixture.result_summary ? (
                        <span className="font-sans text-xs text-willow-soft">
                          {fixture.result_summary}
                        </span>
                      ) : (
                        <span className="font-sans text-xs text-willow">
                          {formatDateTime(fixture.scheduled_at)}
                        </span>
                      )}
                      <Badge tone={STATUS_TONE[fixture.status]}>{fixture.status}</Badge>
                    </span>
                  </Link>
                </div>
              ))}
            </Panel>
          )}
        </section>

        <Seam />
        <footer className="font-sans text-xs text-willow">
          <Link to="/register" className="underline">
            Run your own tournament with Pitchside
          </Link>
        </footer>
      </main>
    </div>
  );
}
