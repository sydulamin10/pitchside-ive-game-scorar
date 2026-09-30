/**
 * TV-style OBS browser-source overlay with selectable international designs.
 *
 * Query: position, scale, design=classic|circle|split|arena|emerald|chase|modern|
 *        premium|dark|clean|tournament|minimal|icc|stat, charts=1, awards=1, card=0
 */

import { useEffect, useMemo, useState } from "react";
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
import {
  deckPositionClass,
  directorDeckPanel,
  isCleanCamera,
  logoPositionClass,
  showLogo,
  showPlayerCard,
  showScoreBar,
  showTicker,
  sponsorPositionClass,
} from "@/lib/broadcast/overlayRules";
import {
  matchEndAwardsActive,
  matchEndSummaryActive,
  withEffectivePanel,
} from "@/lib/broadcast/matchEndSummary";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { cn } from "@/lib/utils";

export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const { state } = useMatchStream(slug, { pollMs: 2_000 });
  const [now, setNow] = useState(() => Date.now());
  const ticking =
    matchEndSummaryActive(state) ||
    matchEndAwardsActive(state) ||
    Boolean(state?.graphics?.summary_until);
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  const position = params.get("position") === "top" ? "top" : "bottom";
  const scale = Number(params.get("scale") ?? "1") || 1;
  const graphics = withEffectivePanel(state?.graphics, state, now);
  const directorPanel = graphics?.panel ?? "hidden";
  const design = parseOverlayDesign(graphics?.design ?? params.get("design") ?? params.get("style"));
  const showCharts = params.get("charts") === "1";
  const showAwards = params.get("awards") === "1" || matchEndAwardsActive(state, now);
  const showCard = params.get("card") !== "0" && showPlayerCard(graphics);
  const deck = directorDeckPanel(directorPanel);
  const showDeck = Boolean(deck) && !isCleanCamera(graphics);
  const tickerOn = showTicker(graphics);
  const tickerFallback = state?.tournament?.name || state?.title || "ODCC LIVE";
  const barOn = Boolean(state?.score) && showScoreBar(graphics) && !isCleanCamera(graphics);
  const clean = isCleanCamera(graphics);

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
      {!clean && showLogo(graphics) ? (
        <OverlayBrandChip state={state} className={cn("fixed z-40", logoPositionClass(graphics?.logo_pos).replace("absolute", "fixed"))} />
      ) : null}
      {!clean ? (
        <OverlaySponsorChip
          state={state}
          className={cn("fixed z-40", sponsorPositionClass(graphics?.sponsor_pos).replace("absolute", "fixed"))}
        />
      ) : null}
      {!clean ? (
        <LiveTicker
          text={graphics?.ticker}
          fallback={tickerFallback}
          enabled={tickerOn}
          className="pointer-events-none fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0"
        />
      ) : null}
      {/* Full-viewport layer so EventGraphics absolute safe-zone anchors to the frame */}
      <div className="pointer-events-none fixed inset-0 z-50">
        <EventGraphics state={state} />
      </div>
      {showDeck && deck ? (
        <div className={cn("pointer-events-none fixed z-30", deckPositionClass(deck, graphics?.deck_pos).replace("absolute", "fixed"))}>
          <LiveInfoDeck
            state={state}
            snapshot={scorecard.data ?? null}
            variant="overlay"
            activePanel={deck as LiveDeckPanelId}
            className="h-full"
          />
        </div>
      ) : null}
      {!clean ? (
      <div
        className={cn(
          "fixed inset-x-0 flex flex-col items-center gap-2 px-2 sm:px-3 hud-layer",
          graphics?.scorebar_pos === "top" || position === "top"
            ? "top-3 sm:top-4"
            : tickerOn
              ? "bottom-10 sm:bottom-11"
              : "bottom-3 sm:bottom-4",
          "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
        )}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: graphics?.scorebar_pos === "top" || position === "top" ? "top" : "bottom",
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
        {barOn && state?.score ? (
          <TvScoreOverlay state={state} design={design} showPlayerCard={showCard} />
        ) : null}
      </div>
      ) : null}
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
