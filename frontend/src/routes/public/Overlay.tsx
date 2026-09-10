/**
 * TV-style OBS browser-source overlay with selectable international designs.
 *
 * Query: position, scale, design=classic|circle|split|arena|emerald|chase|modern|
 *        premium|dark|clean|tournament|minimal, charts=1, awards=1, card=0
 */

import { useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import { EventGraphics } from "@/components/broadcast/EventGraphics";
import { OverlayBrandChip, OverlaySponsorChip } from "@/components/broadcast/OverlayChips";
import { LiveTicker } from "@/components/broadcast/LiveTicker";
import { LiveInfoDeck, type LiveDeckPanelId } from "@/components/broadcast/LiveInfoDeck";
import { MatchAwardsPanel } from "@/components/broadcast/MatchAwardsPanel";
import { RunsPerOverCharts } from "@/components/broadcast/RunsPerOverCharts";
import { TvScoreOverlay } from "@/components/broadcast/TvScoreBars";
import { parseOverlayDesign, type OverlayDesignId } from "@/components/broadcast/overlayThemes";
import { publicApi } from "@/lib/api/endpoints";
import type { CompactState } from "@/lib/api/types";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { cn } from "@/lib/utils";

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const { state } = useMatchStream(slug, { pollMs: 2_000 });

  const position = params.get("position") === "top" ? "top" : "bottom";
  const scale = Number(params.get("scale") ?? "1") || 1;
  const graphics = state?.graphics;
  const directorPanel = graphics?.panel ?? "hidden";
  const design = parseOverlayDesign(graphics?.design ?? params.get("design") ?? params.get("style"));
  const showCharts = params.get("charts") === "1";
  const showAwards = params.get("awards") === "1" || state?.status === "completed";
  const showCard = params.get("card") !== "0";
  const showDeck =
    directorPanel === "scorecard" ||
    directorPanel === "innings1" ||
    directorPanel === "innings2" ||
    directorPanel === "squad" ||
    directorPanel === "over" ||
    directorPanel === "sponsor";
  const tickerOn = Boolean(graphics?.ticker_on);
  const tickerFallback = state?.tournament?.name || state?.title || "ODCC LIVE";

  const awardsQuery = useQuery({
    queryKey: ["overlay-awards", slug],
    queryFn: () => publicApi.awards(slug!),
    enabled: Boolean(slug) && (showAwards || showCharts),
    staleTime: 15_000,
  });

  const scorecard = useQuery({
    queryKey: ["overlay-scorecard", slug],
    queryFn: () => publicApi.match(slug!),
    enabled: Boolean(slug) && showDeck,
    staleTime: 8_000,
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

  if (!state?.score && !showAwards && !showDeck && !tickerOn) return null;

  return (
    <>
      <OverlayBrandChip state={state} className="fixed top-3 left-3 z-40" />
      <OverlaySponsorChip state={state} className="fixed top-3 right-3 z-40" />
      <LiveTicker
        text={graphics?.ticker}
        fallback={tickerFallback}
        enabled={tickerOn}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0"
      />
      {/* Full-viewport layer so EventGraphics absolute safe-zone anchors to the frame */}
      <div className="pointer-events-none fixed inset-0 z-50">
        <EventGraphics state={state} />
      </div>
      {showDeck && (
        <div className="pointer-events-none fixed inset-x-2 top-12 z-30 mx-auto max-h-[40vh] max-w-xl">
          <LiveInfoDeck
            state={state}
            snapshot={scorecard.data ?? null}
            variant="overlay"
            activePanel={directorPanel as LiveDeckPanelId}
            className="h-full"
          />
        </div>
      )}
      <div
        className={cn(
          "fixed inset-x-0 flex flex-col items-center gap-2 px-2 sm:px-3",
          position === "top" ? "top-3 sm:top-4" : tickerOn ? "bottom-10 sm:bottom-11" : "bottom-3 sm:bottom-4",
          "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
        )}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: position === "top" ? "top" : "bottom",
        }}
      >
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
    </>
  );
}

/** Back-compat wrapper used by studio / external camera. */
export function ScoreBar({
  state,
  design = "circle",
  styleMode,
  className,
  showPlayerCard = true,
  dense = false,
}: {
  state: CompactState;
  design?: OverlayDesignId;
  /** @deprecated use design */
  styleMode?: "broadcast" | "minimal";
  theme?: "dark" | "light";
  showBalls?: boolean;
  className?: string;
  showPlayerCard?: boolean;
  dense?: boolean;
}) {
  const resolved =
    styleMode === "minimal" ? "minimal" : design ?? parseOverlayDesign(styleMode ?? "circle");
  return (
    <TvScoreOverlay
      state={state}
      design={resolved}
      showPlayerCard={showPlayerCard}
      className={className}
      dense={dense}
    />
  );
}
