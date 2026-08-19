/**
 * Shareable match-result graphic + PNG download (no PDF).
 */

import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Panel, Seam } from "@/components/ui/Surface";
import type { MatchAwards, MatchSnapshot } from "@/lib/api/types";
import { cn, initials } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

export function MatchResultShare({
  snapshot,
  awards,
}: {
  snapshot: MatchSnapshot;
  awards: MatchAwards;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const match = snapshot.match;
  const teamA = match.teams.a;
  const teamB = match.teams.b;

  const downloadPng = async () => {
    const node = cardRef.current;
    if (!node) return;
    setBusy(true);
    try {
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#0a1f14",
      });
      const link = document.createElement("a");
      const safe = (match.title || "match-result").replace(/[^\w\-]+/g, "-").slice(0, 60);
      link.download = `${safe}-result.png`;
      link.href = dataUrl;
      link.click();
      toast("Result image downloaded.", "success");
    } catch (err) {
      toastError(err, "Could not create the image. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <p className="font-sans text-[10px] tracking-[0.16em] text-flip uppercase">
            Match result card
          </p>
          <p className="font-sans text-xs text-willow">PNG image — share on WhatsApp / Facebook</p>
        </div>
        <Button size="sm" onClick={() => void downloadPng()} loading={busy}>
          Download PNG
        </Button>
      </div>
      <Seam />
      <div className="overflow-x-auto p-4">
        <div
          ref={cardRef}
          className={cn(
            "mx-auto w-full max-w-md overflow-hidden rounded-[6px]",
            "bg-[linear-gradient(165deg,#0d2a1a_0%,#0a1f14_45%,#122a1c_100%)]",
            "text-chalk shadow-tile",
          )}
        >
          <div className="border-b border-flip/30 px-5 py-4">
            <p className="font-sans text-[10px] tracking-[0.2em] text-flip uppercase">ODCC LIVE</p>
            <h2 className="mt-1 font-sans text-lg font-bold leading-tight text-chalk">
              {match.title}
            </h2>
            {(match.venue || match.tournament?.name) && (
              <p className="mt-1 font-sans text-[11px] text-willow">
                {[match.venue, match.tournament?.name].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-5 py-5">
            <TeamBlock name={teamA.name} short={teamA.short_name} logo={teamA.logo_url} />
            <span className="font-sans text-xs font-bold text-flip">VS</span>
            <TeamBlock name={teamB.name} short={teamB.short_name} logo={teamB.logo_url} align="right" />
          </div>

          <div className="mx-5 mb-4 rounded-[4px] bg-ink/50 px-4 py-3 text-center">
            <p className="font-sans text-base font-semibold text-chalk">
              {awards.result_summary || snapshot.result?.summary || "Match complete"}
            </p>
          </div>

          <div className="space-y-2 px-5 pb-4">
            {(awards.innings ?? []).map((inn) => (
              <div
                key={inn.sequence}
                className="flex items-center justify-between rounded-[3px] border border-willow/20 bg-pitch/40 px-3 py-2"
              >
                <span className="truncate font-sans text-xs text-willow">{inn.batting_team}</span>
                <span className="font-mono text-sm font-bold tabular text-chalk">
                  {inn.score}{" "}
                  <span className="text-[11px] font-normal text-willow">({inn.overs_text})</span>
                </span>
              </div>
            ))}
            {(awards.innings?.length ?? 0) === 0 &&
              snapshot.innings.map((inn) => (
                <div
                  key={inn.id}
                  className="flex items-center justify-between rounded-[3px] border border-willow/20 bg-pitch/40 px-3 py-2"
                >
                  <span className="truncate font-sans text-xs text-willow">
                    {inn.batting_team_name}
                  </span>
                  <span className="font-mono text-sm font-bold tabular text-chalk">
                    {inn.state.total_runs}/{inn.state.wickets}{" "}
                    <span className="text-[11px] font-normal text-willow">
                      ({inn.state.overs_text})
                    </span>
                  </span>
                </div>
              ))}
          </div>

          {awards.man_of_the_match && (
            <div className="mx-5 mb-5 flex items-center gap-3 rounded-[4px] border border-flip/40 bg-flip/10 px-3 py-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-flip/40 bg-ink font-sans text-xs text-chalk">
                {awards.man_of_the_match.photo_url ? (
                  <img
                    src={awards.man_of_the_match.photo_url}
                    alt=""
                    className="h-full w-full object-cover"
                    crossOrigin="anonymous"
                  />
                ) : (
                  initials(awards.man_of_the_match.name)
                )}
              </div>
              <div className="min-w-0">
                <p className="font-sans text-[10px] tracking-wide text-flip uppercase">
                  Man of the match
                </p>
                <p className="truncate font-sans text-sm font-bold text-chalk">
                  {awards.man_of_the_match.name}
                </p>
                {awards.man_of_the_match.stat && (
                  <p className="font-mono text-[11px] text-willow">{awards.man_of_the_match.stat}</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 border-t border-willow/20 px-5 py-4">
            <MiniAward label="Best bat" entry={awards.best_batter} />
            <MiniAward label="Best bowl" entry={awards.best_bowler} />
            <MiniAward label="Best field" entry={awards.best_fielder} />
          </div>

          <p className="pb-4 text-center font-sans text-[10px] text-willow/70">
            Scored live with ODCC LIVE
          </p>
        </div>
      </div>
    </Panel>
  );
}

function TeamBlock({
  name,
  short,
  logo,
  align = "left",
}: {
  name: string;
  short?: string | null;
  logo?: string | null;
  align?: "left" | "right";
}) {
  return (
    <div className={cn("flex flex-col items-center gap-1", align === "right" && "order-last")}>
      <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-willow/30 bg-ink font-mono text-[10px] font-bold text-chalk">
        {logo ? (
          <img src={logo} alt="" className="h-full w-full object-cover" crossOrigin="anonymous" />
        ) : (
          (short ?? name).slice(0, 3).toUpperCase()
        )}
      </div>
      <p className="max-w-[7rem] truncate text-center font-sans text-[11px] font-semibold text-chalk">
        {short ?? name}
      </p>
    </div>
  );
}

function MiniAward({
  label,
  entry,
}: {
  label: string;
  entry?: { name: string; stat?: string | null } | null;
}) {
  if (!entry) {
    return (
      <div className="rounded-[3px] bg-ink/30 px-2 py-2 text-center">
        <p className="font-sans text-[9px] text-willow uppercase">{label}</p>
        <p className="font-sans text-[10px] text-willow/50">—</p>
      </div>
    );
  }
  return (
    <div className="rounded-[3px] bg-ink/30 px-2 py-2 text-center">
      <p className="font-sans text-[9px] text-willow uppercase">{label}</p>
      <p className="truncate font-sans text-[11px] font-semibold text-chalk">{entry.name}</p>
      {entry.stat && <p className="truncate font-mono text-[9px] text-willow">{entry.stat}</p>}
    </div>
  );
}
