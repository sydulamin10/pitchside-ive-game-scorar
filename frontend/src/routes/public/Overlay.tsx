/**
 * TV-style OBS browser-source overlay with selectable international designs.
 *
 * Query: position, scale, design=classic|circle|split|arena|emerald|chase|minimal,
 *        charts=1, awards=1, card=0
 */

import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { EventGraphics } from "@/components/broadcast/EventGraphics";
import { MatchAwardsPanel } from "@/components/broadcast/MatchAwardsPanel";
import { RunsPerOverCharts } from "@/components/broadcast/RunsPerOverCharts";
import { TvScoreOverlay } from "@/components/broadcast/TvScoreBars";
import { parseOverlayDesign, type OverlayDesignId } from "@/components/broadcast/overlayThemes";
import { publicApi } from "@/lib/api/endpoints";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import type { CompactState } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const { state } = useMatchStream(slug, { pollMs: 2_000 });

  const position = params.get("position") === "top" ? "top" : "bottom";
  const scale = Number(params.get("scale") ?? "1") || 1;
  const design = parseOverlayDesign(params.get("design") ?? params.get("style"));
  const showCharts = params.get("charts") === "1";
  const showAwards = params.get("awards") === "1" || state?.status === "completed";
  const showCard = params.get("card") !== "0";

  const awardsQuery = useQuery({
    queryKey: ["overlay-awards", slug],
    queryFn: () => publicApi.awards(slug!),
    enabled: Boolean(slug) && (showAwards || showCharts),
    staleTime: 15_000,
  });

  useEffect(() => {
    const root = document.documentElement;
    const previous = { html: root.style.background, body: document.body.style.background };
    root.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      root.style.background = previous.html;
      document.body.style.background = previous.body;
    };
  }, []);

  const chartSeries = useMemo(() => {
    const inns = awardsQuery.data?.innings ?? [];
    return inns.map((inn, i) => ({
      label: inn.batting_team,
      color: i === 0 ? "var(--color-flip)" : "var(--color-willow)",
      overs: inn.overs ?? [],
    }));
  }, [awardsQuery.data]);

  if (!state?.score && !showAwards) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 flex flex-col items-center gap-2 px-3",
        position === "top" ? "top-4" : "bottom-4",
      )}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: position === "top" ? "top" : "bottom",
      }}
    >
      <EventGraphics state={state} />
      {showCharts && chartSeries.length > 0 && (
        <div className="w-full max-w-lg rounded-[4px] border border-willow/30 bg-ink/90 p-3">
          <RunsPerOverCharts series={chartSeries} />
        </div>
      )}
      {showAwards && awardsQuery.data && state?.status === "completed" && (
        <div className="max-h-[70vh] w-full max-w-2xl overflow-auto rounded-[4px] bg-ink/95 p-2">
          <MatchAwardsPanel awards={awardsQuery.data} />
        </div>
      )}
      {state?.score && (
        <TvScoreOverlay state={state} design={design} showPlayerCard={showCard} />
      )}
    </div>
  );
}

/** Back-compat wrapper used by studio / external camera. */
export function ScoreBar({
  state,
  design = "circle",
  styleMode,
  className,
  showPlayerCard = true,
}: {
  state: CompactState;
  design?: OverlayDesignId;
  /** @deprecated use design */
  styleMode?: "broadcast" | "minimal";
  theme?: "dark" | "light";
  showBalls?: boolean;
  className?: string;
  showPlayerCard?: boolean;
}) {
  const resolved =
    styleMode === "minimal" ? "minimal" : design ?? parseOverlayDesign(styleMode ?? "circle");
  return (
    <TvScoreOverlay
      state={state}
      design={resolved}
      showPlayerCard={showPlayerCard}
      className={className}
    />
  );
}
