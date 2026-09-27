/**
 * Central overlay visibility, conflict and animation rules.
 * Camera, OBS and the WHIP compositor all read the same helpers so a squad
 * card never fights the score bar, and clean-camera really means camera only.
 */

import type { OverlayDirector, OverlayPanel, OverlaySponsor } from "@/lib/api/types";
import type { GraphicKind } from "@/lib/broadcast/eventKind";

export const PRESENTATION_PANELS: ReadonlySet<string> = new Set([
  "scorecard",
  "innings1",
  "innings2",
  "squad",
  "over",
  "worm",
  "runrate",
  "sponsor",
  "summary",
]);

export const DECK_PANELS: ReadonlyArray<Exclude<OverlayPanel, "live" | "hidden" | "clean">> = [
  "scorecard",
  "innings1",
  "innings2",
  "squad",
  "over",
  "worm",
  "runrate",
  "sponsor",
  "summary",
];

export function directorDeckPanel(panel: string | null | undefined): (typeof DECK_PANELS)[number] | null {
  if (panel && DECK_PANELS.includes(panel as (typeof DECK_PANELS)[number])) {
    return panel as (typeof DECK_PANELS)[number];
  }
  return null;
}

export function isCleanCamera(graphics?: OverlayDirector | null): boolean {
  return Boolean(graphics?.clean) || graphics?.panel === "clean";
}

export function isPresentationPanel(panel?: string | null): boolean {
  return Boolean(panel && PRESENTATION_PANELS.has(panel));
}

export function showScoreBar(graphics?: OverlayDirector | null): boolean {
  if (isCleanCamera(graphics)) return false;
  if (graphics?.scorebar_on === false) return false;
  if (isPresentationPanel(graphics?.panel)) return false;
  return true;
}

export function showTicker(graphics?: OverlayDirector | null): boolean {
  if (isCleanCamera(graphics)) return false;
  return Boolean(graphics?.ticker_on);
}

export function showLogo(graphics?: OverlayDirector | null): boolean {
  if (isCleanCamera(graphics)) return false;
  return graphics?.logo_on !== false;
}

export function showPlayerCard(graphics?: OverlayDirector | null): boolean {
  if (isCleanCamera(graphics)) return false;
  if (isPresentationPanel(graphics?.panel)) return false;
  return graphics?.player_card_on !== false;
}

export function showCornerSponsor(graphics?: OverlayDirector | null): boolean {
  if (isCleanCamera(graphics)) return false;
  if (!graphics?.sponsor_on) return false;
  if (graphics.panel === "sponsor") return false;
  if (graphics.sponsor_layout === "fullscreen" || graphics.sponsor_layout === "grid") return false;
  return activeSponsors(graphics).length > 0;
}

export function animationEnabled(
  graphics: OverlayDirector | null | undefined,
  kind: GraphicKind,
): boolean {
  if (!kind) return false;
  if (isCleanCamera(graphics)) return false;
  if (kind === "four") return graphics?.anim_four !== false;
  if (kind === "six") return graphics?.anim_six !== false;
  if (kind === "wicket") return graphics?.anim_wicket !== false;
  if (kind === "wide" || kind === "no_ball") return graphics?.anim_extras !== false;
  return true;
}

export function activeSponsors(graphics?: OverlayDirector | null): OverlaySponsor[] {
  const listed = (graphics?.sponsors ?? []).filter((item) => item.on !== false && item.url?.trim());
  if (listed.length > 0) {
    return listed.map((item) => ({
      id: item.id,
      url: item.url.trim(),
      on: true,
    }));
  }
  const legacy = graphics?.sponsor_logo_url?.trim();
  if (legacy) return [{ id: "legacy", url: legacy, on: true }];
  return [];
}

export const CLOSE_ALL_PATCH: Partial<OverlayDirector> = {
  panel: "clean",
  clean: true,
  scorebar_on: false,
  logo_on: false,
  sponsor_on: false,
  ticker_on: false,
  player_card_on: false,
};

export const RESTORE_DEFAULT_PATCH: Partial<OverlayDirector> = {
  panel: "hidden",
  clean: false,
  scorebar_on: true,
  logo_on: true,
  player_card_on: true,
  anim_four: true,
  anim_six: true,
  anim_wicket: true,
  anim_extras: true,
};

export function logoPositionClass(pos?: OverlayDirector["logo_pos"]): string {
  switch (pos) {
    case "top-right":
      return "absolute top-3 right-3 z-40";
    case "bottom-left":
      return "absolute bottom-16 left-3 z-40";
    case "bottom-right":
      return "absolute bottom-16 right-3 z-40";
    default:
      return "absolute top-3 left-3 z-40";
  }
}

export function sponsorPositionClass(pos?: OverlayDirector["sponsor_pos"]): string {
  switch (pos) {
    case "top-left":
      return "absolute top-3 left-3 z-40";
    case "bottom":
      return "absolute bottom-16 right-3 z-40";
    case "center":
      return "absolute top-1/3 right-3 z-40";
    default:
      return "absolute top-3 right-3 z-40";
  }
}

export function deckPositionClass(panel: string, pos?: OverlayDirector["deck_pos"]): string {
  const squad = panel === "squad";
  if (pos === "center") {
    return cnDeck(
      "absolute inset-x-3 top-1/2 z-30 mx-auto -translate-y-1/2",
      squad ? "max-h-[72%] max-w-5xl" : "max-h-[58%] max-w-2xl",
    );
  }
  if (pos === "bottom") {
    return cnDeck(
      "absolute inset-x-3 bottom-14 z-30 mx-auto",
      squad ? "max-h-[62%] max-w-5xl" : "max-h-[48%] max-w-2xl",
    );
  }
  return cnDeck(
    "absolute inset-x-3 z-30 mx-auto",
    squad ? "top-6 max-h-[70%] max-w-5xl" : "top-10 max-h-[56%] max-w-2xl",
  );
}

function cnDeck(...parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}
