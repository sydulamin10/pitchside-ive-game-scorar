/**
 * The graphics that must appear on the published live picture: selected score
 * design, corner name/logo, sponsor, director panels, ticker, ball graphics.
 *
 * Camera preview and the off-screen 1280×720 capture both render this so the
 * Facebook / YouTube frame matches what the scorer put on air.
 */

import { useEffect, useState, type ReactNode, type Ref } from "react";

import { EventGraphics } from "@/components/broadcast/EventGraphics";
import { LiveInfoDeck, type LiveDeckPanelId } from "@/components/broadcast/LiveInfoDeck";
import { LiveTicker } from "@/components/broadcast/LiveTicker";
import { OverlayBrandChip, OverlaySponsorChip } from "@/components/broadcast/OverlayChips";
import { TvScoreOverlay } from "@/components/broadcast/TvScoreBars";
import type { OverlayDesignId } from "@/components/broadcast/overlayThemes";
import type { CompactState, MatchSnapshot } from "@/lib/api/types";
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
import { matchEndSummaryActive, withEffectivePanel } from "@/lib/broadcast/matchEndSummary";
import { cn } from "@/lib/utils";

export { directorDeckPanel } from "@/lib/broadcast/overlayRules";

export function captureFrameSize(landscape: boolean): { width: number; height: number } {
  return landscape ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
}

/** Off-screen 1280×720 (or 720×1280) HUD used to stamp graphics onto the WHIP canvas. */
export function BroadcastCaptureFrame({
  landscape,
  hudRef,
  children,
}: {
  landscape: boolean;
  hudRef: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const size = captureFrameSize(landscape);
  return (
    <div
      ref={hudRef}
      aria-hidden
      className="pointer-events-none fixed top-0 z-[-1] overflow-hidden bg-transparent"
      style={{ width: size.width, height: size.height, left: -2400 }}
    >
      {children}
    </div>
  );
}

export function LiveBroadcastHud({
  state,
  snapshot,
  design,
  tickerFallback,
  className,
}: {
  state: CompactState | null;
  snapshot?: MatchSnapshot | null;
  design: OverlayDesignId;
  tickerFallback?: string | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = matchEndSummaryActive(state) || Boolean(state?.graphics?.summary_until);
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);
  const graphics = withEffectivePanel(state?.graphics, state, now);
  const deck = directorDeckPanel(graphics?.panel);
  const tickerOn = showTicker(graphics);
  const barOn = Boolean(state?.score) && showScoreBar(graphics);
  const clean = isCleanCamera(graphics);

  return (
    <div
      data-testid="live-broadcast-hud"
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      {!clean && showLogo(graphics) ? (
        <OverlayBrandChip state={state} className={logoPositionClass(graphics?.logo_pos)} />
      ) : null}
      {!clean ? (
        <OverlaySponsorChip state={state} className={sponsorPositionClass(graphics?.sponsor_pos)} />
      ) : null}
      {deck && !clean ? (
        <div className={cn("hud-layer", deckPositionClass(deck, graphics?.deck_pos))}>
          <LiveInfoDeck
            state={state}
            snapshot={snapshot ?? null}
            variant="overlay"
            activePanel={deck}
            className="h-full"
          />
        </div>
      ) : null}
      {!clean ? (
        <div
          className={cn(
            "absolute inset-x-0 z-20 flex flex-col items-center justify-end px-3 pb-3 pt-10 hud-layer",
            graphics?.scorebar_pos === "top" ? "top-0 bg-gradient-to-b from-black/55 via-black/12 to-transparent" : "bottom-0 bg-gradient-to-t from-black/55 via-black/12 to-transparent",
            !barOn && "pt-3",
          )}
        >
          {barOn ? (
            <TvScoreOverlay
              state={state!}
              design={design}
              showPlayerCard={showPlayerCard(graphics)}
              className="max-w-full"
            />
          ) : null}
          <LiveTicker
            text={graphics?.ticker}
            fallback={tickerFallback ?? ""}
            enabled={tickerOn}
            className="mt-1.5 w-full rounded-[3px]"
          />
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 z-50">
        <EventGraphics state={state} />
      </div>
    </div>
  );
}

export type { LiveDeckPanelId };
