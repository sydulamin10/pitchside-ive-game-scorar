/**
 * What Facebook / YouTube actually see: a canvas overlay driven by the
 * director feed (score design, corner logo, sponsor, panels, ball graphics).
 *
 * Images load with CORS (`crossOrigin=anonymous`) and are probed before draw.
 * A tainted canvas makes Chrome drop the WHIP video track, so Facebook never
 * goes live. Failed logos fall back to letters; the camera still publishes.
 */

import { chaseCaption } from "@/lib/broadcast/chase";
import {
  GRAPHIC_DIGITS,
  GRAPHIC_WORDS,
  graphicHoldMs,
  type GraphicKind,
} from "@/lib/broadcast/eventKind";
import { overlayBrandLogo, overlayBrandMode, overlayBrandName } from "@/lib/broadcast/overlayBrand";
import {
  activeSponsors,
  isCleanCamera,
  isPresentationPanel,
  showCornerSponsor,
  showLogo,
  showScoreBar,
  showTicker,
} from "@/lib/broadcast/overlayRules";
import { parseOverlayDesign, type OverlayDesignId } from "@/components/broadcast/overlayThemes";
import { withEffectivePanel } from "@/lib/broadcast/matchEndSummary";
import type { CompactState, MatchSnapshot } from "@/lib/api/types";
import { matchChartSeries } from "@/lib/broadcast/matchCharts";

export interface OverlayPaintFrame {
  state: CompactState | null;
  snapshot?: MatchSnapshot | null;
  tickerFallback?: string | null;
}

export interface DesignPalette {
  id: OverlayDesignId;
  bar: string;
  barEnd: string;
  scoreBg: string;
  scoreFg: string;
  text: string;
  muted: string;
  accent: string;
  light: boolean;
}

const PALETTES: Record<OverlayDesignId, Omit<DesignPalette, "id">> = {
  classic: {
    bar: "#cfd6dd",
    barEnd: "#9aa3ad",
    scoreBg: "#1b1f24",
    scoreFg: "#f4f1e8",
    text: "#1b1f24",
    muted: "rgba(27,31,36,0.7)",
    accent: "#d4a017",
    light: true,
  },
  circle: {
    bar: "#0d3d2e",
    barEnd: "#145c42",
    scoreBg: "#f4f1e8",
    scoreFg: "#0b1210",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.75)",
    accent: "#f3d36a",
    light: false,
  },
  split: {
    bar: "#1a7a3c",
    barEnd: "#1a4a8a",
    scoreBg: "#0b1e4a",
    scoreFg: "#f4f1e8",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.8)",
    accent: "#f3d36a",
    light: false,
  },
  arena: {
    bar: "#111318",
    barEnd: "#2a1a0a",
    scoreBg: "#f3d36a",
    scoreFg: "#111318",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.75)",
    accent: "#f3d36a",
    light: false,
  },
  emerald: {
    bar: "#0a4d3c",
    barEnd: "#06352a",
    scoreBg: "#0b1210",
    scoreFg: "#7dffb3",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.75)",
    accent: "#7dffb3",
    light: false,
  },
  chase: {
    bar: "#0b1e4a",
    barEnd: "#071430",
    scoreBg: "#f3d36a",
    scoreFg: "#0b1e4a",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.8)",
    accent: "#f3d36a",
    light: false,
  },
  modern: {
    bar: "#1a2744",
    barEnd: "#121b30",
    scoreBg: "#f4f1e8",
    scoreFg: "#1a2744",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.75)",
    accent: "#8cb4ff",
    light: false,
  },
  premium: {
    bar: "#0b1210",
    barEnd: "#1a1408",
    scoreBg: "#d4a017",
    scoreFg: "#0b1210",
    text: "#f4f1e8",
    muted: "rgba(243,211,106,0.85)",
    accent: "#f3d36a",
    light: false,
  },
  dark: {
    bar: "#05070a",
    barEnd: "#0d1118",
    scoreBg: "#111318",
    scoreFg: "#7dffb3",
    text: "#e8fff4",
    muted: "rgba(125,255,179,0.7)",
    accent: "#7dffb3",
    light: false,
  },
  clean: {
    bar: "#f7f7f5",
    barEnd: "#e7e7e2",
    scoreBg: "#0e3d2c",
    scoreFg: "#f4f1e8",
    text: "#1b1f24",
    muted: "rgba(27,31,36,0.65)",
    accent: "#0e3d2c",
    light: true,
  },
  tournament: {
    bar: "#0e3d2c",
    barEnd: "#123a66",
    scoreBg: "#f0b429",
    scoreFg: "#0b1210",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.8)",
    accent: "#f0b429",
    light: false,
  },
  minimal: {
    bar: "#0b1210",
    barEnd: "#0b1210",
    scoreBg: "#0b1210",
    scoreFg: "#f3d36a",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.7)",
    accent: "#f3d36a",
    light: false,
  },
  icc: {
    bar: "#071018",
    barEnd: "#123a66",
    scoreBg: "#123a66",
    scoreFg: "#f4f1e8",
    text: "#f4f1e8",
    muted: "rgba(244,241,232,0.75)",
    accent: "#f3d36a",
    light: false,
  },
  stat: {
    bar: "#2a1050",
    barEnd: "#4a1a7a",
    scoreBg: "#1a0a33",
    scoreFg: "#f4f1e8",
    text: "#f4f1e8",
    muted: "rgba(196,181,253,0.85)",
    accent: "#c4b5fd",
    light: false,
  },
};

export function designPalette(raw: string | null | undefined): DesignPalette {
  const id = parseOverlayDesign(raw);
  return { id, ...PALETTES[id] };
}

const SITE_BRAND = "/branding/odcc-live.png";

type ImageCacheEntry = CanvasImageSource | "failed" | "loading";
const imageCache = new Map<string, ImageCacheEntry>();

function apiOrigin(): string {
  if (typeof window !== "undefined" && "__PITCHSIDE_API_BASE_URL__" in window) {
    return String(window.__PITCHSIDE_API_BASE_URL__ ?? "")
      .trim()
      .replace(/\/+$/, "");
  }
  return "";
}

function absoluteUrl(src: string): string {
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  if (typeof window === "undefined") return src;
  if (src.startsWith("/")) return `${window.location.origin}${src}`;
  return src;
}

function overlayAssetUrl(src: string): string | null {
  const origin = apiOrigin();
  if (!origin) return null;
  return `${origin}/api/v1/public/overlay-asset?src=${encodeURIComponent(src)}`;
}

function startOverlayImageLoad(src: string) {
  imageCache.set(src, "loading");
  const abs = absoluteUrl(src);
  const candidates = [abs];
  const proxied = overlayAssetUrl(abs);
  if (proxied) candidates.push(proxied);
  void (async () => {
    for (const url of candidates) {
      try {
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size < 24) continue;
        if (typeof createImageBitmap !== "function") continue;
        const bmp = await createImageBitmap(blob);
        if (bmp.width > 0 && bmp.height > 0) {
          imageCache.set(src, bmp);
          return;
        }
      } catch {
        /* try the next candidate */
      }
    }
    imageCache.set(src, "failed");
  })();
}

/**
 * Logo bitmap for the publish canvas. Fetches via CORS / overlay-asset so the
 * WHIP canvas never taints (that dropped Facebook video).
 */
export function overlayImage(url: string | null | undefined): CanvasImageSource | null {
  const src = url?.trim();
  if (!src) return null;
  const hit = imageCache.get(src);
  if (hit === "failed" || hit === "loading") return null;
  if (hit) return hit;
  if (typeof fetch === "undefined") return null;
  startOverlayImageLoad(src);
  return null;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function sourceSize(img: CanvasImageSource): { w: number; h: number } | null {
  if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
    return img.width && img.height ? { w: img.width, h: img.height } : null;
  }
  if (typeof HTMLImageElement !== "undefined" && img instanceof HTMLImageElement) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return w && h ? { w, h } : null;
  }
  return null;
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
) {
  const size = sourceSize(img);
  if (!size) return;
  const scale = Math.min(boxW / size.w, boxH / size.h);
  const dw = size.w * scale;
  const dh = size.h * scale;
  try {
    ctx.drawImage(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
  } catch {
    /* incomplete */
  }
}

function drawLogoBadge(
  ctx: CanvasRenderingContext2D,
  url: string | null | undefined,
  fallback: string,
  x: number,
  y: number,
  size: number,
) {
  const img = overlayImage(url);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y, size, size);
  if (img) {
    drawContained(ctx, img, x, y, size, size);
  } else {
    ctx.fillStyle = "#f4f1e8";
    ctx.font = `800 ${Math.max(10, size * 0.32)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fallback.slice(0, 3).toUpperCase(), x + size / 2, y + size / 2 + 1);
  }
  ctx.restore();
}

function drawBrand(ctx: CanvasRenderingContext2D, state: CompactState) {
  if (!showLogo(state.graphics)) return;
  const mode = overlayBrandMode(state);
  if (mode === "none") return;
  const pos = state.graphics?.logo_pos ?? "top-left";
  const box = 112;
  const inset = 16;
  const x = pos === "top-right" || pos === "bottom-right" ? ctx.canvas.width - box - inset : inset;
  const y = pos === "bottom-left" || pos === "bottom-right" ? ctx.canvas.height - box - 48 : inset;
  if (mode === "logo") {
    const custom = overlayBrandLogo(state);
    const img = overlayImage(custom) || overlayImage(SITE_BRAND);
    if (!img) {
      const name = overlayBrandName(state);
      if (!name) return;
      ctx.font = "700 22px sans-serif";
      const w = Math.min(420, 36 + ctx.measureText(name.toUpperCase()).width);
      ctx.fillStyle = "rgba(8, 14, 12, 0.82)";
      roundRect(ctx, x, y, w, 52, 6);
      ctx.fill();
      ctx.fillStyle = "#f4f1e8";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(name.toUpperCase(), x + 12, y + 34);
      return;
    }
    ctx.fillStyle = "rgba(8, 14, 12, 0.82)";
    roundRect(ctx, x, y, box, box, 8);
    ctx.fill();
    drawContained(ctx, img, x + 8, y + 8, box - 16, box - 16);
    return;
  }
  const name = overlayBrandName(state);
  if (!name) return;
  ctx.font = "700 22px sans-serif";
  const w = Math.min(420, 36 + ctx.measureText(name.toUpperCase()).width);
  ctx.fillStyle = "rgba(8, 14, 12, 0.82)";
  roundRect(ctx, x, y, w, 52, 6);
  ctx.fill();
  ctx.fillStyle = "#f4f1e8";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(name.toUpperCase(), x + 12, y + 34);
}

function drawSponsorCorner(ctx: CanvasRenderingContext2D, state: CompactState, width: number) {
  if (!showCornerSponsor(state.graphics)) return;
  const urls = activeSponsors(state.graphics);
  const url = urls[0]?.url;
  const img = overlayImage(url);
  if (!img) return;
  const boxW = 220;
  const boxH = 88;
  const pos = state.graphics?.sponsor_pos ?? "top-right";
  const x =
    pos === "top-left" ? 16 : pos === "center" ? (width - boxW) / 2 : width - boxW - 16;
  const y = pos === "bottom" ? ctx.canvas.height - boxH - 48 : 16;
  ctx.fillStyle = "rgba(8, 14, 12, 0.82)";
  roundRect(ctx, x, y, boxW, boxH, 6);
  ctx.fill();
  drawContained(ctx, img, x + 8, y + 8, boxW - 16, boxH - 16);
}

function drawInfoCard(
  ctx: CanvasRenderingContext2D,
  frame: OverlayPaintFrame,
  width: number,
  height: number,
) {
  const panel = frame.state?.graphics?.panel;
  if (!panel || panel === "hidden" || panel === "live" || panel === "clean") return;
  const scorecardish = panel === "scorecard" || panel === "innings1" || panel === "innings2" || panel === "summary";
  const squad = panel === "squad";
  const sponsor = panel === "sponsor";
  const layout = frame.state?.graphics?.sponsor_layout;
  const fullSponsor = sponsor && (layout === "fullscreen" || layout === "grid");
  const chartish = panel === "worm" || panel === "runrate";
  const w = squad
    ? Math.min(width - 28, 980)
    : chartish
      ? Math.min(width - 36, 900)
    : fullSponsor
      ? Math.min(width - 48, 820)
      : scorecardish
        ? Math.min(560, width * 0.58)
        : Math.min(360, width * 0.36);
  const h = squad
    ? Math.min(height * 0.68, 460)
    : chartish
      ? Math.min(height * 0.52, 340)
    : fullSponsor
      ? Math.min(height * 0.72, 520)
      : scorecardish
        ? Math.min(400, height * 0.5)
        : sponsor
          ? 240
          : 250;
  const x = squad || scorecardish || fullSponsor || chartish ? (width - w) / 2 : width - w - 16;
  const y = squad || chartish ? 28 : 48;
  ctx.fillStyle = "rgba(8, 14, 12, 0.9)";
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(125, 255, 179, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = "#7dffb3";
  ctx.font = "700 11px sans-serif";
  ctx.textAlign = "left";
  const titles: Record<string, string> = {
    scorecard: "SCORECARD",
    over: "OVER ANALYSIS",
    worm: "WORM",
    runrate: "RUN RATE",
    innings1: "1ST INNINGS",
    innings2: "2ND INNINGS",
    squad: "SQUADS",
    sponsor: "SPONSOR",
    summary: "MATCH SUMMARY",
  };
  ctx.fillText(titles[panel] ?? panel.toUpperCase(), x + 16, y + 22);

  if (panel === "sponsor") {
    const urls = activeSponsors(frame.state?.graphics).map((item) => item.url);
    if (urls.length === 0) return;
    if (urls.length === 1 && layout !== "grid") {
      const img = overlayImage(urls[0]);
      if (img) drawContained(ctx, img, x + 24, y + 40, w - 48, h - 60);
      return;
    }
    const cols = Math.min(3, urls.length);
    const rows = Math.ceil(urls.length / cols);
    const cellW = (w - 32) / cols;
    const cellH = (h - 48) / rows;
    urls.forEach((url, i) => {
      const img = overlayImage(url);
      if (!img) return;
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawContained(ctx, img, x + 16 + col * cellW, y + 32 + row * cellH, cellW - 8, cellH - 8);
    });
    return;
  }

  const innings =
    panel === "innings1"
      ? frame.snapshot?.innings.find((i) => i.sequence === 1)
      : panel === "innings2"
        ? frame.snapshot?.innings.find((i) => i.sequence === 2)
        : (frame.snapshot?.innings.find((i) => i.id === frame.snapshot?.current_innings_id) ??
          frame.snapshot?.innings.at(-1));

  ctx.fillStyle = "#f4f1e8";
  ctx.font = "600 13px sans-serif";
  let lineY = y + 44;

  if (panel === "over") {
    const overs = innings?.state.overs ?? [];
    overs.slice(-10).forEach((over) => {
      ctx.fillText(
        `Ov ${over.over_number}  ${over.bowler_name}  ${over.runs}${over.wickets ? `/${over.wickets}` : ""}`,
        x + 16,
        lineY,
      );
      lineY += 18;
    });
    return;
  }

  if (panel === "worm" || panel === "runrate") {
    drawMatchChart(ctx, frame, x, y, w, h, panel);
    return;
  }

  if (panel === "squad") {
    const teams = frame.snapshot?.match?.teams;
    const list = teams ? [teams.a, teams.b] : [];
    const colW = (w - 28) / Math.max(list.length, 1);
    list.forEach((team, ti) => {
      const colX = x + 14 + ti * colW;
      let lineY = y + 42;
      ctx.fillStyle = "#7dffb3";
      ctx.font = "700 13px sans-serif";
      ctx.fillText(team.name.slice(0, 22), colX, lineY);
      lineY += 18;
      const members = (frame.snapshot?.squads?.[team.id] ?? [])
        .filter((m) => m.is_playing)
        .slice(0, 11);
      members.forEach((m) => {
        const photo = overlayImage(m.photo_url);
        if (photo) drawContained(ctx, photo, colX, lineY - 11, 16, 16);
        else {
          ctx.fillStyle = "rgba(125,255,179,0.2)";
          roundRect(ctx, colX, lineY - 11, 16, 16, 3);
          ctx.fill();
        }
        ctx.fillStyle = "#f4f1e8";
        ctx.font = "600 12px sans-serif";
        const jersey = m.jersey_number != null ? `#${m.jersey_number} ` : "";
        ctx.fillText(`${jersey}${m.name}`.slice(0, 22), colX + 22, lineY);
        lineY += 16;
      });
    });
    return;
  }

  if (panel === "summary") {
    const inns = frame.snapshot?.innings ?? [];
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 16px sans-serif";
    ctx.fillText(frame.state?.result_summary || frame.snapshot?.result?.summary || "Innings", x + 16, y + 48);
    inns.slice(0, 2).forEach((inn, i) => {
      ctx.font = "600 14px sans-serif";
      ctx.fillStyle = "#c5d0c8";
      ctx.fillText(
        `${inn.batting_team_name}  ${inn.state.total_runs}/${inn.state.wickets}  (${inn.state.overs_text})`,
        x + 16,
        y + 78 + i * 24,
      );
    });
    return;
  }

  if (!innings) return;
  const st = innings.state;
  const batName = frame.state?.batting_team?.name ?? frame.state?.batting_team?.short_name ?? "";
  const bowlName = frame.state?.bowling_team?.short_name ?? "";
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, x + 12, y + 30, w - 24, 52, 4);
  ctx.fill();
  ctx.fillStyle = "#9aa8a0";
  ctx.font = "700 10px sans-serif";
  ctx.fillText(
    bowlName ? `${batName}  v  ${bowlName}` : batName,
    x + 20,
    y + 46,
  );
  ctx.fillStyle = "#f4f1e8";
  ctx.font = "900 26px sans-serif";
  ctx.fillText(`${st.total_runs}/${st.wickets}`, x + 20, y + 72);
  ctx.font = "700 12px sans-serif";
  ctx.fillStyle = "#c5d0c8";
  ctx.fillText(
    `${st.overs_text} ov   CRR ${st.run_rate.toFixed(2)}`,
    x + 150,
    y + 70,
  );

  const colR = x + w - 150;
  const colB = x + w - 118;
  const col4 = x + w - 86;
  const col6 = x + w - 54;
  const colSr = x + w - 22;
  lineY = y + 102;
  ctx.fillStyle = "#8a9a92";
  ctx.font = "700 10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Batter", x + 16, lineY);
  ctx.textAlign = "right";
  ctx.fillText("R", colR, lineY);
  ctx.fillText("B", colB, lineY);
  ctx.fillText("4s", col4, lineY);
  ctx.fillText("6s", col6, lineY);
  ctx.fillText("SR", colSr, lineY);
  lineY += 6;
  const batting = (st.batting ?? []).filter(
    (b) => b.has_batted || b.is_out || b.is_striker || b.is_non_striker,
  );
  batting.slice(0, 8).forEach((b) => {
    lineY += 18;
    ctx.textAlign = "left";
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "600 12px sans-serif";
    const star = b.is_striker ? " *" : b.is_non_striker ? " †" : "";
    ctx.fillText(`${b.name}${star}`.slice(0, 22), x + 16, lineY);
    ctx.fillStyle = "#9aa8a0";
    ctx.font = "500 9px sans-serif";
    const how = b.is_out ? (b.dismissal_text ?? "out") : b.is_striker || b.is_non_striker ? "batting" : "not out";
    ctx.fillText(how.slice(0, 28), x + 16, lineY + 11);
    ctx.textAlign = "right";
    ctx.fillStyle = "#f4f1e8";
    ctx.font = "700 12px sans-serif";
    ctx.fillText(String(b.runs), colR, lineY);
    ctx.font = "600 12px sans-serif";
    ctx.fillStyle = "#c5d0c8";
    ctx.fillText(String(b.balls_faced), colB, lineY);
    ctx.fillText(String(b.fours), col4, lineY);
    ctx.fillText(String(b.sixes), col6, lineY);
    ctx.fillText(b.strike_rate.toFixed(0), colSr, lineY);
    lineY += 8;
  });
  lineY += 16;
  ctx.textAlign = "left";
  ctx.fillStyle = "#9aa8a0";
  ctx.font = "600 11px sans-serif";
  const extras = st.extras;
  if (extras) {
    ctx.fillText(`Extras  (b ${extras.bye}, lb ${extras.leg_bye}, w ${extras.wide}, nb ${extras.no_ball})`, x + 16, lineY);
    ctx.textAlign = "right";
    ctx.fillStyle = "#f4f1e8";
    ctx.fillText(String(extras.total), colSr, lineY);
  }
  lineY += 18;
  ctx.textAlign = "left";
  const bowlers = (st.bowling ?? []).filter((b) => b.balls_bowled > 0 || b.is_current_bowler).slice(0, 4);
  if (bowlers.length) {
    ctx.fillStyle = "#8a9a92";
    ctx.font = "700 10px sans-serif";
    ctx.fillText("Bowler", x + 16, lineY);
    ctx.textAlign = "right";
    ctx.fillText("O", colB, lineY);
    ctx.fillText("R", col4, lineY);
    ctx.fillText("W", col6, lineY);
    ctx.fillText("Econ", colSr, lineY);
    bowlers.forEach((b) => {
      lineY += 16;
      ctx.textAlign = "left";
      ctx.fillStyle = "#f4f1e8";
      ctx.font = "600 12px sans-serif";
      ctx.fillText(`${b.name}${b.is_current_bowler ? " ▸" : ""}`.slice(0, 20), x + 16, lineY);
      ctx.textAlign = "right";
      ctx.fillStyle = "#c5d0c8";
      ctx.fillText(b.overs_text, colB, lineY);
      ctx.fillText(String(b.runs_conceded), col4, lineY);
      ctx.fillStyle = "#f4f1e8";
      ctx.font = "700 12px sans-serif";
      ctx.fillText(String(b.wickets), col6, lineY);
      ctx.font = "600 12px sans-serif";
      ctx.fillStyle = "#c5d0c8";
      ctx.fillText(b.economy.toFixed(1), colSr, lineY);
    });
  }
  ctx.textAlign = "left";
}

function drawMatchChart(
  ctx: CanvasRenderingContext2D,
  frame: OverlayPaintFrame,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: "worm" | "runrate",
) {
  const series = matchChartSeries(frame.snapshot);
  const padL = x + 44;
  const padT = y + 36;
  const padR = x + w - 16;
  const padB = y + h - 22;
  const innerW = Math.max(40, padR - padL);
  const innerH = Math.max(40, padB - padT);
  const maxOver = Math.max(10, ...series.flatMap((s) => s.points.map((p) => p.over)));
  const valueOf = (p: { cumulative: number; runRate: number }) =>
    kind === "worm" ? p.cumulative : p.runRate;
  const maxY = Math.max(1, ...series.flatMap((s) => s.points.map(valueOf)));
  const px = (over: number) => padL + (over / maxOver) * innerW;
  const py = (v: number) => padT + innerH - (v / maxY) * innerH;
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padB);
  ctx.lineTo(padR, padB);
  ctx.stroke();
  ctx.fillStyle = "#93a08e";
  ctx.font = "600 10px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Overs", padL, y + h - 8);
  series.forEach((s, si) => {
    ctx.fillStyle = s.color;
    ctx.fillText(s.label, padL + 50 + si * 120, y + 22);
    if (s.points.length === 0) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const xx = px(p.over);
      const yy = py(valueOf(p));
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    s.points.forEach((p) => {
      const xx = px(p.over);
      const yy = py(valueOf(p));
      if (kind === "worm" && p.wickets > 0) {
        ctx.fillStyle = "#e74c3c";
        ctx.beginPath();
        ctx.arc(xx, yy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(xx, yy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });
}

function drawScoreBar(
  ctx: CanvasRenderingContext2D,
  state: CompactState,
  width: number,
  height: number,
) {
  const score = state.score;
  if (!score) return;
  const palette = designPalette(state.graphics?.design);
  const pad = 16;
  const barH = palette.id === "minimal" ? 56 : 78;
  const y = height - barH - 18;
  const inner = width - pad * 2;
  const leftW = inner * 0.34;
  const midW = inner * 0.32;
  const rightW = inner - leftW - midW;
  const bat = state.batting_team?.short_name ?? "BAT";
  const bowl = state.bowling_team?.short_name ?? "BWL";
  const chase = chaseCaption(score, state.innings_sequence);

  ctx.fillStyle = palette.bar;
  roundRect(ctx, pad, y, leftW, barH, 5);
  ctx.fill();
  ctx.fillStyle = palette.scoreBg;
  ctx.fillRect(pad + leftW, y, midW, barH);
  ctx.fillStyle = palette.barEnd;
  roundRect(ctx, pad + leftW + midW - 6, y, rightW + 6, barH, 5);
  ctx.fill();
  ctx.fillStyle = palette.scoreBg;
  ctx.fillRect(pad + leftW, y, midW, barH);

  drawLogoBadge(ctx, state.batting_team?.logo_url, bat, pad + 10, y + (barH - 44) / 2, 44);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.text;
  ctx.font = "600 12px sans-serif";
  const textX = pad + 62;
  [state.striker, state.non_striker].forEach((batter, i) => {
    if (!batter) return;
    ctx.font = i === 0 ? "800 13px sans-serif" : "600 12px sans-serif";
    ctx.fillStyle = palette.text;
    const line = `${i === 0 ? "▸ " : ""}${batter.name}`;
    ctx.fillText(line.slice(0, 18), textX, y + 24 + i * 20);
    ctx.font = "700 12px sans-serif";
    ctx.fillText(`${batter.runs}(${batter.balls_faced})`, textX + 148, y + 24 + i * 20);
  });

  ctx.textAlign = "center";
  ctx.fillStyle = palette.scoreFg;
  ctx.font = "800 11px sans-serif";
  ctx.fillText(`${bat} vs ${bowl}`, pad + leftW + midW / 2, y + 16);
  ctx.font = "900 28px sans-serif";
  ctx.fillText(`${score.runs}-${score.wickets}`, pad + leftW + midW / 2, y + 44);
  ctx.font = "700 12px sans-serif";
  ctx.fillStyle = palette.accent;
  ctx.fillText(`${score.overs_text} OV`, pad + leftW + midW / 2, y + 64);
  if (chase) {
    ctx.fillStyle = palette.accent;
    ctx.font = "800 10px sans-serif";
    ctx.fillText(chase, pad + leftW + midW / 2, y + barH - 6);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = palette.text;
  if (state.bowler) {
    ctx.font = "700 13px sans-serif";
    ctx.fillText(state.bowler.name.slice(0, 16), pad + leftW + midW + 12, y + 26);
    ctx.font = "600 12px sans-serif";
    ctx.fillStyle = palette.muted;
    ctx.fillText(
      `${state.bowler.overs_text}-${state.bowler.runs_conceded}-${state.bowler.wickets}`,
      pad + leftW + midW + 12,
      y + 46,
    );
  }
  const balls = state.recent_balls?.slice(-6) ?? [];
  balls.forEach((ball, i) => {
    const bx = pad + leftW + midW + 12 + i * 22;
    const by = y + barH - 16;
    ctx.beginPath();
    ctx.arc(bx + 7, by, 7, 0, Math.PI * 2);
    const hot = ball.is_wicket || (ball.batter_runs ?? 0) >= 4;
    ctx.fillStyle = hot ? palette.accent : "rgba(255,255,255,0.2)";
    ctx.fill();
    ctx.fillStyle = hot && !palette.light ? "#0b1210" : palette.light ? "#0b1210" : "#f4f1e8";
    ctx.font = "700 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(ball.is_wicket ? "W" : ball.display === "." ? "•" : ball.display, bx + 7, by + 3);
  });
  drawLogoBadge(
    ctx,
    state.bowling_team?.logo_url,
    bowl,
    pad + inner - 54,
    y + (barH - 44) / 2,
    44,
  );
  ctx.textAlign = "left";
}

function drawTicker(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  width: number,
  now: number,
) {
  const h = 26;
  ctx.fillStyle = "rgba(8, 14, 12, 0.9)";
  ctx.fillRect(0, y, width, h);
  ctx.font = "700 14px sans-serif";
  ctx.fillStyle = "#f3d36a";
  const line = `${text}   ·   ${text}   ·   `;
  const loopW = Math.max(ctx.measureText(line).width, 1);
  const shift = (now / 40) % loopW;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, y, width, h);
  ctx.clip();
  ctx.fillText(line + line, 12 - shift, y + 18);
  ctx.restore();
}

const LIVE_GRAPHICS = new Set<Exclude<GraphicKind, null>>([
  "four",
  "six",
  "wicket",
  "no_ball",
  "wide",
]);

function graphicFade(t: number): number {
  if (t < 0.12) return t / 0.12;
  if (t > 0.78) return Math.max(0, (1 - t) / 0.22);
  return 1;
}

function drawGraphic(
  ctx: CanvasRenderingContext2D,
  kind: Exclude<GraphicKind, null>,
  startedAt: number,
  now: number,
  width: number,
  height: number,
) {
  if (!LIVE_GRAPHICS.has(kind)) return;
  const hold = graphicHoldMs(kind, false);
  const t = Math.min(1, (now - startedAt) / hold);
  const fade = graphicFade(t);
  const digit = GRAPHIC_DIGITS[kind];
  const word = GRAPHIC_WORDS[kind];
  const cx = width / 2;
  const cy = height * 0.36;

  ctx.save();
  ctx.globalAlpha = 0.72 * fade;
  const wash =
    kind === "wicket"
      ? "rgba(176, 18, 28, 0.92)"
      : kind === "six"
        ? "rgba(212, 160, 23, 0.72)"
        : kind === "four"
          ? "rgba(18, 92, 52, 0.7)"
          : "rgba(244, 241, 232, 0.55)";
  const grd = ctx.createLinearGradient(0, 0, 0, height * 0.58);
  grd.addColorStop(0, wash);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, width, height * 0.62);
  ctx.restore();

  if (kind === "wide" || kind === "no_ball") {
    const ribbonW = Math.min(640, width * 0.62);
    const ribbonH = 78;
    const rx = (width - ribbonW) / 2;
    const ry = height * 0.3;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = kind === "wide" ? "#f4f1e8" : "#7dffb3";
    roundRect(ctx, rx, ry, ribbonW, ribbonH, 8);
    ctx.fill();
    ctx.fillStyle = "#0b1210";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 42px sans-serif";
    ctx.fillText(word, cx, ry + ribbonH / 2 + 1);
    ctx.restore();
    return;
  }

  let x = cx;
  if (kind === "four") {
    if (t < 0.18) x = cx - width * 0.7 * (1 - t / 0.18);
    else if (t > 0.62) x = cx + width * 0.7 * ((t - 0.62) / 0.38);
  }
  let scale = 1;
  if (kind === "six") {
    scale = t < 0.2 ? 0.55 + t * 2.25 : t > 0.72 ? 1 + (t - 0.72) * 1.4 : 1;
  }
  if (kind === "wicket") {
    scale = t < 0.14 ? 1.35 - t * 2.4 : 1;
  }

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(x, cy);
  ctx.scale(scale, scale);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(11, 18, 16, 0.55)";
  ctx.lineWidth = 10;
  ctx.fillStyle = kind === "wicket" ? "#ff5a4a" : "#f3d36a";
  if (digit) {
    ctx.font = "900 148px sans-serif";
    ctx.strokeText(digit, 0, 0);
    ctx.fillText(digit, 0, 0);
  }
  ctx.font = "900 44px sans-serif";
  ctx.lineWidth = 6;
  ctx.strokeText(word, 0, digit ? 52 : 0);
  ctx.fillText(word, 0, digit ? 52 : 0);
  ctx.restore();
}

export function paintLiveOverlay(
  ctx: CanvasRenderingContext2D,
  frame: OverlayPaintFrame,
  width: number,
  height: number,
  now: number,
  started: number,
  graphicKind: GraphicKind,
  graphicAt: number,
) {
  const state = frame.state;
  if (!state) {
    const label = frame.tickerFallback?.trim();
    if (!label) return;
    ctx.fillStyle = "rgba(8, 14, 12, 0.88)";
    roundRect(ctx, 16, height - 64, width - 32, 48, 5);
    ctx.fill();
    ctx.fillStyle = "#f3d36a";
    ctx.font = "800 22px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, 32, height - 32);
    return;
  }

  const graphics = withEffectivePanel(state.graphics, state, now) ?? undefined;
  const painted = { ...state, graphics };
  if (isCleanCamera(graphics)) return;

  if (showLogo(graphics)) drawBrand(ctx, painted);
  drawSponsorCorner(ctx, painted, width);
  if (isPresentationPanel(graphics?.panel) || graphics?.panel === "sponsor") {
    drawInfoCard(ctx, { ...frame, state: painted }, width, height);
  }
  if (painted.score && showScoreBar(graphics)) drawScoreBar(ctx, painted, width, height);
  const tickerText = graphics?.ticker?.trim() || frame.tickerFallback?.trim();
  if (showTicker(graphics) && tickerText) {
    drawTicker(ctx, tickerText, height - 26, width, now - started);
  }
  if (graphicKind) drawGraphic(ctx, graphicKind, graphicAt, now, width, height);
}
