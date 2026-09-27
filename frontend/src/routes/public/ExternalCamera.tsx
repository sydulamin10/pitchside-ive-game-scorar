/**
 * Public external-camera page: claim → getUserMedia → WHIP publish → go-live.
 * Always shows a status panel (never a blank white screen).
 *
 * Layout comes from how the page is actually held: one hand, outdoors, at a
 * ground. The frame gets the screen; everything that is not the frame or the
 * one action that matters right now lives in a drawer off the left edge, and
 * the scorecard rides over the video as a deck the operator can swipe.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";

import { OverlayDirectorPanel } from "@/components/broadcast/OverlayDirectorPanel";
import {
  LiveBroadcastHud,
  captureFrameSize,
  directorDeckPanel,
} from "@/components/broadcast/LiveBroadcastHud";
import {
  SocialStreamConnect,
  socialLabel,
  socialRtmpUrl,
  type SocialDestination,
} from "@/components/broadcast/SocialStreamConnect";
import { HistoryBackButton } from "@/components/layout/HistoryBackButton";
import { loadRememberedSocial, rememberSocial } from "@/lib/broadcast/socialRemember";
import {
  OVERLAY_DESIGNS,
  parseOverlayDesign,
  type OverlayDesignId,
} from "@/components/broadcast/overlayThemes";
import { Button } from "@/components/ui/Button";
import { Drawer, DrawerHandle } from "@/components/ui/Drawer";
import { EmptyState, LiveDot, SectionTitle, Seam, Spinner } from "@/components/ui/Surface";
import { publicApi } from "@/lib/api/endpoints";
import type { CompactState, MatchSnapshot } from "@/lib/api/types";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { startLivePublishStream, type OverlayCompositor } from "@/lib/broadcast/overlayCompositor";
import { cn } from "@/lib/utils";
import { createWhipPublisher, type WhipStatus } from "@/lib/whipPublish";
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

function cameraDeviceId(slug: string, token: string): string {
  const key = `odcc.cam.device.${slug}.${token}`;
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
}

function useDeviceLandscape(): boolean {
  const [yes, setYes] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(orientation: landscape)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const on = () => setYes(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return yes;
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

/** live = publishing, warn = needs the operator, idle = nothing wrong. */
type Tone = "live" | "warn" | "idle";

function statusTone(phase: UiPhase, whipStatus: WhipStatus): Tone {
  if (phase === "live" && whipStatus === "connected") return "live";
  if (
    phase === "connection_lost" ||
    phase === "permission_required" ||
    phase === "camera_unavailable" ||
    whipStatus === "failed" ||
    whipStatus === "reconnecting"
  ) {
    return "warn";
  }
  return "idle";
}

export default function ExternalCamera() {
  const { slug, token } = useParams<{ slug: string; token: string }>();
  const [params, setParams] = useSearchParams();
  const preferLandscape = params.get("orient") !== "portrait";
  const landscape = useDeviceLandscape();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const whipRef = useRef(createWhipPublisher());
  const whipUrlRef = useRef<string | null>(null);
  const whipPathRef = useRef<string | null>(null);
  const compositeRef = useRef<OverlayCompositor | null>(null);
  const overlayHudRef = useRef<HTMLDivElement>(null);
  const overlayStateRef = useRef<CompactState | null>(null);
  const snapshotRef = useRef<MatchSnapshot | null>(null);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [hasStream, setHasStream] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [whipStatus, setWhipStatus] = useState<WhipStatus>("idle");
  const [whipDetail, setWhipDetail] = useState<string | null>(null);
  const [overlayDesign, setOverlayDesign] = useState<OverlayDesignId>("circle");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [deckOpen, setDeckOpen] = useState(false);
  const [destination, setDestination] = useState<SocialDestination>(
    () => loadRememberedSocial()?.destination ?? "facebook_page",
  );
  const [destinationName, setDestinationName] = useState(
    () => loadRememberedSocial()?.destinationName ?? "",
  );
  const [streamKey, setStreamKey] = useState(() => loadRememberedSocial()?.streamKey ?? "");

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
    rememberSocial({ destination, destinationName, streamKey });
  }, [destination, destinationName, streamKey]);

  useEffect(() => {
    if (!preferLandscape) return;
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (mode: string) => Promise<void>;
    };
    void orientation.lock?.("landscape").catch(() => undefined);
    return () => {
      orientation.unlock?.();
    };
  }, [preferLandscape]);

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

  useEffect(() => {
    const connected = params.get("fb");
    const err = params.get("fb_error");
    if (!connected && !err) return;
    if (connected === "connected") {
      toast("Facebook connected. Pick Timeline or a Page, then Go live.", "success");
      void invite.refetch();
    }
    if (err) toast(err, "error");
    const next = new URLSearchParams(params);
    next.delete("fb");
    next.delete("fb_error");
    setParams(next, { replace: true });
  }, [invite, params, setParams]);

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
  overlayStateRef.current = state ?? null;
  snapshotRef.current = scorecard.data ?? null;

  useEffect(() => {
    if (!state?.graphics?.design) return;
    setOverlayDesign(parseOverlayDesign(state.graphics.design));
  }, [state?.graphics?.design]);

  const directorPanel = state?.graphics?.panel ?? "hidden";
  const directorDeck = Boolean(directorDeckPanel(directorPanel));

  useEffect(() => {
    if (directorPanel === "hidden") {
      setDeckOpen(false);
      return;
    }
    if (directorDeck) setDeckOpen(true);
    else if (directorPanel === "live") setDeckOpen(false);
  }, [directorPanel, directorDeck]);

  useEffect(() => {
    const liveVersion = state?.state_version ?? 0;
    const version = scorecard.data?.match.state_version ?? 0;
    if (liveVersion > version) void scorecard.refetch();
  }, [state?.state_version, scorecard]);

  const stopCamera = useCallback(async () => {
    await whipRef.current.stop();
    compositeRef.current?.stop();
    compositeRef.current = null;
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
      if (slug && token) {
        await publicApi.cameraClaim(slug, token);
        const joined = await publicApi.cameraJoin(slug, token, cameraDeviceId(slug, token));
        whipUrlRef.current = joined.whip_publish_url;
        whipPathRef.current = joined.whip_path;
      }
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

      if (slug && token) {
        const joined = await publicApi.cameraJoin(slug, token, cameraDeviceId(slug, token));
        whipUrlRef.current = joined.whip_publish_url ?? whipUrlRef.current;
        whipPathRef.current = joined.whip_path ?? whipPathRef.current;
      }
      const whipUrl = whipUrlRef.current ?? invite.data?.whip_publish_url;
      if (!whipUrl) {
        setPhase("connection_lost");
        setError(
          "No WHIP publish URL. Set MEDIAMTX_WHIP_BASE_URL to a public HTTPS MediaMTX endpoint reachable from phones.",
        );
        toast("Streaming server not configured.", "error");
        return;
      }

      const video = videoRef.current;
      if (video) {
        compositeRef.current?.stop();
        const composed = startLivePublishStream({
          video,
          cameraStream: stream,
          overlayEl: () => overlayHudRef.current,
          ...captureFrameSize(landscape),
          getFrame: () => ({
            state: overlayStateRef.current,
            snapshot: snapshotRef.current,
            tickerFallback: invite.data?.title,
          }),
        });
        compositeRef.current = composed;
        await whipRef.current.start(composed.stream, whipUrl);
      } else {
        await whipRef.current.start(stream, whipUrl);
      }
      const live = await publicApi.cameraGoLive(slug!, token!, {
        device_id: slug && token ? cameraDeviceId(slug, token) : undefined,
        whip_path: whipPathRef.current ?? undefined,
      });
      setPhase("live");
      if (live.facebook_ingest) {
        toast(
          "ODCC is live. Stay on this screen ~10 seconds — the Facebook Page goes LIVE after video reaches Facebook, then we publish the post.",
          "success",
        );
      } else if (invite.data?.facebook?.connected) {
        toast(
          "ODCC is live, but Facebook is not ingesting. Pick the Page again, then End live and Go live.",
          "warning",
        );
      } else {
        toast("You are live in ODCC.", "success");
      }
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
  }, [invite, openMedia, slug, token, landscape]);

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
      const whipUrl = whipUrlRef.current ?? invite.data?.whip_publish_url;
      if (wasLive && whipUrl && videoRef.current) {
        compositeRef.current?.stop();
        const composed = startLivePublishStream({
          video: videoRef.current,
          cameraStream: stream,
          overlayEl: () => overlayHudRef.current,
          ...captureFrameSize(landscape),
          getFrame: () => ({
            state: overlayStateRef.current,
            snapshot: snapshotRef.current,
            tickerFallback: invite.data?.title,
          }),
        });
        compositeRef.current = composed;
        await whipRef.current.restart(composed.stream, whipUrl);
        setPhase("live");
      } else if (wasLive && whipUrl) {
        await whipRef.current.restart(stream, whipUrl);
        setPhase("live");
      } else {
        setPhase("preview");
      }
    } catch (err) {
      const next = classifyMediaError(err);
      setPhase(next);
      setError(err instanceof Error ? err.message : "Camera denied.");
    }
  }, [facing, invite.data?.whip_publish_url, phase, landscape]);

  const retry = useCallback(() => {
    void publishAndGoLive();
  }, [publishAndGoLive]);

  useEffect(() => () => {
    void stopCamera();
  }, [stopCamera]);

  const endLive = useMutation({
    mutationFn: async () => {
      await whipRef.current.stop();
      compositeRef.current?.stop();
      compositeRef.current = null;
      return publicApi.cameraEnd(slug!, token!, {
        device_id: slug && token ? cameraDeviceId(slug, token) : undefined,
        whip_path: whipPathRef.current ?? undefined,
      });
    },
    onSuccess: () => {
      setPhase(hasStream ? "preview" : "idle");
      toast("Live ended on this phone. Other cameras stay on.", "info");
      void invite.refetch();
    },
    onError: (err) => toastError(err, "Could not end live."),
  });

  const saveDest = useMutation({
    mutationFn: () =>
      publicApi.cameraDestinations(slug!, token!, {
        destination_label: socialLabel(destination, destinationName),
        rtmp_url: socialRtmpUrl(destination),
        stream_key: streamKey || undefined,
      }),
    onSuccess: () => toast("YouTube / Facebook key saved.", "success"),
    onError: (err) => toastError(err, "Could not save the stream key."),
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
  const tone = statusTone(phase, whipStatus);
  const showRetry =
    phase === "connection_lost" ||
    phase === "permission_required" ||
    phase === "camera_unavailable" ||
    whipStatus === "failed";
  const isLive = phase === "live" && whipStatus === "connected";
  const canFlip = phase === "preview" || phase === "live" || phase === "connection_lost";
  const whipReady = Boolean(whipUrlRef.current || invite.data.whip_publish_url);

  /**
   * The single most useful button right now, kept on the main screen. A lost
   * connection resolves to Retry rather than End live — the drawer still
   * offers both, so nothing is unreachable.
   */
  const primaryAction =
    phase === "idle" ? (
      <Button fullWidth onClick={() => void startCamera()}>
        Start camera
      </Button>
    ) : phase === "preview" ? (
      <Button fullWidth onClick={() => void publishAndGoLive()}>
        Go live
      </Button>
    ) : showRetry ? (
      <Button fullWidth onClick={retry}>
        Retry
      </Button>
    ) : phase === "live" ? (
      <Button
        fullWidth
        variant="danger"
        onClick={() => endLive.mutate()}
        loading={endLive.isPending}
      >
        End live
      </Button>
    ) : null;

  const controls = (
    <div className="flex flex-col gap-4">
      <div>
        <SectionTitle>Camera</SectionTitle>
        <div className="grid gap-2 pt-2">
          {phase === "idle" && (
            <Button size="sm" fullWidth onClick={() => void startCamera()}>
              Start camera
            </Button>
          )}
          {phase === "preview" && (
            <Button size="sm" fullWidth onClick={() => void publishAndGoLive()}>
              Go live
            </Button>
          )}
          {canFlip && (
            <Button size="sm" fullWidth variant="ghost" onClick={() => void flipCamera()}>
              Switch to {facing === "environment" ? "front" : "back"} camera
            </Button>
          )}
          {showRetry && (
            <Button size="sm" fullWidth onClick={retry}>
              Retry
            </Button>
          )}
          {(phase === "live" || (phase === "connection_lost" && hasStream)) && (
            <Button
              size="sm"
              fullWidth
              variant="danger"
              onClick={() => endLive.mutate()}
              loading={endLive.isPending}
            >
              End live
            </Button>
          )}
        </div>
      </div>

      <Seam />

      <div>
        <SectionTitle>Match information</SectionTitle>
        <p className="pt-1.5 font-sans text-[0.68rem] text-willow-soft">
          Swipe the deck over the frame for the scorecard, over analysis, both innings and the
          squads — or push them from scoring.
        </p>
        <Button
          size="sm"
          fullWidth
          variant={deckOpen ? "secondary" : "ghost"}
          className="mt-2"
          onClick={() => {
            setDeckOpen((v) => !v);
            setDrawerOpen(false);
          }}
        >
          {deckOpen ? "Hide the deck" : "Show the deck"}
        </Button>
      </div>

      <Seam />

      <OverlayDirectorPanel
        graphics={state?.graphics}
        saveFn={(patch) => publicApi.cameraOverlay(slug!, token!, patch)}
      />

      <Seam />

      <SocialStreamConnect
        destination={destination}
        streamKey={streamKey}
        destinationName={destinationName}
        onDestination={setDestination}
        onStreamKey={setStreamKey}
        onDestinationName={setDestinationName}
        facebook={invite.data.facebook}
        camera={slug && token ? { slug, token } : undefined}
        onFacebookChange={() => void invite.refetch()}
      />
      {(destination === "youtube" || !invite.data.facebook?.connected) && (
        <Button
          size="sm"
          fullWidth
          variant="secondary"
          loading={saveDest.isPending}
          onClick={() => saveDest.mutate()}
        >
          Save stream key
        </Button>
      )}

      <Seam />

      <div>
        <SectionTitle>Overlay design</SectionTitle>
        <div className="grid gap-1.5 pt-2">
          {OVERLAY_DESIGNS.map((design) => (
            <button
              key={design.id}
              type="button"
              onClick={() => {
                setOverlayDesign(design.id);
                if (slug && token) void publicApi.cameraOverlay(slug, token, { design: design.id });
              }}
              aria-pressed={overlayDesign === design.id}
              className={cn(
                "rounded-[3px] border px-2 py-1.5 text-left transition-colors",
                overlayDesign === design.id
                  ? "border-flip/70 bg-flip/10"
                  : "border-willow/25 hover:border-willow/60",
              )}
            >
              <span className="block font-sans text-[0.72rem] font-semibold text-chalk">
                {design.label}
              </span>
              <span className="block font-sans text-[0.62rem] leading-snug text-willow-soft">
                {design.blurb}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Seam />

      <p className="font-sans text-[0.62rem] leading-relaxed text-willow-soft">
        Scan this QR on as many phones as you want — each one goes live on its own path.
        <br />
        Score updates live from the scorer.
        <br />
        Session: {invite.data.status}
        <br />
        {whipReady ? "Streaming server ready." : "Streaming server not configured."}
      </p>
    </div>
  );

  return (
    <div className={cn("min-h-dvh bg-ink", landscape && "h-dvh overflow-hidden")}>
      <DrawerHandle
        onClick={() => setDrawerOpen(true)}
        label="Open camera options"
        className="sm:hidden"
      />

      <div
        className={cn(
          landscape
            ? "relative h-dvh w-full"
            : "mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-3 px-3 py-3",
        )}
      >
        <header
          className={cn(
            "flex items-center gap-2.5",
            landscape &&
              "pointer-events-none absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-black/70 to-transparent p-2 pb-8",
          )}
        >
          <HistoryBackButton fallback="/" className="pointer-events-auto shrink-0" />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open camera options"
            className="pointer-events-auto flex size-9 shrink-0 flex-col items-center justify-center gap-1 rounded-[3px] border border-willow/40 bg-ink/50 text-willow-soft hover:border-flip/60 hover:text-flip"
          >
            <span aria-hidden="true" className="block h-0.5 w-4 rounded-full bg-current" />
            <span aria-hidden="true" className="block h-0.5 w-4 rounded-full bg-current" />
            <span aria-hidden="true" className="block h-0.5 w-4 rounded-full bg-current" />
          </button>
          {!landscape && (
            <div className="min-w-0 flex-1">
              <p className="font-sans text-[0.6rem] font-bold tracking-[0.16em] text-willow uppercase">
                External camera
              </p>
              <h1 className="truncate font-sans text-[0.95rem] leading-tight font-semibold text-chalk">
                {invite.data.title}
              </h1>
            </div>
          )}
          {landscape && <div className="min-w-0 flex-1" />}
          <span
            className={cn(
              "pointer-events-none flex shrink-0 items-center gap-1.5 rounded-[2px] border px-2 py-1",
              "font-sans text-[0.6rem] font-bold tracking-[0.12em] uppercase",
              tone === "live"
                ? "border-flip/70 bg-flip/15 text-flip"
                : tone === "warn"
                  ? "border-boundary/60 bg-boundary/15 text-boundary-soft"
                  : "border-willow/40 bg-ink/50 text-willow-soft",
            )}
          >
            {tone === "live" && <LiveDot />}
            {tone === "live" ? "Live" : tone === "warn" ? "Attention" : "Ready"}
          </span>
        </header>

        {!landscape && tone !== "live" && (
          <div
            role="status"
            className={cn(
              "rounded-[3px] border px-2.5 py-2 font-sans text-[0.78rem]",
              tone === "warn"
                ? "border-boundary/45 bg-boundary/10 text-chalk"
                : "border-willow/25 bg-pitch/40 text-chalk",
            )}
          >
            <p className="font-semibold">{banner}</p>
            {error && <p className="mt-0.5 text-[0.7rem] text-willow-soft">{error}</p>}
            {!whipReady && (
              <p className="mt-0.5 text-[0.7rem] text-willow-soft">
                The host must set a public HTTPS MEDIAMTX_WHIP_BASE_URL.
              </p>
            )}
          </div>
        )}

        <div
          className={cn(
            "relative overflow-hidden bg-black",
            landscape
              ? "absolute inset-0 z-0 h-dvh w-full rounded-none border-0"
              : cn(
                  "max-h-[70dvh] rounded-[4px] border border-willow/30",
                  "aspect-[9/16] sm:aspect-video sm:max-h-none",
                ),
          )}
        >
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />

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

          {isLive && (
            <span className="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 rounded-[2px] bg-boundary px-2 py-1 font-sans text-[0.6rem] font-bold tracking-[0.12em] text-chalk uppercase">
              <LiveDot />
              Live
            </span>
          )}
          {phase === "connection_lost" && (
            <span className="absolute top-2.5 left-2.5 z-20 rounded-[2px] bg-boundary/85 px-2 py-1 font-sans text-[0.6rem] font-bold tracking-[0.12em] text-chalk uppercase">
              Reconnecting
            </span>
          )}

          <div ref={overlayHudRef} className="pointer-events-none absolute inset-0 z-10">
            <LiveBroadcastHud
              state={state}
              snapshot={scorecard.data ?? null}
              design={parseOverlayDesign(state?.graphics?.design ?? overlayDesign)}
              tickerFallback={invite.data.title}
            />
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-2",
            landscape &&
              "absolute right-2 bottom-[calc(env(safe-area-inset-bottom)+2.75rem)] z-40 w-[min(46vw,11rem)] flex-col",
          )}
        >
          <Button
            size="sm"
            variant={deckOpen ? "secondary" : "ghost"}
            onClick={() => setDeckOpen((v) => !v)}
            aria-pressed={deckOpen}
            className={landscape ? "w-full bg-ink/70" : undefined}
          >
            {deckOpen ? "Hide card" : "Scorecard"}
          </Button>
          {canFlip && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void flipCamera()}
              className={landscape ? "w-full bg-ink/70" : undefined}
            >
              {facing === "environment" ? "Front" : "Back"}
            </Button>
          )}
          <div className={cn("min-w-0", landscape ? "w-full" : "flex-1")}>{primaryAction}</div>
        </div>

        {!landscape && (
          <p className="hidden font-sans text-[0.65rem] text-willow-soft sm:block">
            Everything else — YouTube, Facebook, overlay and session details — is under the menu.
          </p>
        )}
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Camera options"
        description={invite.data.title}
      >
        {controls}
      </Drawer>
    </div>
  );
}
