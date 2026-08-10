/**
 * Post-match summary: MOTM, best bat/bowl/field, MVP ratings list.
 */

import type { MatchAwards } from "@/lib/api/types";
import { Panel, Seam, SectionTitle } from "@/components/ui/Surface";
import { RunsPerOverCharts } from "@/components/broadcast/RunsPerOverCharts";
import { initials } from "@/lib/utils";

export function MatchAwardsPanel({ awards }: { awards: MatchAwards }) {
  return (
    <div className="flex flex-col gap-4">
      <Panel className="overflow-hidden border-flip/40 bg-pitch-deep">
        <div className="px-4 py-3">
          <p className="font-sans text-[10px] tracking-[0.16em] text-flip uppercase">
            Match summary
          </p>
          {awards.result_summary && (
            <p className="mt-1 font-sans text-lg font-semibold text-chalk">
              {awards.result_summary}
            </p>
          )}
        </div>
        <Seam />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <AwardCard title="Man of the match" entry={awards.man_of_the_match} highlight />
          <AwardCard title="Best batter" entry={awards.best_batter} />
          <AwardCard title="Best bowler" entry={awards.best_bowler} />
          <AwardCard title="Best fielder" entry={awards.best_fielder} />
        </div>
      </Panel>

      <Panel>
        <SectionTitle>MVP ratings</SectionTitle>
        <Seam className="my-3" />
        <ul className="divide-y divide-willow/15">
          {(awards.mvp_ratings ?? []).map((row, index) => (
            <li key={row.player_id} className="flex items-center gap-3 py-2 font-sans text-sm">
              <span className="w-6 font-mono text-xs text-willow">{index + 1}</span>
              <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-willow/30 bg-ink text-xs text-chalk">
                {row.photo_url ? (
                  <img src={row.photo_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials(row.name)
                )}
              </div>
              <span className="min-w-0 flex-1 truncate text-chalk">{row.name}</span>
              <span className="font-mono text-flip tabular">{row.rating.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {(awards.innings?.length ?? 0) > 0 && (
        <Panel>
          <SectionTitle>Runs per over</SectionTitle>
          <Seam className="my-3" />
          <RunsPerOverCharts
            series={(awards.innings ?? []).map((inn, i) => ({
              label: inn.batting_team,
              color: i === 0 ? "var(--color-flip)" : "var(--color-willow)",
              overs: inn.overs ?? [],
            }))}
          />
        </Panel>
      )}
    </div>
  );
}

function AwardCard({
  title,
  entry,
  highlight,
}: {
  title: string;
  entry:
    | {
        name: string;
        photo_url?: string | null;
        stat?: string;
        rating?: number;
      }
    | null
    | undefined;
  highlight?: boolean;
}) {
  if (!entry) {
    return (
      <div className="rounded-[3px] border border-willow/20 p-3">
        <p className="font-sans text-[10px] tracking-wide text-willow uppercase">{title}</p>
        <p className="mt-2 text-sm text-willow">—</p>
      </div>
    );
  }
  return (
    <div
      className={
        highlight
          ? "rounded-[3px] border border-flip/50 bg-ink/40 p-3"
          : "rounded-[3px] border border-willow/20 p-3"
      }
    >
      <p className="font-sans text-[10px] tracking-wide text-willow uppercase">{title}</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-willow/40 bg-ink text-xs text-chalk">
          {entry.photo_url ? (
            <img src={entry.photo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(entry.name)
          )}
        </div>
        <div>
          <p className="font-sans text-sm font-semibold text-chalk">{entry.name}</p>
          <p className="font-mono text-xs text-flip">
            {entry.stat ?? (entry.rating != null ? `${entry.rating.toFixed(1)} MVP` : "")}
          </p>
        </div>
      </div>
    </div>
  );
}
