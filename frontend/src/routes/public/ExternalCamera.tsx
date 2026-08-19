/**
 * Public external-camera page: claim → getUserMedia → WHIP publish → go-live.
 * Always shows a status panel (never a blank white screen).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";

import { EventGraphics } from "@/components/broadcast/EventGraphics";
import {
  LiveInfoOverlays,
  LiveInfoPanelToggles,
  useLiveInfoPanels,
} from "@/components/broadcast/LiveInfoPanels";
import {
  OVERLAY_DESIGNS,
  type OverlayDesignId,
} from "@/components/broadcast/overlayThemes";
import { Button } from "@/components/ui/Button";
import { EmptyState, Spinner } from "@/components/ui/Surface";
import { publicApi } from "@/lib/api/endpoints";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { createWhipPublisher, type WhipStatus } from "@/lib/whipPublish";
import { ScoreBar } from "@/routes/public/Overlay";
import { toast, toastError } from "@/store/toast";

type UiPhase =
  | "idle"
  | "connecting"
  | "permission_required"
  | "camera_unavailable"
  | "preview"
  | "live"
  | "connection_lost";

const DESIGN_KEY_PREFIX = "odcc.camera.overlayDesign.";

function designStorageKey(slug: string | undefined) {
  return `${DESIGN_KEY_PREFIX}${slug || "default"}`;
}

function classifyMediaError(err: unknown): UiPhase {
  const name = err instanceof DOMException ? err.name : "";
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    msg.includes("permission") ||
    msg.includes("denied")
  ) {
    return "permission_required";
  }
  return "camera_unavailable";
}

function statusLabel(phase: UiPhase, whipStatus: WhipStatus, detail: string | null): string {
  if (phase === "connecting" || whipStatus === "connecting") return "Connecting…";
  if (phase === "permission_required") return "Permission required";
  if (phase === "camera_unavailable") return "Unable to access camera";
  if (phase === "connection_lost" || whipStatus === "reconnecting" || whipStatus === "failed") {
    return detail || "Connection lost";
  }
  if (phase === "live" && whipStatus === "connected") return "Live";
  if (phase === "live") return "Live (publishing…)";
  if (phase === "preview") return "Preview — ready to go live";
  return "Ready";
}

export default function ExternalCamera() {
  const { slug, token } = useParams<{ slug: string; token: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const whipRef = useRef(createWhipPublisher());
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [hasStream, setHasStream] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [whipStatus, setWhipStatus] = useState<WhipStatus>("idle");
  const [whipDetail, setWhipDetail] = useState<string | null>(null);
  const { active: infoPanels, onToggle: toggleInfo } = useLiveInfoPanels();
  const [overlayDesign, setOverlayDesign] = useState<OverlayDesignId>("circle");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(designStorageKey(slug));
      const found = OVERLAY_DESIGNS.find((d) => d.id === saved);
      if (found) setOverlayDesign(found.id);
    } catch {
      /* ignore */
    }
  }, [slug]);

  useEffect(() => {
    try {
      localStorage.setItem(designStorageKey(slug), overlayDesign);
    } catch {
      /* ignore */
    }
  }, [overlayDesign, slug]);

  useEffect(() => {
    return whipRef.current.onStatus((status, detail) => {
      setWhipStatus(status);
      setWhipDetail(detail ?? null);
      if (status === "failed" || status === "reconnecting") {
        setPhase((prev) => (prev === "live" || prev === "connection_lost" ? "connection_lost" : prev));
      }
      if (status === "connected") {
        setPhase((prev) => (prev === "connection_lost" || prev === "connecting" ? "live" : prev));
        setError(null);
      }
    });
  }, []);

  const invite = useQuery({
    queryKey: ["camera-invite", slug, token],
    queryFn: () => publicApi.camera(slug!, token!),
    enabled: Boolean(slug && token),
    refetchInterval: 8_000,
  });

  const scorecard = useQuery({
    queryKey: ["public-match", slug],
    queryFn: () => publicApi.match(slug!),
    enabled: Boolean(slug),
    staleTime: 10_000,
  });

  const { state } = useMatchStream(slug, {
    pollMs: 2_000,
    onResync: () => void scorecard.refetch(),
  });

  useEffect(() => {
    const liveVersion = state?.state_version ?? 0;
    const version = scorecard.data?.match.state_version ?? 0;
    if (liveVersion > version) void scorecard.refetch();
  }, [state?.state_version, scorecard]);

  const stopCamera = useCallback(async () => {
    await whipRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setHasStream(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const openMedia = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    streamRef.current = stream;
    setHasStream(true);
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
    }
    return stream;
  }, [facing]);

  const startCamera = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    await stopCamera();
    try {
      if (slug && token) await publicApi.cameraClaim(slug, token);
      await openMedia();
      setPhase("preview");
      toast("Camera ready. Tap Go live to publish.", "success");
    } catch (err) {
      const next = classifyMediaError(err);
      setPhase(next);
      setError(err instanceof Error ? err.message : "Camera denied.");
      toastError(err, next === "permission_required" ? "Camera permission required." : "Unable to access camera.");
    }
  }, [openMedia, slug, token, stopCamera]);

  const publishAndGoLive = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    try {
      let stream = streamRef.current;
      if (!stream) {
        if (slug && token) await publicApi.cameraClaim(slug, token);
        stream = await openMedia();
      }

      const whipUrl = invite.data?.whip_publish_url;
      if (!whipUrl) {
        setPhase("connection_lost");
        setError(
          "No WHIP publish URL. Set MEDIAMTX_WHIP_BASE_URL to a public HTTPS MediaMTX endpoint reachable from phones.",
        );
        toast("Streaming server not configured.", "error");
        return;
      }

      await whipRef.current.start(stream, whipUrl);
      await publicApi.cameraGoLive(slug!, token!);
      setPhase("live");
      toast("You are live.", "success");
      void invite.refetch();
    } catch (err) {
      if (err instanceof DOMException || (err instanceof Error && /permission|denied|NotAllowed|NotFound|NotReadable/i.test(err.message))) {
        const next = classifyMediaError(err);
        setPhase(next);
        setError(err.message);
        toastError(err, "Could not open the camera.");
        return;
      }
      await whipRef.current.stop().catch(() => undefined);
      setPhase("connection_lost");
      setError(err instanceof Error ? err.message : "Could not go live.");
      toastError(err, "Could not go live.");
    }
  }, [invite, openMedia, slug, token]);

  const flipCamera = useCallback(async () => {
    const nextFacing = facing === "user" ? "environment" : "user";
    setFacing(nextFacing);
    setError(null);
    const wasLive = phase === "live" || phase === "connection_lost";
    try {
      setPhase("connecting");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: { ideal: nextFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      setHasStream(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      if (wasLive && invite.data?.whip_publish_url) {
        await whipRef.current.restart(stream, invite.data.whip_publish_url);
        setPhase("live");
      } else {
        setPhase("preview");
      }
    } catch (err) {
      const next = classifyMediaError(err);
      setPhase(next);
      setError(err instanceof Error ? err.message : "Camera denied.");
    }
  }, [facing, invite.data?.whip_publish_url, phase]);

  const retry = useCallback(() => {
    void publishAndGoLive();
  }, [publishAndGoLive]);

  useEffect(() => () => {
    void stopCamera();
  }, [stopCamera]);

  const endLive = useMutation({
    mutationFn: async () => {
      await whipRef.current.stop();
      return publicApi.cameraEnd(slug!, token!);
    },
    onSuccess: () => {
      setPhase(hasStream ? "preview" : "idle");
      toast("Live ended.", "info");
      void invite.refetch();
    },
    onError: (err) => toastError(err, "Could not end live."),
  });

  if (invite.isLoading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-ink px-4">
        <Spinner label="Opening camera link" />
        <p className="font-sans text-sm text-willow">Connecting…</p>
      </div>
    );
  }

  if (!invite.data) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center bg-ink px-4 py-16">
        <EmptyState
          title="Camera link unavailable"
          description="The invite may have expired or the host ended the session."
        />
      </div>
    );
  }

  const banner = statusLabel(phase, whipStatus, whipDetail ?? error);
  const showRetry =
    phase === "connection_lost" ||
    phase === "permission_required" ||
    phase === "camera_unavailable" ||
    whipStatus === "failed";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-3 bg-ink px-3 py-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-sans text-[10px] tracking-wide text-willow uppercase">
            External camera
          </p>
          <h1 className="font-sans text-base font-semibold text-chalk">{invite.data.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {phase === "idle" && (
            <Button onClick={() => void startCamera()}>Start camera</Button>
          )}
          {(phase === "preview" || phase === "live" || phase === "connection_lost") && (
            <Button variant="secondary" size="sm" onClick={() => void flipCamera()}>
              {facing === "environment" ? "Front" : "Back"}
            </Button>
          )}
          {phase === "preview" && (
            <Button size="sm" onClick={() => void publishAndGoLive()}>
              Go live
            </Button>
          )}
          {(phase === "live" || (phase === "connection_lost" && hasStream)) && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => endLive.mutate()}
              loading={endLive.isPending}
            >
              End live
            </Button>
          )}
          {showRetry && (
            <Button size="sm" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      </header>

      <div
        className={
          phase === "live" && whipStatus === "connected"
            ? "rounded-[3px] border border-boundary/50 bg-boundary/20 px-3 py-2 font-sans text-sm text-chalk"
            : phase === "connection_lost" || phase === "permission_required" || phase === "camera_unavailable"
              ? "rounded-[3px] border border-boundary/40 bg-boundary/10 px-3 py-2 font-sans text-sm text-boundary"
              : "rounded-[3px] border border-willow/30 bg-pitch/40 px-3 py-2 font-sans text-sm text-willow"
        }
        role="status"
      >
        <span className="font-semibold text-chalk">{banner}</span>
        {error && phase !== "live" && (
          <span className="mt-1 block text-xs text-willow">{error}</span>
        )}
        {!invite.data.whip_publish_url && (
          <span className="mt-1 block text-xs text-willow">
            WHIP URL missing — host must set public HTTPS MEDIAMTX_WHIP_BASE_URL.
          </span>
        )}
      </div>

      <div className="relative aspect-[9/16] max-h-[70dvh] overflow-hidden rounded-[4px] border border-willow/30 bg-black sm:aspect-video sm:max-h-none">
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {(phase === "idle" ||
          phase === "permission_required" ||
          phase === "camera_unavailable" ||
          phase === "connecting") &&
          !hasStream && (
            <div className="absolute inset-0 grid place-items-center bg-ink/90 px-4 text-center">
              <div>
                <p className="font-sans text-sm font-semibold text-chalk">{banner}</p>
                <p className="mt-1 font-sans text-xs text-willow">
                  {phase === "permission_required"
                    ? "Allow camera and microphone, then tap Retry."
                    : phase === "camera_unavailable"
                      ? "Check another app is not using the camera, then Retry."
                      : phase === "connecting"
                        ? "Starting camera and stream…"
                        : "Tap Start camera to begin."}
                </p>
              </div>
            </div>
          )}
        {phase === "live" && whipStatus === "connected" && (
          <span className="absolute top-3 left-3 z-20 rounded-[2px] bg-boundary px-2 py-0.5 font-sans text-[10px] font-bold text-chalk uppercase">
            Live
          </span>
        )}
        {phase === "connection_lost" && (
          <span className="absolute top-3 left-3 z-20 rounded-[2px] bg-boundary/80 px-2 py-0.5 font-sans text-[10px] font-bold text-chalk uppercase">
            Reconnecting
          </span>
        )}
        {state?.tournament?.name && (
          <div className="pointer-events-none absolute top-3 right-3 z-20 flex max-w-[50%] items-center gap-1.5 rounded-[3px] border border-white/20 bg-ink/70 px-1.5 py-1 text-chalk">
            {state.tournament.logo_url ? (
              <img
                src={state.tournament.logo_url}
                alt=""
                className="h-6 w-6 rounded-[2px] object-cover"
              />
            ) : null}
            <span className="truncate font-sans text-[9px] font-bold uppercase">
              {state.tournament.name}
            </span>
          </div>
        )}
        <LiveInfoOverlays active={infoPanels} state={state} snapshot={scorecard.data ?? null} />
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-2">
          {state?.score ? (
            <ScoreBar state={state} design={overlayDesign} className="max-w-full" />
          ) : null}
        </div>
        <EventGraphics state={state} />
      </div>

      <div>
        <p className="mb-1 font-sans text-xs text-willow">Live info panels</p>
        <LiveInfoPanelToggles active={infoPanels} onToggle={toggleInfo} />
      </div>

      <div>
        <p className="mb-1 font-sans text-xs text-willow">Live overlay design</p>
        <div className="grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
          {OVERLAY_DESIGNS.map((design) => (
            <button
              key={design.id}
              type="button"
              onClick={() => setOverlayDesign(design.id)}
              className={
                overlayDesign === design.id
                  ? "rounded-[3px] border-2 border-boundary px-2 py-1.5 text-left"
                  : "rounded-[3px] border border-willow/30 px-2 py-1.5 text-left"
              }
            >
              <span className="block font-sans text-[11px] font-semibold text-chalk">
                {design.label}
              </span>
              <span className="block font-sans text-[9px] text-willow">{design.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="font-sans text-xs text-willow">
        Score updates live from the scorer. Session: {invite.data.status}
        {invite.data.whip_publish_url ? " · WHIP ready" : " · WHIP not configured"}
      </p>
    </div>
  );
}
