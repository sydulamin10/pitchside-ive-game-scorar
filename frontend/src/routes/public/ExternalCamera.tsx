/**
 * Public external-camera page: cameraman opens QR link, gets camera + live score overlay.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";

import { EventGraphics } from "@/components/broadcast/EventGraphics";
import {
  OVERLAY_DESIGNS,
  type OverlayDesignId,
} from "@/components/broadcast/overlayThemes";
import { Button } from "@/components/ui/Button";
import { EmptyState, Spinner } from "@/components/ui/Surface";
import { publicApi } from "@/lib/api/endpoints";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import { ScoreBar } from "@/routes/public/Overlay";
import { toast, toastError } from "@/store/toast";

type Phase = "idle" | "preview" | "live";

const DESIGN_KEY = "pitchside.camera.overlayDesign";

export default function ExternalCamera() {
  const { slug, token } = useParams<{ slug: string; token: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [error, setError] = useState<string | null>(null);
  const [overlayDesign, setOverlayDesign] = useState<OverlayDesignId>(() => {
    try {
      const saved = localStorage.getItem(DESIGN_KEY);
      const found = OVERLAY_DESIGNS.find((d) => d.id === saved);
      return found?.id ?? "circle";
    } catch {
      return "circle";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(DESIGN_KEY, overlayDesign);
    } catch {
      /* ignore */
    }
  }, [overlayDesign]);

  const invite = useQuery({
    queryKey: ["camera-invite", slug, token],
    queryFn: () => publicApi.camera(slug!, token!),
    enabled: Boolean(slug && token),
    refetchInterval: 8_000,
  });

  const { state } = useMatchStream(slug, { pollMs: 2_000 });

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    setError(null);
    stopCamera();
    try {
      if (slug && token) await publicApi.cameraClaim(slug, token);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("preview");
      toast("Camera ready. Overlay is live from the score.", "success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Camera denied.");
      toastError(err, "Could not open the camera.");
    }
  }, [facing, slug, token, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const goLive = useMutation({
    mutationFn: () => publicApi.cameraGoLive(slug!, token!),
    onSuccess: () => {
      setPhase("live");
      toast("You are live.", "success");
      void invite.refetch();
    },
    onError: (err) => toastError(err, "Could not go live."),
  });

  const endLive = useMutation({
    mutationFn: () => publicApi.cameraEnd(slug!, token!),
    onSuccess: () => {
      setPhase("preview");
      toast("Live ended.", "info");
      void invite.refetch();
    },
    onError: (err) => toastError(err, "Could not end live."),
  });

  if (invite.isLoading) return <Spinner label="Opening camera link" />;
  if (!invite.data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <EmptyState
          title="Camera link unavailable"
          description="The invite may have expired or the host ended the session."
        />
      </div>
    );
  }

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
          {phase === "idle" && <Button onClick={() => void startCamera()}>Start camera</Button>}
          {phase === "preview" && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFacing((f) => (f === "user" ? "environment" : "user"));
                  void startCamera();
                }}
              >
                Flip
              </Button>
              <Button size="sm" onClick={() => goLive.mutate()} loading={goLive.isPending}>
                Go live
              </Button>
            </>
          )}
          {phase === "live" && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => endLive.mutate()}
              loading={endLive.isPending}
            >
              End live
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p className="rounded-[3px] border border-boundary/40 px-3 py-2 font-sans text-sm text-boundary">
          {error}
        </p>
      )}

      <div className="relative aspect-[9/16] max-h-[70dvh] overflow-hidden rounded-[4px] border border-willow/30 bg-black sm:aspect-video sm:max-h-none">
        <video ref={videoRef} playsInline muted={phase !== "live"} className="h-full w-full object-cover" />
        {phase === "idle" && (
          <div className="absolute inset-0 grid place-items-center font-sans text-sm text-willow">
            No camera — tap Start camera
          </div>
        )}
        {phase === "live" && (
          <span className="absolute top-3 left-3 rounded-[2px] bg-boundary px-2 py-0.5 font-sans text-[10px] font-bold text-chalk uppercase">
            Live
          </span>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-2">
          {state?.score ? (
            <ScoreBar state={state} design={overlayDesign} className="max-w-full" />
          ) : null}
        </div>
        <EventGraphics state={state} />
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
        {invite.data.whip_publish_url ? ` · WHIP ready` : ""}
      </p>
    </div>
  );
}
