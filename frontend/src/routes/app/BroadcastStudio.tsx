/**
 * Go Live studio: this-device camera preview + shareable FB/YouTube overlay link/QR.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { EventGraphics } from "@/components/broadcast/EventGraphics";
import {
  OVERLAY_DESIGNS,
  type OverlayDesignId,
} from "@/components/broadcast/overlayThemes";
import { QrCode } from "@/components/broadcast/QrCode";
import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { broadcast as broadcastApi, matches as matchesApi } from "@/lib/api/endpoints";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { copyToClipboard } from "@/lib/utils";
import { ScoreBar } from "@/routes/public/Overlay";
import { toast, toastError } from "@/store/toast";

type Phase = "idle" | "preview" | "live";
type Tab = "overlay" | "device";
type Orientation = "landscape" | "portrait";

const YOUTUBE_RTMP = "rtmps://a.rtmp.youtube.com/live2";
const FACEBOOK_RTMP = "rtmps://live-api-s.facebook.com:443/rtmp/";

export default function BroadcastStudio() {
  const { matchId } = useParams<{ matchId: string }>();
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [tab, setTab] = useState<Tab>("overlay");
  const [phase, setPhase] = useState<Phase>("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [overlayDesign, setOverlayDesign] = useState<OverlayDesignId>("circle");
  const [zoom, setZoom] = useState(1);
  const [quality, setQuality] = useState("480");
  const [platform, setPlatform] = useState<"youtube" | "facebook">("youtube");
  const [streamKey, setStreamKey] = useState("");
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [audioDeviceId, setAudioDeviceId] = useState("");

  const matchQuery = useQuery({
    queryKey: ["match", matchId],
    queryFn: () => matchesApi.get(matchId!),
    enabled: Boolean(matchId),
  });

  const sessionQuery = useQuery({
    queryKey: ["stream-session", matchId],
    queryFn: () => broadcastApi.ensure(matchId!),
    enabled: Boolean(matchId) && tab === "device",
    retry: 1,
  });

  const slug = matchQuery.data?.match.slug;
  const { state } = useMatchStream(slug, { pollMs: 2_000 });
  const session = sessionQuery.data;
  const effectiveDesign: OverlayDesignId =
    orientation === "portrait" ? "minimal" : overlayDesign;

  const webOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const overlayUrl = slug
    ? `${webOrigin}/s/${slug}/overlay?design=${effectiveDesign}&position=bottom`
    : null;

  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then((devices) => {
      setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
      setAudioDevices(devices.filter((d) => d.kind === "audioinput"));
    });
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    stopCamera();
    try {
      const height = quality === "720" ? 720 : quality === "1080" ? 1080 : 480;
      const width = Math.round((height * 16) / 9);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioDeviceId ? { deviceId: { ideal: audioDeviceId } } : true,
        video: {
          ...(videoDeviceId
            ? { deviceId: { ideal: videoDeviceId } }
            : { facingMode: { ideal: facing } }),
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
      setError(err instanceof Error ? err.message : "Camera permission denied.");
      toastError(err, "Could not open the camera.");
    }
  }, [audioDeviceId, facing, quality, stopCamera, videoDeviceId]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["stream-session", matchId] });

  const saveDestinations = useMutation({
    mutationFn: async () => {
      const rtmp = platform === "youtube" ? YOUTUBE_RTMP : FACEBOOK_RTMP;
      const input = {
        destination_label: platform === "youtube" ? "YouTube" : "Facebook",
        rtmp_url: rtmp,
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
      if (!session) await broadcastApi.ensure(matchId!);
      if (streamKey) {
        await broadcastApi.updateDestinations(matchId!, {
          destination_label: platform === "youtube" ? "YouTube" : "Facebook",
          rtmp_url: platform === "youtube" ? YOUTUBE_RTMP : FACEBOOK_RTMP,
          stream_key: streamKey,
        });
      }
      return broadcastApi.goLive(matchId!);
    },
    onSuccess: () => {
      invalidate();
      setPhase("live");
      toast("Live.", "success");
    },
    onError: (err) => toastError(err, "Could not go live."),
  });

  const endLive = useMutation({
    mutationFn: () => broadcastApi.end(matchId!),
    onSuccess: () => {
      invalidate();
      setPhase("preview");
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
        <div>
          <Link
            to={`/app/matches/${matchId}`}
            className="font-sans text-xs text-willow hover:text-chalk"
          >
            ← Scoring console
          </Link>
          <h1 className="font-sans text-lg font-semibold text-chalk">Go Live</h1>
          <p className="font-sans text-xs text-willow">{matchQuery.data.match.title}</p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setTab("overlay")}
          className={
            tab === "overlay"
              ? "rounded-[3px] border-2 border-boundary bg-boundary/20 px-3 py-3 font-sans text-sm font-semibold text-chalk"
              : "rounded-[3px] border border-willow/30 px-3 py-3 font-sans text-sm text-willow"
          }
        >
          FB / YouTube overlay
        </button>
        <button
          type="button"
          onClick={() => setTab("device")}
          className={
            tab === "device"
              ? "rounded-[3px] border-2 border-boundary bg-boundary/20 px-3 py-3 font-sans text-sm font-semibold text-chalk"
              : "rounded-[3px] border border-willow/30 px-3 py-3 font-sans text-sm text-willow"
          }
        >
          This device
        </button>
      </div>

      {tab === "overlay" ? (
        <Panel>
          <SectionTitle>Add score overlay to Facebook / YouTube Live</SectionTitle>
          <Seam className="my-3" />
          <p className="mb-3 font-sans text-sm text-willow">
            Copy this link or scan the QR. Paste it as a <strong className="text-chalk">Browser
            source</strong> / graphics layer in Facebook Live Producer, YouTube Studio, OBS,
            Prism Live, or Streamlabs. Transparent background — sits on top of your camera.
            Score updates live from the scorer.
          </p>

          <div className="mb-4">
            <p className="mb-1 font-sans text-xs text-willow">Overlay design</p>
            <div className="grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {OVERLAY_DESIGNS.map((design) => (
                <button
                  key={design.id}
                  type="button"
                  onClick={() => setOverlayDesign(design.id)}
                  className={
                    overlayDesign === design.id
                      ? "rounded-[3px] border-2 border-boundary px-2 py-2 text-left"
                      : "rounded-[3px] border border-willow/30 px-2 py-2 text-left"
                  }
                >
                  <span className="block font-sans text-xs font-semibold text-chalk">
                    {design.label}
                  </span>
                  <span className="block font-sans text-[10px] text-willow">{design.blurb}</span>
                </button>
              ))}
            </div>
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
                </div>

                <ol className="mt-4 list-decimal space-y-2 pl-4 font-sans text-xs text-willow">
                  <li>
                    <span className="text-chalk">Facebook:</span> Live Producer → Sources → Add
                    browser source → paste link → width 1920, height 220 → Go Live.
                  </li>
                  <li>
                    <span className="text-chalk">YouTube:</span> Studio → Go Live → stream software
                    (OBS / Streamlabs) → Browser source with this link.
                  </li>
                  <li>
                    <span className="text-chalk">Phone apps</span> (Prism Live, Streamlabs Mobile):
                    scan QR or paste link as web/browser overlay layer on your live scene.
                  </li>
                </ol>
                <p className="mt-3 font-sans text-[10px] text-willow">
                  Tip: for a phone on the same Wi‑Fi, open Pitchside with your PC Network URL first
                  so the QR encodes a reachable address (not only localhost).
                </p>
              </div>
            </div>
          )}

          {state?.score && (
            <div className="mt-4 rounded-[4px] border border-willow/20 bg-ink/80 p-3">
              <p className="mb-2 font-sans text-[10px] tracking-wide text-willow uppercase">
                Live preview
              </p>
              <ScoreBar state={state} design={overlayDesign} className="max-w-full" />
            </div>
          )}
        </Panel>
      ) : (
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
                muted={phase !== "live"}
                className="h-full w-full object-cover"
                style={{ transform: `scale(${zoom})` }}
              />
              {phase === "idle" && (
                <div className="absolute inset-0 grid place-items-center font-sans text-sm text-willow">
                  No camera
                </div>
              )}
              {phase === "live" && (
                <span className="absolute top-3 left-3 rounded-[2px] bg-boundary px-2 py-0.5 font-sans text-[10px] font-bold text-chalk uppercase">
                  Live
                </span>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-2">
                {state?.score ? (
                  <ScoreBar
                    state={state}
                    design={effectiveDesign}
                    className="max-w-full"
                  />
                ) : null}
              </div>
              <EventGraphics state={state} />
            </div>

            <Panel>
              <SectionTitle>Camera & stream</SectionTitle>
              <Seam className="my-3" />
              <div className="flex flex-col gap-3">
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
                  <div className="grid max-h-48 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {OVERLAY_DESIGNS.map((design) => (
                      <button
                        key={design.id}
                        type="button"
                        disabled={orientation === "portrait" && design.id !== "minimal"}
                        onClick={() => setOverlayDesign(design.id)}
                        className={
                          effectiveDesign === design.id
                            ? "rounded-[3px] border-2 border-boundary px-2 py-2 text-left"
                            : "rounded-[3px] border border-willow/30 px-2 py-2 text-left"
                        }
                      >
                        <span className="block font-sans text-xs font-semibold text-chalk">
                          {design.label}
                        </span>
                        <span className="block font-sans text-[10px] text-willow">{design.blurb}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 font-sans text-[10px] text-willow">
                    Portrait streams force Minimal. OBS:{" "}
                    <Link
                      className="text-flip hover:underline"
                      to={`/s/${slug}/overlay?design=${effectiveDesign}`}
                      target="_blank"
                    >
                      /overlay?design={effectiveDesign}
                    </Link>
                  </p>
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

                <SelectField
                  label="Stream to"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as "youtube" | "facebook")}
                >
                  <option value="youtube">YouTube</option>
                  <option value="facebook">Facebook</option>
                </SelectField>
                <TextField
                  label={platform === "youtube" ? "YouTube stream key" : "Facebook stream key"}
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  placeholder="Paste your stream key"
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  {phase === "idle" && (
                    <Button onClick={() => void startCamera()}>Start camera</Button>
                  )}
                  {phase === "preview" && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setFacing((f) => (f === "user" ? "environment" : "user"));
                          void startCamera();
                        }}
                      >
                        Flip camera
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => saveDestinations.mutate()}
                        loading={saveDestinations.isPending}
                      >
                        Save destination
                      </Button>
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
                        stopCamera();
                        setPhase("idle");
                      }}
                    >
                      Close camera
                    </Button>
                  )}
                </div>
                <p className="font-sans text-xs text-willow">
                  {phase === "idle"
                    ? "Ready. Start camera then Go Live."
                    : phase === "preview"
                      ? "Preview on. Overlay updates live."
                      : "Streaming live."}
                </p>
                <p className="font-sans text-xs text-willow">
                  OBS overlay:{" "}
                  <Link
                    className="text-flip hover:underline"
                    to={`/s/${slug}/overlay?design=${effectiveDesign}`}
                    target="_blank"
                  >
                    /s/{slug}/overlay?design={effectiveDesign}
                  </Link>
                </p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
