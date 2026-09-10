/**
 * Corner branding on the live overlay: name, logo, or nothing.
 * Works for tournament fixtures and one-off matches (custom name/logo).
 */

import type { CompactState, OverlayBrandMode } from "@/lib/api/types";

export function overlayBrandMode(state: CompactState | null | undefined): OverlayBrandMode {
  const g = state?.graphics;
  if (g?.brand_mode === "none" || g?.brand_mode === "name" || g?.brand_mode === "logo") {
    return g.brand_mode;
  }
  if (g?.show_tournament === false) return "none";
  return "name";
}

export function overlayBrandName(state: CompactState | null | undefined): string | null {
  const custom = state?.graphics?.brand_name?.trim();
  if (custom) return custom;
  const tournament = state?.tournament?.name?.trim();
  if (tournament) return tournament;
  const title = state?.title?.trim();
  return title || null;
}

export function overlayBrandLogo(state: CompactState | null | undefined): string | null {
  const custom = state?.graphics?.brand_logo_url?.trim();
  if (custom) return custom;
  const logo = state?.tournament?.logo_url?.trim();
  return logo || null;
}
