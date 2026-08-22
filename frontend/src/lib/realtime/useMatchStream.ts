/**
 * The live feed for a match.
 *
 * Server-sent events are the primary transport, with a polling fallback for the
 * cases that genuinely happen in the field: a corporate proxy that strips
 * `text/event-stream`, a browser that has run out of connections to the origin,
 * or a phone that just lost its signal.
 *
 * `state_version` is monotonic per match, so a gap in versions means a frame was
 * missed and the caller is told to refetch the full scorecard rather than render
 * a score that quietly drifted.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { API_BASE, STREAM_BASE } from "@/lib/api/client";
import type { CompactState } from "@/lib/api/types";

export type StreamStatus = "connecting" | "live" | "polling" | "offline";

interface Envelope {
  type?: string;
  match_id?: string;
  state_version?: number;
  data?: CompactState;
}

interface StreamOptions {
  /** Called when a version gap or an explicit resync means "refetch everything". */
  onResync?: () => void;
  /** Poll interval used when SSE is unavailable. */
  pollMs?: number;
  enabled?: boolean;
}

interface StreamResult {
  state: CompactState | null;
  status: StreamStatus;
  /** Epoch ms of the last frame received, for the "updated Xs ago" line. */
  updatedAt: number | null;
}

const MAX_SSE_FAILURES = 3;

function readFrame(raw: string): CompactState | null {
  try {
    const parsed = JSON.parse(raw) as Envelope | CompactState;
    if (parsed && typeof parsed === "object" && "data" in parsed && parsed.data) {
      return parsed.data;
    }
    return parsed as CompactState;
  } catch {
    return null;
  }
}

export function useMatchStream(
  slug: string | undefined,
  options: StreamOptions = {},
): StreamResult {
  const { onResync, pollMs = 5_000, enabled = true } = options;

  const [state, setState] = useState<CompactState | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const versionRef = useRef<number>(-1);
  const failuresRef = useRef(0);

  // The callback is held in a ref so a caller passing an inline function does not
  // tear the connection down and rebuild it on every render.
  const resyncRef = useRef(onResync);
  useEffect(() => {
    resyncRef.current = onResync;
  }, [onResync]);

  const accept = useCallback((frame: CompactState | null) => {
    if (!frame || typeof frame.state_version !== "number") return;
    const previous = versionRef.current;
    // Frames can arrive out of order across a reconnect; never go backwards.
    if (frame.state_version < previous) return;
    if (previous >= 0 && frame.state_version > previous + 1) {
      resyncRef.current?.();
    }
    versionRef.current = frame.state_version;
    setState(frame);
    setUpdatedAt(Date.now());
  }, []);

  useEffect(() => {
    if (!slug || !enabled) return;

    let disposed = false;
    let source: EventSource | null = null;
    let pollTimer: number | undefined;
    let reconnectTimer: number | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/public/matches/${slug}/state`, {
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        accept((await response.json()) as CompactState);
        if (!disposed) setStatus("polling");
      } catch {
        if (!disposed) setStatus("offline");
      }
    };

    const startPolling = () => {
      if (disposed || pollTimer !== undefined) return;
      setStatus("polling");
      void poll();
      pollTimer = window.setInterval(() => void poll(), pollMs);
    };

    const connect = () => {
      if (disposed) return;
      setStatus((current) => (current === "live" ? current : "connecting"));
      source = new EventSource(`${STREAM_BASE}/stream/matches/${slug}`);

      const onFrame = (event: MessageEvent<string>) => {
        failuresRef.current = 0;
        setStatus("live");
        accept(readFrame(event.data));
      };

      source.onmessage = onFrame;
      source.addEventListener("score.update", onFrame);
      source.addEventListener("match.updated", onFrame);
      source.addEventListener("innings.changed", onFrame);
      source.addEventListener("match.completed", onFrame);
      source.addEventListener("resync", () => resyncRef.current?.());
      source.addEventListener("reconnect", () => {
        // The server caps stream duration on purpose; reconnect immediately.
        source?.close();
        source = null;
        connect();
      });

      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        failuresRef.current += 1;
        if (failuresRef.current >= MAX_SSE_FAILURES) {
          startPolling();
          return;
        }
        // Back off: 1s, 2s, 4s. A ground full of phones must not stampede.
        const delay = 1_000 * 2 ** (failuresRef.current - 1);
        setStatus("connecting");
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    if (typeof EventSource === "undefined") startPolling();
    else connect();

    const onOnline = () => {
      failuresRef.current = 0;
      if (pollTimer !== undefined) {
        window.clearInterval(pollTimer);
        pollTimer = undefined;
      }
      source?.close();
      source = null;
      connect();
      resyncRef.current?.();
    };
    const onOffline = () => setStatus("offline");

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [slug, enabled, pollMs, accept]);

  return { state, status, updatedAt };
}
