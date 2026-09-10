/**
 * Burn director graphics onto the camera and publish that canvas over WHIP.
 * Drawing lives in overlayPaint.ts so Facebook always gets score, logos and
 * the selected design — not a blank HTML snapshot.
 */

import { latestGraphic, graphicHoldMs, type GraphicKind } from "@/lib/broadcast/eventKind";
import { paintLiveOverlay } from "@/lib/broadcast/overlayPaint";
import type { CompactState, MatchSnapshot } from "@/lib/api/types";

export interface OverlayFrame {
  state: CompactState | null;
  snapshot?: MatchSnapshot | null;
  tickerFallback?: string | null;
}

export interface OverlayCompositor {
  stream: MediaStream;
  stop: () => void;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const vw = video.videoWidth || width;
  const vh = video.videoHeight || height;
  if (!vw || !vh) {
    ctx.fillStyle = "#0b1210";
    ctx.fillRect(0, 0, width, height);
    return;
  }
  const scale = Math.max(width / vw, height / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  try {
    ctx.drawImage(video, (width - dw) / 2, (height - dh) / 2, dw, dh);
  } catch {
    ctx.fillStyle = "#0b1210";
    ctx.fillRect(0, 0, width, height);
  }
}

export function scoreHeadline(state: CompactState): string {
  const bat = state.batting_team?.short_name ?? state.batting_team?.name ?? "BAT";
  if (!state.score) return bat;
  return `${bat}  ${state.score.runs}/${state.score.wickets}  (${state.score.overs_text})`;
}

export function startOverlayCompositor(opts: {
  video: HTMLVideoElement;
  audioFrom: MediaStream;
  getFrame: () => OverlayFrame;
  overlayEl?: HTMLElement | null | (() => HTMLElement | null);
  width?: number;
  height?: number;
  fps?: number;
}): OverlayCompositor {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;
  const fps = opts.fps ?? 30;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = `position:fixed;left:-${width + 48}px;top:0;width:${width}px;height:${height}px;pointer-events:none`;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) {
    canvas.remove();
    throw new Error("Could not open a broadcast canvas.");
  }

  let running = true;
  let raf = 0;
  let lastGraphicKey: string | null = null;
  let graphicKind: GraphicKind = null;
  let graphicAt = 0;
  let prevRuns: number | null = null;
  const started = performance.now();

  const paint = () => {
    if (!running || !ctx) return;
    const now = performance.now();
    try {
      drawCover(ctx, opts.video, width, height);
      const frame = opts.getFrame();
      const state = frame.state;
      if (state) {
        const last = state.recent_balls?.[state.recent_balls.length - 1];
        const key = last ? `${last.delivery_id}:${last.display}` : null;
        if (key && key !== lastGraphicKey) {
          lastGraphicKey = key;
          const next = latestGraphic(state, prevRuns);
          if (next) {
            graphicKind = next;
            graphicAt = now;
          }
          if (state.score) prevRuns = state.score.runs;
        }
        if (graphicKind && now - graphicAt > graphicHoldMs(graphicKind, false)) {
          graphicKind = null;
        }
      }
      paintLiveOverlay(ctx, frame, width, height, now, started, graphicKind, graphicAt);
    } catch {
      /* keep the camera frame; a failed graphic must not stop WHIP video */
    }
    raf = window.requestAnimationFrame(paint);
  };
  paint();

  const capture =
    typeof canvas.captureStream === "function" ? canvas.captureStream(fps) : null;
  const videoTrack = capture?.getVideoTracks()[0];
  if (!capture || !videoTrack || videoTrack.readyState === "ended") {
    running = false;
    window.cancelAnimationFrame(raf);
    canvas.remove();
    throw new Error("This browser cannot burn the score into the live video.");
  }
  try {
    videoTrack.contentHint = "motion";
  } catch {
    /* Safari */
  }

  for (const track of opts.audioFrom.getAudioTracks()) {
    capture.addTrack(track);
  }

  return {
    stream: capture,
    stop: () => {
      running = false;
      window.cancelAnimationFrame(raf);
      capture.getVideoTracks().forEach((t) => t.stop());
      canvas.remove();
    },
  };
}

/** Overlay on the camera when possible; raw camera if the canvas cannot publish. */
export function startLivePublishStream(opts: {
  video: HTMLVideoElement;
  cameraStream: MediaStream;
  getFrame: () => OverlayFrame;
  overlayEl?: HTMLElement | null | (() => HTMLElement | null);
  width?: number;
  height?: number;
  fps?: number;
}): OverlayCompositor {
  try {
    return startOverlayCompositor({
      video: opts.video,
      audioFrom: opts.cameraStream,
      getFrame: opts.getFrame,
      overlayEl: opts.overlayEl,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
    });
  } catch {
    return {
      stream: opts.cameraStream,
      stop: () => undefined,
    };
  }
}
