/**
 * The public scorecard: the link that gets shared in a WhatsApp group.
 *
 * It must open fast on a cheap phone with two bars of signal, need no login, and
 * update itself without the viewer doing anything. The live frame arrives over
 * SSE (falling back to polling), and the full ledger is fetched once and then
 * refreshed only when the version moves — so following a match costs a few
 * hundred bytes a ball.
 */

import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { ScoreBoard } from "@/components/board/ScoreBoard";
import { SeamMark } from "@/components/layout/Brand";
import { InningsScorecard } from "@/components/ledger/Scorecard";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { publicApi } from "@/lib/api/endpoints";
import { ApiError } from "@/lib/api/client";
import { compactFromSnapshot } from "@/lib/console/compact";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { copyToClipboard, formatDateTime, relativeTime } from "@/lib/utils";
import { toast } from "@/store/toast";

export default function PublicMatch() {
  const { slug } = useParams<{ slug: string }>();

  const scorecard = useQuery({
    queryKey: ["public-match", slug],
    enabled: Boolean(slug),
    queryFn: () => publicApi.match(slug!),
    staleTime: 10_000,
  });

  const stream = useMatchStream(slug, { onResync: () => void scorecard.refetch() });

  const version = scorecard.data?.match.state_version ?? 0;
  const liveVersion = stream.state?.state_version ?? 0;

  // The board is live off the frame; the ledger is refetched only when it drifts.
  useEffect(() => {
    if (liveVersion > version) void scorecard.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveVersion, version]);

  const snapshot = scorecard.data ?? null;
  const current = useMemo(() => {
    if (!snapshot) return null;
    return (
      snapshot.innings.find((entry) => entry.id === snapshot.current_innings_id) ??
      snapshot.innings.at(-1) ??
      null
    );
  }, [snapshot]);

  if (scorecard.isLoading) return <Spinner label="Loading the scorecard" />;

  if (!snapshot) {
    const error = scorecard.error;
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          title="That scorecard is not available"
          description={
            error instanceof ApiError
              ? error.message
              : "The link may be wrong, or the match may have been removed."
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

  const match = snapshot.match;
  // Prefer the realtime frame: it is newer than the fetched ledger between refetches.
  const board =
    stream.state && liveVersion >= version
      ? stream.state
      : compactFromSnapshot(snapshot, current);

  return (
    <div className="min-h-dvh bg-pitch">
      <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link to="/" className="flex items-center gap-2">
          <SeamMark className="size-6" />
          <span className="font-sans text-sm font-semibold tracking-wide text-chalk">
            Pitchside
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone={stream.status === "live" ? "live" : "quiet"}>
            {stream.status === "live"
              ? `live · ${relativeTime(stream.updatedAt)}`
              : stream.status === "polling"
                ? "updating"
                : stream.status === "offline"
                  ? "offline"
                  : "connecting"}
          </Badge>
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
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 pb-16">
        <div>
          <h1 className="font-sans text-xl font-semibold text-chalk">{match.title}</h1>
          <p className="pt-1 font-sans text-xs text-willow">
            {[
              match.venue,
              match.city,
              match.scheduled_at ? formatDateTime(match.scheduled_at) : null,
              match.tournament?.name,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <ScoreBoard state={board} title={null} live={stream.status === "live"} />

        {match.tournament && (
          <Link
            to={`/t/${match.tournament.slug}`}
            className="font-sans text-sm text-flip underline"
          >
            {match.tournament.name}
            {match.tournament.round ? ` · ${match.tournament.round}` : ""} — table and fixtures
          </Link>
        )}

        {snapshot.innings.length === 0 ? (
          <Panel className="p-6">
            <SectionTitle>Not started</SectionTitle>
            <p className="pt-2 font-sans text-sm text-willow-soft">
              The scorer has not started this match yet. This page will update itself when they
              do.
            </p>
          </Panel>
        ) : (
          snapshot.innings.map((entry) => (
            <section key={entry.id} className="flex flex-col gap-3 pt-2">
              <div className="flex items-center gap-2">
                <SectionTitle>
                  {entry.batting_team_name} · {entry.state.total_runs}/{entry.state.wickets} (
                  {entry.state.overs_text})
                </SectionTitle>
                {entry.id === snapshot.current_innings_id && match.status === "live" && (
                  <Badge tone="live">Batting</Badge>
                )}
              </div>
              <InningsScorecard innings={entry} />
            </section>
          ))
        )}

        <Seam />
        <footer className="flex flex-wrap items-center justify-between gap-3 font-sans text-xs text-willow">
          <span>Scored ball by ball with Pitchside.</span>
          <div className="flex gap-3">
            <Link to={`/s/${match.slug}/overlay`} className="underline">
              Broadcast overlay
            </Link>
            <Link to="/register" className="underline">
              Score your own match
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
