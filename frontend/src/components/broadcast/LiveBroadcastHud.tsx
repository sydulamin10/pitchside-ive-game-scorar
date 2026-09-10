/**
 * The graphics that must appear on the published live picture: selected score
 * design, corner name/logo, sponsor, director panels, ticker, ball graphics.
 *
 * Camera preview and the off-screen 1280×720 capture both render this so the
 * Facebook / YouTube frame matches what the scorer put on air.
 */

import type { ReactNode, Ref } from "react";

import { EventGraphics } from "@/components/broadcast/EventGraphics";
import { LiveInfoDeck, type LiveDeckPanelId } from "@/components/broadcast/LiveInfoDeck";
import { LiveTicker } from "@/components/broadcast/LiveTicker";
import { OverlayBrandChip, OverlaySponsorChip } from "@/components/broadcast/OverlayChips";
import { TvScoreOverlay } from "@/components/broadcast/TvScoreBars";
import type { OverlayDesignId } from "@/components/broadcast/overlayThemes";
import type { CompactState, MatchSnapshot } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const DECK_PANELS: LiveDeckPanelId[] = [
  "scorecard",
  "innings1",
  "innings2",
  "squad",
  "over",
  "sponsor",
];

export function directorDeckPanel(panel: string | null | undefined): LiveDeckPanelId | null {
  if (panel && DECK_PANELS.includes(panel as LiveDeckPanelId)) return panel as LiveDeckPanelId;
  return null;
}

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
  const graphics = state?.graphics;
  const deck = directorDeckPanel(graphics?.panel);
  const tickerOn = Boolean(graphics?.ticker_on);

  return (
    <div
      data-testid="live-broadcast-hud"
      className={cn("relative h-full w-full overflow-hidden", className)}
    >
      <OverlayBrandChip state={state} className="absolute top-3 left-3 z-40" />
      <OverlaySponsorChip state={state} className="absolute top-3 right-3 z-40" />
      {deck ? (
        <div className="absolute inset-x-8 top-14 z-30 mx-auto max-h-[42%] max-w-xl">
          <LiveInfoDeck
            state={state}
            snapshot={snapshot ?? null}
            variant="overlay"
            activePanel={deck}
            className="h-full"
          />
        </div>
      ) : null}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex flex-col items-center justify-end px-3 pb-3 pt-10",
          "bg-gradient-to-t from-black/55 via-black/12 to-transparent",
        )}
      >
        {state?.score ? (
          <TvScoreOverlay state={state} design={design} showPlayerCard className="max-w-full" />
        ) : null}
        <LiveTicker
          text={graphics?.ticker}
          fallback={tickerFallback ?? ""}
          enabled={tickerOn}
          className="mt-1.5 w-full rounded-[3px]"
        />
      </div>
      <div className="pointer-events-none absolute inset-0 z-50">
        <EventGraphics state={state} />
      </div>
    </div>
  );
}
