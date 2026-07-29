/**
 * The HTTP layer.
 *
 * Three things matter here and nowhere else in the app:
 *
 * 1. Every failure arrives as an `ApiError` carrying the backend's machine
 *    `code`, so the scoring console can react to `wicket_illegal_on_free_hit`
 *    precisely instead of matching on prose.
 * 2. Access tokens live in memory only. The refresh token is the single value
 *    in storage, and a 401 triggers exactly one refresh no matter how many
 *    requests are in flight.
 * 3. Requests are bounded by a timeout, because a scorer on a weak signal must
 *    get an answer — even a failure — rather than a spinner that never ends.
 */

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");
export const API_BASE = `${RAW_BASE}/api/v1`;

const REFRESH_STORAGE_KEY = "pitchside.refresh";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** True when retrying the identical request could plausibly succeed. */
  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }

  /** True when the browser could not reach the API at all. */
  get isOffline(): boolean {
    return this.status === 0;
  }

  get isAuthFailure(): boolean {
    return this.status === 401;
  }

  /** Field-level validation messages, keyed by field path. */
  get fieldErrors(): Record<string, string> {
    const fields = this.details.fields;
    if (!Array.isArray(fields)) return {};
    const out: Record<string, string> = {};
    for (const entry of fields) {
      if (entry && typeof entry === "object") {
        const { field, message } = entry as { field?: string; message?: string };
        if (field && message) out[field] = message;
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------- token state

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let refreshInFlight: Promise<string | null> | null = null;

type AuthListener = (authenticated: boolean) => void;
const authListeners = new Set<AuthListener>();

export function onAuthChange(listener: AuthListener): () => void {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function announce(authenticated: boolean): void {
  for (const listener of authListeners) listener(authenticated);
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    // Private browsing modes can refuse storage; the session simply won't survive a reload.
    return null;
  }
}

function storeRefreshToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_STORAGE_KEY, token);
    else localStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function setSession(tokens: {
  access_token: string;
  expires_in: number;
  refresh_token: string | null;
}): void {
  accessToken = tokens.access_token;
  // Refresh a minute early so a long request never starts on a dying token.
  accessTokenExpiresAt = Date.now() + Math.max(0, tokens.expires_in - 60) * 1000;
  if (tokens.refresh_token) storeRefreshToken(tokens.refresh_token);
  announce(true);
}

export function clearSession(): void {
  accessToken = null;
  accessTokenExpiresAt = 0;
  storeRefreshToken(null);
  announce(false);
}

export function hasSession(): boolean {
  return accessToken !== null || getRefreshToken() !== null;
}

// ------------------------------------------------------------------- requests

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Send the bearer token. Defaults to true for non-public paths. */
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) return await response.text();
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function toApiError(status: number, payload: unknown): ApiError {
  const envelope = (payload ?? {}) as ApiErrorBody;
  const error = envelope.error ?? {};
  return new ApiError(
    status,
    error.code ?? "http_error",
    error.message ?? "The request failed. Please try again.",
    error.details ?? {},
    error.request_id,
  );
}

/** Refresh the access token. Concurrent callers share one network round-trip. */
async function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= (async () => {
    const refreshToken = getRefreshToken();
    try {
      const response = await fetch(buildUrl("/auth/refresh"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The token may instead be in an httpOnly cookie, hence `credentials`.
        credentials: "include",
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
      });
      if (!response.ok) {
        clearSession();
        return null;
      }
      const tokens = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token: string | null;
      };
      setSession(tokens);
      return tokens.access_token;
    } catch {
      // Network failure: keep the refresh token, the session may still be valid.
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function authHeader(): Promise<string | null> {
  if (accessToken && Date.now() < accessTokenExpiresAt) return accessToken;
  if (getRefreshToken() ?? accessToken) {
    const fresh = await refreshAccessToken();
    if (fresh) return fresh;
  }
  return accessToken;
}

async function send<T>(path: string, options: RequestOptions, retryOn401: boolean): Promise<T> {
  const { method = "GET", body, query, auth = true, signal, timeoutMs, headers } = options;

  const requestHeaders: Record<string, string> = { accept: "application/json", ...headers };
  if (body !== undefined) requestHeaders["content-type"] = "application/json";
  if (auth) {
    const token = await authHeader();
    if (token) requestHeaders.authorization = `Bearer ${token}`;
  }

  const timeout = AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: requestHeaders,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // Offline, DNS failure, or timeout: one shape for the whole app.
    throw new ApiError(
      0,
      "network_error",
      "Could not reach the server. Your work is saved on this device.",
      {},
      undefined,
    );
  }

  if (response.status === 401 && auth && retryOn401) {
    const fresh = await refreshAccessToken();
    if (fresh) return send<T>(path, options, false);
  }

  const payload = await parseBody(response);
  if (!response.ok) {
    const error = toApiError(response.status, payload);
    if (error.isAuthFailure && auth) clearSession();
    throw error;
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}) =>
    send<T>(path, { ...options, method: "GET" }, true),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, "method"> = {}) =>
    send<T>(path, { ...options, method: "POST", body }, true),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, "method"> = {}) =>
    send<T>(path, { ...options, method: "PATCH", body }, true),
  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, "method"> = {}) =>
    send<T>(path, { ...options, method: "PUT", body }, true),
  delete: <T>(path: string, options: Omit<RequestOptions, "method" | "body"> = {}) =>
    send<T>(path, { ...options, method: "DELETE" }, true),
  /** Unauthenticated read: public scorecards, tournament pages, tools. */
  public: <T>(path: string, options: Omit<RequestOptions, "auth"> = {}) =>
    send<T>(path, { ...options, auth: false }, false),
};
