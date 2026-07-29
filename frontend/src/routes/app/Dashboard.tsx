import { useQuery } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import { Link } from "react-router";

import { StumpsMark } from "@/components/layout/Brand";
import { Button } from "@/components/ui/Button";
import { Badge, EmptyState, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { matches } from "@/lib/api/endpoints";
import type { MatchListItem, MatchStatus } from "@/lib/api/types";
import { MATCH_FORMAT_LABELS } from "@/lib/api/types";
import { copyToClipboard, formatDateTime } from "@/lib/utils";
import { toast } from "@/store/toast";

const STATUS_TONE: Record<MatchStatus, "live" | "neutral" | "quiet" | "wicket"> = {
  live: "live",
  innings_break: "neutral",
  setup: "quiet",
  completed: "quiet",
  abandoned: "wicket",
};

const STATUS_LABEL: Record<MatchStatus, string> = {
  live: "Live",
  innings_break: "Innings break",
  setup: "Not started",
  completed: "Result",
  abandoned: "Abandoned",
};

function MatchRow({ match }: { match: MatchListItem }) {
  const shareUrl = `${window.location.origin}/s/${match.public_slug}`;

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: match.title ?? "Live scorecard", url: shareUrl });
        return;
      } catch {
        // The user dismissed the sheet; fall through to the clipboard.
      }
    }
    toast(
      (await copyToClipboard(shareUrl)) ? "Scorecard link copied." : "Could not copy the link.",
      "success",
    );
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[match.status]}>{STATUS_LABEL[match.status]}</Badge>
          <span className="font-sans text-[0.65rem] tracking-[0.12em] text-willow uppercase">
            {MATCH_FORMAT_LABELS[match.match_format]}
          </span>
        </div>
        <Link
          to={`/app/matches/${match.id}`}
          className="mt-1 block font-sans text-base text-chalk hover:text-flip"
        >
          {match.title ??
            `${match.team_a_name ?? "Team A"} vs ${match.team_b_name ?? "Team B"}`}
        </Link>
        <p className="font-sans text-xs text-willow">
          {match.score_line ? (
            <span className="tabular text-willow-soft">{match.score_line}</span>
          ) : (
            formatDateTime(match.scheduled_at ?? match.started_at)
          )}
          {match.result_summary && ` · ${match.result_summary}`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={share} aria-label="Copy scorecard link">
          <Copy aria-hidden="true" className="size-3.5" />
          Link
        </Button>
        <Link to={`/app/matches/${match.id}`}>
          <Button size="sm" variant={match.status === "completed" ? "secondary" : "primary"}>
            {match.status === "completed" ? "Scorecard" : "Score"}
          </Button>
        </Link>
      </div>
    </li>
  );
}

export default function Dashboard() {
  const { data, isPending, error } = useQuery({
    queryKey: ["matches"],
    queryFn: () => matches.list({ limit: 50 }),
  });

  const live = data?.filter((m) => m.status === "live" || m.status === "innings_break") ?? [];
  const upcoming = data?.filter((m) => m.status === "setup") ?? [];
  const finished =
    data?.filter((m) => m.status === "completed" || m.status === "abandoned") ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Matches</h1>
          <p className="mt-1 text-sm text-willow-soft">
            Everything you score or have been invited to score.
          </p>
        </div>
        <Link to="/app/matches/new">
          <Button size="lg">
            <Plus aria-hidden="true" className="size-4" />
            New match
          </Button>
        </Link>
      </div>

      {isPending && <Spinner label="Loading your matches" />}

      {error && (
        <Panel className="p-4">
          <p className="font-sans text-sm text-boundary-soft">
            Could not load your matches. Check your connection and try again.
          </p>
        </Panel>
      )}

      {data && data.length === 0 && (
        <Panel>
          <EmptyState
            title="No matches yet"
            description="Set up the sides, pick a format, and start scoring. It takes about a minute, and you can add players as they turn up."
            action={
              <Link to="/app/matches/new">
                <Button>Create your first match</Button>
              </Link>
            }
          />
        </Panel>
      )}

      {[
        { title: "In progress", rows: live },
        { title: "Not started", rows: upcoming },
        { title: "Finished", rows: finished },
      ]
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.title}>
            <SectionTitle>{group.title}</SectionTitle>
            <Panel className="mt-2 divide-y divide-pitch-line">
              <ul>
                {group.rows.map((match) => (
                  <MatchRow key={match.id} match={match} />
                ))}
              </ul>
            </Panel>
          </section>
        ))}

      {data && data.length > 0 && (
        <>
          <Seam />
          <div className="flex items-center gap-3 text-willow">
            <StumpsMark className="size-5" />
            <p className="font-sans text-xs">
              Scorecard links stay live after the match, so a result is still there next season.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
