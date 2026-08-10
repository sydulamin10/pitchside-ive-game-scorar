/** Named international-TV overlay designs for live camera / OBS. */

export const OVERLAY_DESIGNS = [
  {
    id: "classic",
    label: "Classic Silver",
    blurb: "Light bar · score · this over dots",
  },
  {
    id: "circle",
    label: "Circle Crest",
    blurb: "Batters · center score · bowler · round logos",
  },
  {
    id: "split",
    label: "Split Flag",
    blurb: "Green/blue panels · this-over pills · flags/logos",
  },
  {
    id: "arena",
    label: "Arena Pro",
    blurb: "Angled panels · bold score block · over rings",
  },
  {
    id: "emerald",
    label: "Emerald Live",
    blurb: "Slanted bar · CRR · optional batter card",
  },
  {
    id: "chase",
    label: "Chase Bar",
    blurb: "Need runs strip · striker arrow · dual logos",
  },
  {
    id: "minimal",
    label: "Minimal",
    blurb: "Compact score only (portrait-friendly)",
  },
] as const;

export type OverlayDesignId = (typeof OVERLAY_DESIGNS)[number]["id"];

export function parseOverlayDesign(raw: string | null | undefined): OverlayDesignId {
  const id = (raw ?? "circle").toLowerCase();
  if (OVERLAY_DESIGNS.some((d) => d.id === id)) return id as OverlayDesignId;
  if (id === "broadcast") return "circle";
  return "circle";
}
