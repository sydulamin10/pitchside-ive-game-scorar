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

export interface WhipPublishTuning {
  /** Target video ceiling (bps). Default 2.5 Mbps (720p30 cricket). */
  maxVideoBitrateBps?: number;
  /** Target framerate. Default 30. */
  maxFramerate?: number;
  /** Target audio bitrate (bps). Default 128 kbps. */
  maxAudioBitrateBps?: number;
}

export interface WhipPublisher {
  start(stream: MediaStream, whipUrl: string, tuning?: WhipPublishTuning): Promise<void>;
  stop(): Promise<void>;
  /** Tear down and publish again (e.g. after flip / recovery). */
  restart(stream: MediaStream, whipUrl: string, tuning?: WhipPublishTuning): Promise<void>;
  getStatus(): WhipStatus;
  onStatus(listener: WhipStatusListener): () => void;
}

export function videoBitrateForHeight(height: number): number {
  if (height >= 1080) return 3_800_000;
  if (height <= 480) return 1_400_000;
  return 2_500_000;
}

function normalizeWhipUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  return trimmed.endsWith("/whip") ? trimmed : `${trimmed}/whip`;
}

/** Phones on the public site cannot reach MediaMTX on the scorer's localhost. */
export function isUnreachableLoopbackWhip(whipUrl: string, pageHostname = window.location.hostname): boolean {
  try {
    const host = new URL(whipUrl).hostname;
    const targetLoopback = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    const pageLocal = pageHostname === "localhost" || pageHostname === "127.0.0.1" || pageHostname === "[::1]";
    return targetLoopback && !pageLocal;
  } catch {
    return false;
  }
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

function preferH264(connection: RTCPeerConnection): void {
  const caps = RTCRtpSender.getCapabilities?.("video");
  if (!caps?.codecs?.length) return;
  const h264 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === "video/h264");
  const constrained = h264.filter((c) =>
    (c.sdpFmtpLine ?? "").toLowerCase().includes("42e01f"),
  );
  const otherH264 = h264.filter(
    (c) => !(c.sdpFmtpLine ?? "").toLowerCase().includes("42e01f"),
  );
  const preferred = [
    ...constrained,
    ...otherH264,
    ...caps.codecs.filter((c) => c.mimeType.toLowerCase() !== "video/h264"),
  ];
  for (const transceiver of connection.getTransceivers()) {
    if (transceiver.sender.track?.kind === "video") {
      try {
        transceiver.setCodecPreferences(preferred);
      } catch {
        /* Safari may reject mixed codec lists */
      }
    }
  }
}

async function tuneRtpSenders(
  connection: RTCPeerConnection,
  tuning: WhipPublishTuning = {},
): Promise<void> {
  const maxVideoBitrate = tuning.maxVideoBitrateBps ?? 2_500_000;
  const maxFramerate = tuning.maxFramerate ?? 30;
  const maxAudioBitrate = tuning.maxAudioBitrateBps ?? 128_000;
  for (const sender of connection.getSenders()) {
    if (typeof sender.getParameters !== "function" || typeof sender.setParameters !== "function") {
      continue;
    }
    const kind = sender.track?.kind;
    if (kind !== "video" && kind !== "audio") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      if (kind === "video") {
        params.degradationPreference = "maintain-framerate";
        for (const enc of params.encodings) {
          enc.maxBitrate = maxVideoBitrate;
          enc.maxFramerate = maxFramerate;
          enc.scaleResolutionDownBy = 1;
        }
      } else {
        for (const enc of params.encodings) {
          enc.maxBitrate = maxAudioBitrate;
        }
      }
      await sender.setParameters(params);
    } catch {
      /* Older mobile browsers ignore unsupported encoding fields */
    }
  }
}

function requestVideoKeyFrame(connection: RTCPeerConnection): void {
  for (const sender of connection.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    const keyed = sender as RTCRtpSender & { generateKeyFrame?: () => Promise<void> };
    if (typeof keyed.generateKeyFrame === "function") {
      void keyed.generateKeyFrame().catch(() => undefined);
    }
  }
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
  let lastTuning: WhipPublishTuning | undefined;
  let status: WhipStatus = "idle";
  let stopped = false;
  let reconnectTimer: number | null = null;
  let keyframeTimer: number | null = null;
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

  const clearKeyframes = () => {
    if (keyframeTimer != null) {
      window.clearInterval(keyframeTimer);
      keyframeTimer = null;
    }
  };

  const startKeyframeCadence = (connection: RTCPeerConnection) => {
    clearKeyframes();
    requestVideoKeyFrame(connection);
    keyframeTimer = window.setInterval(() => {
      if (stopped || pc !== connection || connection.connectionState !== "connected") return;
      requestVideoKeyFrame(connection);
    }, 2_000);
  };

  const teardownPc = async () => {
    clearReconnect();
    clearKeyframes();
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
      void connect(mediaStream!, whipUrl!, true, lastTuning);
    }, delay);
  };

  const attachStateWatchers = (connection: RTCPeerConnection) => {
    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (stopped || connection !== pc) return;
      if (state === "connected") {
        attempt = 0;
        setStatus("connected");
        void tuneRtpSenders(connection, lastTuning);
        startKeyframeCadence(connection);
      } else if (state === "failed" || state === "disconnected") {
        clearKeyframes();
        setStatus("reconnecting", "Connection lost");
        void teardownPc().then(scheduleReconnect);
      }
    };
  };

  const connect = async (
    stream: MediaStream,
    url: string,
    isReconnect: boolean,
    tuning?: WhipPublishTuning,
  ) => {
    if (stopped) return;
    mediaStream = stream;
    lastTuning = tuning;
    whipUrl = normalizeWhipUrl(url);
    if (!whipUrl) {
      setStatus("failed", "No WHIP publish URL. Configure MediaMTX.");
      throw new Error("No WHIP publish URL.");
    }
    if (isUnreachableLoopbackWhip(whipUrl)) {
      const message =
        "Camera server is localhost. Set MEDIAMTX_WHIP_BASE_URL to a public HTTPS MediaMTX host — Render cannot receive phone video.";
      setStatus("failed", message);
      throw new Error(message);
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
    preferH264(connection);
    requestVideoKeyFrame(connection);

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
      await tuneRtpSenders(connection, lastTuning);
      attempt = 0;
      if (connection.connectionState === "connected") {
        setStatus("connected");
        startKeyframeCadence(connection);
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
    async start(stream, url, tuning) {
      stopped = false;
      attempt = 0;
      await connect(stream, url, false, tuning);
    },

    async stop() {
      stopped = true;
      clearReconnect();
      clearKeyframes();
      await teardownPc();
      mediaStream = null;
      whipUrl = null;
      lastTuning = undefined;
      attempt = 0;
      setStatus("stopped");
    },

    async restart(stream, url, tuning) {
      stopped = false;
      attempt = 0;
      await connect(stream, url, false, tuning);
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
