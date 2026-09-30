/**
 * Go Live studio: phone camera link/QR (preferred), optional OBS overlay,
 * and this-device WHIP publish when MediaMTX is public.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  LiveInfoPanelToggles,
  useLiveInfoPanels,
} from "@/components/broadcast/LiveInfoPanels";
import {
  OVERLAY_DESIGNS,
  parseOverlayDesign,
  type OverlayDesignId,
} from "@/components/broadcast/overlayThemes";
import { OverlayDirectorPanel } from "@/components/broadcast/OverlayDirectorPanel";
import {
  LiveBroadcastHud,
  captureFrameSize,
} from "@/components/broadcast/LiveBroadcastHud";
import { QrCode } from "@/components/broadcast/QrCode";
import {
  SocialStreamConnect,
  socialLabel,
  socialRtmpUrl,
  type SocialDestination,
} from "@/components/broadcast/SocialStreamConnect";
import { HistoryBackButton } from "@/components/layout/HistoryBackButton";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
import { broadcast as broadcastApi, matches as matchesApi, publicApi } from "@/lib/api/endpoints";
import type { CompactState, MatchSnapshot } from "@/lib/api/types";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { copyToClipboard } from "@/lib/utils";
import { startLivePublishStream, type OverlayCompositor } from "@/lib/broadcast/overlayCompositor";
import { createWhipPublisher, type WhipStatus } from "@/lib/whipPublish";
import {
  mockOverlayState,
  TvScoreOverlay,
} from "@/components/broadcast/TvScoreBars";
import { toast, toastError } from "@/store/toast";

type Phase = "idle" | "preview" | "live" | "connecting" | "error";
type Tab = "camera" | "overlay" | "device";
type Orientation = "landscape" | "portrait";

function studioStorageKey(matchId: string) {
  return `odcc.studio.${matchId}`;
}

type StudioPrefs = {
  overlayDesign?: OverlayDesignId;
  orientation?: Orientation;
  tab?: Tab;
};

function loadStudioPrefs(matchId: string | undefined): StudioPrefs {
  if (!matchId) return {};
  try {
    const raw = localStorage.getItem(studioStorageKey(matchId));
    if (!raw) return {};
    return JSON.parse(raw) as StudioPrefs;
  } catch {
    return {};
  }
}

export default function BroadcastStudio() {
  const { matchId } = useParams<{ matchId: string }>();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const whipRef = useRef(createWhipPublisher());
  const compositeRef = useRef<OverlayCompositor | null>(null);
  const overlayHudRef = useRef<HTMLDivElement>(null);
  const overlayStateRef = useRef<CompactState | null>(null);
  const snapshotRef = useRef<MatchSnapshot | null>(null);
  const savedPrefs = loadStudioPrefs(matchId);

  const [tab, setTab] = useState<Tab>(() => savedPrefs.tab ?? "camera");
  const [phase, setPhase] = useState<Phase>("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [whipStatus, setWhipStatus] = useState<WhipStatus>("idle");
  const [orientation, setOrientation] = useState<Orientation>(
    () => savedPrefs.orientation ?? "landscape",
  );
  const [overlayDesign, setOverlayDesign] = useState<OverlayDesignId>(
    () => savedPrefs.overlayDesign ?? "circle",
  );
  const [zoom, setZoom] = useState(1);
  const [quality, setQuality] = useState("480");
  const [destination, setDestination] = useState<SocialDestination>("facebook_page");
  const [destinationName, setDestinationName] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [showObsAdvanced, setShowObsAdvanced] = useState(false);
  const { active: infoPanels, onToggle: toggleInfo } = useLiveInfoPanels();

  const matchQuery = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => matchesApi.get(matchId!),
    enabled: Boolean(matchId),
  });

  const sessionQuery = useQuery({
    queryKey: ["stream-session", matchId],
    queryFn: () => broadcastApi.ensure(matchId!),
    enabled: Boolean(matchId),
    retry: 1,
  });

  useEffect(() => {
    const connected = params.get("fb");
    const err = params.get("fb_error");
    if (!connected && !err) return;
    if (connected === "connected") {
      toast("Facebook connected. Pick Timeline or a Page, then Go live.", "success");
      void sessionQuery.refetch();
    }
    if (err) toast(err, "error");
    const next = new URLSearchParams(params);
    next.delete("fb");
    next.delete("fb_error");
    setParams(next, { replace: true });
  }, [params, sessionQuery, setParams]);

  const slug = matchQuery.data?.match.slug;
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
  const session = sessionQuery.data;

  useEffect(() => {
    if (!state?.graphics?.design) return;
    setOverlayDesign(parseOverlayDesign(state.graphics.design));
  }, [state?.graphics?.design]);

  const pickDesign = (id: OverlayDesignId) => {
    setOverlayDesign(id);
    if (matchId) void matchesApi.patchOverlay(matchId, { design: id });
  };

  const liveDesign = parseOverlayDesign(state?.graphics?.design ?? overlayDesign);
  const effectiveDesign = liveDesign;
  const previewState = state?.score ? state : mockOverlayState();

  const webOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const overlayUrl = slug
    ? `${webOrigin}/s/${slug}/overlay?design=${effectiveDesign}&position=bottom`
    : null;

  const cameraBase =
    session?.camera_url ||
    (session?.camera_token && slug
      ? `${webOrigin}/s/${slug}/camera/${session.camera_token}`
      : null);
  const cameraUrl = cameraBase
    ? `${cameraBase}${cameraBase.includes("?") ? "&" : "?"}orient=${orientation}`
    : null;

  useEffect(() => {
    return whipRef.current.onStatus((status, detail) => {
      setWhipStatus(status);
      if (status === "failed") {
        setPhase("error");
        setError(detail || "WHIP connection lost.");
      }
      if (status === "connected") {
        setPhase((prev) => (prev === "connecting" ? "live" : prev));
      }
    });
  }, []);

  useEffect(() => {
    if (!matchId) return;
    try {
      localStorage.setItem(
        studioStorageKey(matchId),
        JSON.stringify({
          overlayDesign,
          orientation,
          tab,
        } satisfies StudioPrefs),
      );
    } catch {
      /* ignore quota / private mode */
    }
  }, [matchId, overlayDesign, orientation, tab]);

  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then((devices) => {
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
    });
  }, []);

  const stopCamera = useCallback(async () => {
    await whipRef.current.stop();
    compositeRef.current?.stop();
    compositeRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(
    async (opts?: { facingMode?: "environment" | "user" }) => {
      setError(null);
      await stopCamera();
      try {
        const height = quality === "720" ? 720 : quality === "1080" ? 1080 : 480;
        const width = Math.round((height * 16) / 9);
        const face = opts?.facingMode ?? facing;
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioDeviceId ? { deviceId: { ideal: audioDeviceId } } : true,
          video: {
            ...(videoDeviceId
              ? { deviceId: { ideal: videoDeviceId } }
              : { facingMode: { ideal: face } }),
            width: { ideal: width },
            height: { ideal: height },
          },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setPhase("preview");
      } catch (err) {
        setPhase("error");
        setError(err instanceof Error ? err.message : "Camera permission denied.");
        toastError(err, "Could not open the camera.");
      }
    },
    [audioDeviceId, facing, quality, stopCamera, videoDeviceId],
  );

  useEffect(() => () => {
    void stopCamera();
  }, [stopCamera]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["stream-session", matchId] });

  const saveDestinations = useMutation({
    mutationFn: async () => {
      const input = {
        destination_label: socialLabel(destination, destinationName),
        rtmp_url: socialRtmpUrl(destination),
        stream_key: streamKey || null,
      };
      if (session) return broadcastApi.updateDestinations(matchId!, input);
      return broadcastApi.create(matchId!, input);
    },
    onSuccess: () => {
      invalidate();
      setStreamKey("");
      toast("Destination saved.", "success");
    },
    onError: (err) => toastError(err, "Could not save destination."),
  });

  const goLive = useMutation({
    mutationFn: async () => {
      setPhase("connecting");
      setError(null);
      const ensured = session ?? (await broadcastApi.ensure(matchId!));
      if (streamKey) {
        await broadcastApi.updateDestinations(matchId!, {
          destination_label: socialLabel(destination, destinationName),
          rtmp_url: socialRtmpUrl(destination),
          stream_key: streamKey,
        });
      }
      const whipUrl = ensured.whip_publish_url;
      const stream = streamRef.current;
      const video = videoRef.current;
      if (whipUrl && stream && video) {
        compositeRef.current?.stop();
        const composed = startLivePublishStream({
          video,
          cameraStream: stream,
          overlayEl: () => overlayHudRef.current,
          ...captureFrameSize(orientation !== "portrait"),
          getFrame: () => ({
            state: overlayStateRef.current,
            snapshot: snapshotRef.current,
            tickerFallback: matchQuery.data?.match.title,
          }),
        });
        compositeRef.current = composed;
        await whipRef.current.start(composed.stream, whipUrl);
      } else if (whipUrl && stream) {
        await whipRef.current.start(stream, whipUrl);
      } else if (!whipUrl) {
        setError(
          "No WHIP URL — set MEDIAMTX_WHIP_BASE_URL to public HTTPS for phone/device publish. Status will still mark live for overlay-only.",
        );
      }
      return broadcastApi.goLive(matchId!);
    },
    onSuccess: (session) => {
      invalidate();
      setPhase("live");
      if (session.facebook_ingest) {
        toast(
          "ODCC is live. Stay on this screen ~10 seconds so the Facebook Page can go LIVE.",
          "success",
        );
      } else {
        toast("Live in ODCC.", "success");
      }
    },
    onError: (err) => {
      setPhase("error");
      toastError(err, "Could not go live.");
    },
  });

  const endLive = useMutation({
    mutationFn: async () => {
      await whipRef.current.stop();
      return broadcastApi.end(matchId!);
    },
    onSuccess: () => {
      invalidate();
      setPhase(streamRef.current ? "preview" : "idle");
      toast("Broadcast ended.", "info");
    },
    onError: (err) => toastError(err, "Could not end the stream."),
  });

  if (matchQuery.isLoading) return <Spinner label="Loading match" />;
  if (!matchQuery.data) {
    return (
      <Panel>
        <p className="p-4 font-sans text-sm text-willow">Match not found.</p>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-2">
          <HistoryBackButton className="mt-0.5" />
          <div>
          <Link
            to={`/app/matches/${matchId}`}
            className="font-sans text-xs text-willow hover:text-chalk"
          >
            Scoring console
          </Link>
          <h1 className="font-sans text-lg font-semibold text-chalk">Go Live</h1>
          <p className="font-sans text-xs text-willow">{matchQuery.data.match.title}</p>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(
          [
            ["camera", "Phone camera"],
            ["overlay", "OBS overlay"],
            ["device", "This device"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "rounded-[3px] border-2 border-boundary bg-boundary/20 px-2 py-3 font-sans text-sm font-semibold text-chalk"
                : "rounded-[3px] border border-willow/30 px-2 py-3 font-sans text-sm text-willow"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "camera" && (
        <Panel>
          <SectionTitle>Phone camera link</SectionTitle>
          <Seam className="my-3" />
          <p className="mb-3 font-sans text-sm text-willow">
            Scan this QR on every phone you want on air. Each phone gets its own live camera —
            as many as you like. On the phone, connect YouTube or a Facebook page, then Go live.
            Turn the phone sideways for a full-screen scorecard.
          </p>

          {sessionQuery.isLoading && <Spinner label="Preparing camera session" />}
          {sessionQuery.isError && (
            <div className="rounded-[3px] border border-boundary/40 px-3 py-3">
              <p className="font-sans text-sm text-boundary">
                {sessionQuery.error instanceof ApiError
                  ? sessionQuery.error.message
                  : "Could not create a stream session. Check API access, then retry."}
              </p>
              {sessionQuery.error instanceof ApiError &&
              sessionQuery.error.code === "live_not_entitled" ? (
                <Link to="/app/pricing" className="mt-2 inline-block">
                  <Button size="sm" variant="secondary">
                    See pricing
                  </Button>
                </Link>
              ) : null}
            </div>
          )}

          {cameraUrl && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <QrCode value={cameraUrl} size={240} label="Camera QR code" />
              <div className="min-w-0 flex-1">
                <TextField label="Camera link" value={cameraUrl} readOnly />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void copyToClipboard(cameraUrl).then((ok) =>
                        toast(ok ? "Camera link copied." : cameraUrl, ok ? "success" : "info"),
                      )
                    }
                  >
                    Copy link
                  </Button>
                  <a href={cameraUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="secondary">
                      Open
                    </Button>
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void sessionQuery.refetch()}
                    loading={sessionQuery.isFetching}
                  >
                    Refresh
                  </Button>
                </div>
                <ol className="mt-4 list-decimal space-y-2 pl-4 font-sans text-xs text-willow">
                  <li>Scan the QR on as many phones as you want — they do not kick each other off.</li>
                  <li>Allow camera + mic. Optional: login to YouTube Studio or Facebook Live Producer and paste the stream key.</li>
                  <li>Tap Go live. Hold landscape for a full-screen camera and scorecard.</li>
                  <li>From scoring, push scorecard, batting, over analysis or a scrolling notice onto every camera.</li>
                </ol>
                {!session?.whip_publish_url && (
                  <p className="mt-3 rounded-[3px] border border-boundary/30 px-2 py-2 font-sans text-[11px] text-boundary">
                    WHIP URL missing. Set <code className="text-chalk">MEDIAMTX_WHIP_BASE_URL</code> to
                    a public HTTPS MediaMTX endpoint (phones cannot reach localhost).
                  </p>
                )}
                <p className="mt-3 font-sans text-[10px] text-willow">
                  Tip: for LAN testing, open this site via your PC’s network URL so the QR is
                  reachable (not only localhost).
                </p>
              </div>
            </div>
          )}

          {matchId && (
            <>
              <Seam className="my-4" />
              <OverlayDirectorPanel matchId={matchId} graphics={state?.graphics} />
              <Seam className="my-4" />
              <SocialStreamConnect
                destination={destination}
                streamKey={streamKey}
                destinationName={destinationName}
                onDestination={setDestination}
                onStreamKey={setStreamKey}
                onDestinationName={setDestinationName}
                facebook={sessionQuery.data?.facebook}
                matchId={matchId}
                onFacebookChange={() => void sessionQuery.refetch()}
              />
              {(destination === "youtube" || !sessionQuery.data?.facebook?.connected) && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => saveDestinations.mutate()}
                    loading={saveDestinations.isPending}
                  >
                    Save RTMP destination
                  </Button>
                </div>
              )}
            </>
          )}
        </Panel>
      )}

      {tab === "overlay" && (
        <Panel>
          <SectionTitle>Score overlay (optional · OBS)</SectionTitle>
          <Seam className="my-3" />
          <p className="mb-3 font-sans text-sm text-willow">
            Advanced / optional: paste this transparent page as a browser source in OBS (or
            Facebook Live Producer / YouTube Studio) if you already stream with desktop software.
            Prefer the <strong className="text-chalk">Phone camera</strong> tab for the in-app live
            path.
          </p>

          <div className="mb-4">
            <p className="mb-1 font-sans text-xs text-willow">Overlay design</p>
            <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {OVERLAY_DESIGNS.map((design) => {
                const selected = overlayDesign === design.id;
                return (
                  <button
                    key={design.id}
                    type="button"
                    onClick={() => pickDesign(design.id)}
                    className={
                      selected
                        ? "rounded-[3px] border-2 border-boundary bg-boundary/10 px-2 py-2 text-left"
                        : "rounded-[3px] border border-willow/30 px-2 py-2 text-left hover:border-willow/50"
                    }
                  >
                    <span className="block font-sans text-xs font-semibold text-chalk">
                      {design.label}
                    </span>
                    <span className="mb-1.5 block font-sans text-[10px] text-willow">
                      {design.blurb}
                    </span>
                    <div className="pointer-events-none overflow-hidden rounded-[2px] border border-willow/20 bg-ink/60 p-1">
                      <div className="origin-top-left scale-[0.42] [width:238%]">
                        <TvScoreOverlay
                          state={previewState}
                          design={design.id}
                          showPlayerCard={false}
                          className="max-w-none"
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-4 rounded-[4px] border border-willow/20 bg-ink/80 p-3">
            <p className="mb-2 font-sans text-[10px] tracking-wide text-willow uppercase">
              {state?.score ? "Live preview" : "Preview (sample score)"} · {overlayDesign}
            </p>
            <TvScoreOverlay
              state={previewState}
              design={overlayDesign}
              showPlayerCard={false}
              className="max-w-full"
            />
          </div>

          {overlayUrl && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <QrCode value={overlayUrl} size={180} label="Overlay QR code" />
              <div className="min-w-0 flex-1">
                <TextField label="Overlay link (Browser source)" value={overlayUrl} readOnly />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      void copyToClipboard(overlayUrl).then((ok) =>
                        toast(ok ? "Overlay link copied." : overlayUrl, ok ? "success" : "info"),
                      )
                    }
                  >
                    Copy link
                  </Button>
                  <a href={overlayUrl} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="secondary">
                      Preview
                    </Button>
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowObsAdvanced((v) => !v)}
                  >
                    {showObsAdvanced ? "Hide OBS tips" : "OBS tips"}
                  </Button>
                </div>

                {showObsAdvanced && (
                  <ol className="mt-4 list-decimal space-y-2 pl-4 font-sans text-xs text-willow">
                    <li>
                      <span className="text-chalk">OBS:</span> Sources → Browser → paste link → width
                      1920, height 220 (or full canvas) → no custom CSS background.
                    </li>
                    <li>
                      <span className="text-chalk">Facebook:</span> Live Producer → Sources → Browser
                      source → paste link.
                    </li>
                    <li>
                      <span className="text-chalk">YouTube:</span> Studio → Go Live → streaming
                      software → browser source with this link.
                    </li>
                  </ol>
                )}
              </div>
            </div>
          )}
        </Panel>
      )}

      {tab === "device" && (
        <>
          {error && (
            <p className="rounded-[4px] border border-boundary/40 px-3 py-2 font-sans text-sm text-boundary">
              {error}
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div
              className={
                orientation === "portrait"
                  ? "relative mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-sm overflow-hidden rounded-[4px] border border-willow/30 bg-ink"
                  : "relative aspect-video overflow-hidden rounded-[4px] border border-willow/30 bg-ink"
              }
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className="h-full w-full object-cover"
                style={{ transform: `scale(${zoom})` }}
              />
              {phase === "idle" && (
                <div className="absolute inset-0 grid place-items-center bg-ink/90 px-4 text-center font-sans text-sm text-willow">
                  No camera — start preview, then Go live to WHIP-publish
                </div>
              )}
              {phase === "connecting" && (
                <div className="absolute inset-0 grid place-items-center bg-ink/80 font-sans text-sm text-chalk">
                  Connecting…
                </div>
              )}
              {phase === "live" && (
                <span className="absolute top-3 left-3 z-20 rounded-[2px] bg-boundary px-2 py-0.5 font-sans text-[10px] font-bold text-chalk uppercase">
                  Live{whipStatus === "connected" ? "" : "…"}
                </span>
              )}
              <div ref={overlayHudRef} className="pointer-events-none absolute inset-0 z-10">
                <LiveBroadcastHud
                  state={state}
                  snapshot={scorecard.data ?? null}
                  design={effectiveDesign}
                  tickerFallback={matchQuery.data.match.title}
                />
              </div>
            </div>

            <Panel>
              <SectionTitle>Camera & stream</SectionTitle>
              <Seam className="my-3" />
              <div className="flex flex-col gap-3">
                <div>
                  <p className="mb-1 font-sans text-xs text-willow">Live info panels</p>
                  <LiveInfoPanelToggles active={infoPanels} onToggle={toggleInfo} />
                </div>

                <SelectField
                  label="Camera source"
                  value={videoDeviceId}
                  onChange={(e) => setVideoDeviceId(e.target.value)}
                >
                  <option value="">Default camera</option>
                  {videoDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Camera"}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label="Microphone"
                  value={audioDeviceId}
                  onChange={(e) => setAudioDeviceId(e.target.value)}
                >
                  <option value="">Default mic</option>
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || "Mic"}
                    </option>
                  ))}
                </SelectField>

                <div>
                  <p className="mb-1 font-sans text-xs text-willow">Stream orientation</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["landscape", "Landscape (hold sideways)"],
                        ["portrait", "Portrait (hold upright)"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setOrientation(value)}
                        className={
                          orientation === value
                            ? "rounded-[3px] border-2 border-boundary px-2 py-2 text-left font-sans text-xs text-chalk"
                            : "rounded-[3px] border border-willow/30 px-2 py-2 text-left font-sans text-xs text-willow"
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1 font-sans text-xs text-willow">Live overlay design</p>
                  <div className="grid max-h-56 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {OVERLAY_DESIGNS.map((design) => {
                      const selected = effectiveDesign === design.id;
                      return (
                        <button
                          key={design.id}
                          type="button"
                          disabled={orientation === "portrait" && design.id !== "minimal"}
                          onClick={() => pickDesign(design.id)}
                          className={
                            selected
                              ? "rounded-[3px] border-2 border-boundary bg-boundary/10 px-2 py-2 text-left"
                              : "rounded-[3px] border border-willow/30 px-2 py-2 text-left"
                          }
                        >
                          <span className="block font-sans text-xs font-semibold text-chalk">
                            {design.label}
                          </span>
                          <span className="mb-1 block font-sans text-[10px] text-willow">
                            {design.blurb}
                          </span>
                          <div className="pointer-events-none overflow-hidden rounded-[2px] border border-willow/20 bg-ink/60 p-1">
                            <div className="origin-top-left scale-[0.38] [width:263%]">
                              <TvScoreOverlay
                                state={previewState}
                                design={design.id}
                                showPlayerCard={false}
                                className="max-w-none"
                              />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label className="font-sans text-xs text-willow">
                  Zoom {zoom.toFixed(1)}x
                  <input
                    type="range"
                    min={1}
                    max={2}
                    step={0.1}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>

                <SelectField
                  label="Video quality"
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                >
                  <option value="480">480p (recommended)</option>
                  <option value="720">720p</option>
                  <option value="1080">1080p</option>
                </SelectField>

                <SocialStreamConnect
                  destination={destination}
                  streamKey={streamKey}
                  destinationName={destinationName}
                  onDestination={setDestination}
                  onStreamKey={setStreamKey}
                  onDestinationName={setDestinationName}
                  facebook={sessionQuery.data?.facebook}
                  matchId={matchId}
                  onFacebookChange={() => void sessionQuery.refetch()}
                />

                {matchId && (
                  <OverlayDirectorPanel matchId={matchId} graphics={state?.graphics} />
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {phase === "idle" || phase === "error" ? (
                    <Button onClick={() => void startCamera()}>Start camera</Button>
                  ) : null}
                  {(phase === "preview" || phase === "live") && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const wasLive = phase === "live";
                        const nextFacing = facing === "user" ? "environment" : "user";
                        setFacing(nextFacing);
                        void (async () => {
                          await startCamera({ facingMode: nextFacing });
                          if (wasLive && session?.whip_publish_url && streamRef.current && videoRef.current) {
                            try {
                              setPhase("connecting");
                              compositeRef.current?.stop();
                              const composed = startLivePublishStream({
                                video: videoRef.current,
                                cameraStream: streamRef.current,
                                overlayEl: () => overlayHudRef.current,
                                ...captureFrameSize(orientation !== "portrait"),
                                getFrame: () => ({
                                  state: overlayStateRef.current,
                                  snapshot: snapshotRef.current,
                                  tickerFallback: matchQuery.data?.match.title,
                                }),
                              });
                              compositeRef.current = composed;
                              await whipRef.current.restart(
                                composed.stream,
                                session.whip_publish_url,
                              );
                              setPhase("live");
                            } catch (err) {
                              setPhase("error");
                              setError(err instanceof Error ? err.message : "WHIP restart failed.");
                            }
                          }
                        })();
                      }}
                    >
                      Flip camera
                    </Button>
                  )}
                  {phase === "preview" && (
                    <>
                      {(destination === "youtube" || !sessionQuery.data?.facebook?.connected) && (
                        <Button
                          variant="secondary"
                          onClick={() => saveDestinations.mutate()}
                          loading={saveDestinations.isPending}
                        >
                          Save destination
                        </Button>
                      )}
                      <Button onClick={() => goLive.mutate()} loading={goLive.isPending}>
                        Go live
                      </Button>
                    </>
                  )}
                  {phase === "live" && (
                    <Button
                      variant="danger"
                      onClick={() => endLive.mutate()}
                      loading={endLive.isPending}
                    >
                      End live
                    </Button>
                  )}
                  {phase !== "idle" && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        void stopCamera().then(() => setPhase("idle"));
                      }}
                    >
                      Close camera
                    </Button>
                  )}
                </div>
                <p className="font-sans text-xs text-willow">
                  {phase === "idle"
                    ? "Preview locally, then Go live to WHIP-publish (needs public MediaMTX)."
                    : phase === "preview"
                      ? "Preview on. Overlay updates live."
                      : phase === "connecting"
                        ? "Connecting WHIP…"
                        : "Streaming live."}
                </p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
