/// <reference types="vite/client" />

/**
 * Public configuration, declared so the app reads it type-safely.
 *
 * Everything here ships to the browser in the bundle. Nothing secret belongs in a
 * `VITE_` variable — the backend holds the keys.
 */
interface Window {
  /** Set in `/runtime-config.js` so the API origin can change without a rebuild. Empty = same origin. */
  __PITCHSIDE_API_BASE_URL__?: string;
  /** Render origin for SSE. Used when REST goes through the cPanel /api proxy. */
  __PITCHSIDE_STREAM_BASE_URL__?: string;
}

interface ImportMetaEnv {
  /** Origin of the API, e.g. `https://api.example.com`. Empty means same-origin. */
  readonly VITE_API_BASE_URL?: string;
  /** Where `vite dev` proxies `/api` to. Development only. */
  readonly VITE_DEV_API_TARGET?: string;
  /** Shown on the legal pages so people have somewhere to write to. */
  readonly VITE_SUPPORT_EMAIL?: string;
}
