/**
 * Browser WHIP publisher (WebRTC → MediaMTX).
 * POST offer SDP to whip_publish_url; reconnect with exponential backoff.
 */

export type WhipStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "stopped";

export type WhipStatusListener = (status: WhipStatus, detail?: string) => void;

export interface WhipPublisherOptions {
  /** Cap for reconnect delay (ms). Default 15s. */
  maxBackoffMs?: number;
  /** Initial reconnect delay (ms). Default 1s. */
  initialBackoffMs?: number;
  /** Max reconnect attempts before "failed". Default Infinity. */
  maxAttempts?: number;
}

export interface WhipPublisher {
  start(stream: MediaStream, whipUrl: string): Promise<void>;
  stop(): Promise<void>;
  /** Tear down and publish again (e.g. after flip / recovery). */
  restart(stream: MediaStream, whipUrl: string): Promise<void>;
  getStatus(): WhipStatus;
  onStatus(listener: WhipStatusListener): () => void;
}

function normalizeWhipUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return trimmed.endsWith("/whip") ? trimmed : `${trimmed}/whip`;
}

function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 8_000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    const timer = window.setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

async function postOffer(whipUrl: string, offerSdp: string): Promise<{ answer: string; resourceUrl: string | null }> {
  const res = await fetch(whipUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      Accept: "application/sdp",
    },
    body: offerSdp,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      text
        ? `WHIP publish failed (${res.status}): ${text.slice(0, 160)}`
        : `WHIP publish failed (${res.status}). Check MEDIAMTX_WHIP_BASE_URL is public HTTPS.`,
    );
  }
  const answer = await res.text();
  if (!answer.trim()) {
    throw new Error("WHIP server returned an empty SDP answer.");
  }
  const location = res.headers.get("Location");
  let resourceUrl: string | null = null;
  if (location) {
    try {
      resourceUrl = new URL(location, whipUrl).toString();
    } catch {
      resourceUrl = location;
    }
  }
  return { answer, resourceUrl };
}

export function createWhipPublisher(options: WhipPublisherOptions = {}): WhipPublisher {
  const maxBackoffMs = options.maxBackoffMs ?? 15_000;
  const initialBackoffMs = options.initialBackoffMs ?? 1_000;
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;

  let pc: RTCPeerConnection | null = null;
  let resourceUrl: string | null = null;
  let whipUrl: string | null = null;
  let mediaStream: MediaStream | null = null;
  let status: WhipStatus = "idle";
  let stopped = false;
  let reconnectTimer: number | null = null;
  let attempt = 0;
  const listeners = new Set<WhipStatusListener>();

  const setStatus = (next: WhipStatus, detail?: string) => {
    status = next;
    for (const listener of listeners) listener(next, detail);
  };

  const clearReconnect = () => {
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const teardownPc = async () => {
    clearReconnect();
    const session = resourceUrl;
    resourceUrl = null;
    if (session) {
      try {
        await fetch(session, { method: "DELETE" });
      } catch {
        /* ignore */
      }
    }
    if (pc) {
      try {
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        pc.close();
      } catch {
        /* ignore */
      }
      pc = null;
    }
  };

  const scheduleReconnect = () => {
    if (stopped || !whipUrl || !mediaStream) return;
    if (attempt >= maxAttempts) {
      setStatus("failed", "Connection lost. Tap Retry.");
      return;
    }
    const delay = Math.min(maxBackoffMs, initialBackoffMs * 2 ** attempt);
    attempt += 1;
    setStatus("reconnecting", `Reconnecting in ${Math.round(delay / 1000)}s…`);
    clearReconnect();
    reconnectTimer = window.setTimeout(() => {
      void connect(mediaStream!, whipUrl!, true);
    }, delay);
  };

  const attachStateWatchers = (connection: RTCPeerConnection) => {
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (stopped || connection !== pc) return;
      if (state === "connected") {
        attempt = 0;
        setStatus("connected");
      } else if (state === "failed" || state === "disconnected") {
        setStatus("reconnecting", "Connection lost");
        void teardownPc().then(scheduleReconnect);
      }
    };
  };

  const connect = async (stream: MediaStream, url: string, isReconnect: boolean) => {
    if (stopped) return;
    mediaStream = stream;
    whipUrl = normalizeWhipUrl(url);
    if (!whipUrl) {
      setStatus("failed", "No WHIP publish URL. Configure MediaMTX.");
      throw new Error("No WHIP publish URL.");
    }

    setStatus(isReconnect ? "reconnecting" : "connecting");
    await teardownPc();
    if (stopped) return;

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc = connection;
    attachStateWatchers(connection);

    for (const track of stream.getTracks()) {
      connection.addTrack(track, stream);
    }

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await waitIceComplete(connection);

    const localSdp = connection.localDescription?.sdp;
    if (!localSdp) {
      throw new Error("Failed to create WebRTC offer.");
    }

    try {
      const { answer, resourceUrl: resource } = await postOffer(whipUrl, localSdp);
      resourceUrl = resource;
      await connection.setRemoteDescription({ type: "answer", sdp: answer });
      attempt = 0;
      if (connection.connectionState === "connected") {
        setStatus("connected");
      } else {
        setStatus("connecting", "Negotiating…");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "WHIP publish failed.";
      await teardownPc();
      if (stopped) return;
      if (isReconnect || attempt > 0) {
        setStatus("reconnecting", message);
        scheduleReconnect();
        return;
      }
      setStatus("failed", message);
      throw err;
    }
  };

  return {
    async start(stream, url) {
      stopped = false;
      attempt = 0;
      await connect(stream, url, false);
    },

    async stop() {
      stopped = true;
      clearReconnect();
      await teardownPc();
      mediaStream = null;
      whipUrl = null;
      attempt = 0;
      setStatus("stopped");
    },

    async restart(stream, url) {
      stopped = false;
      attempt = 0;
      await connect(stream, url, false);
    },

    getStatus() {
      return status;
    },

    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
