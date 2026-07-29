/**
 * Service worker registration.
 *
 * The worker is hand-written (`public/sw.js`) rather than generated, because the
 * caching rules here are opinionated and worth reading: the app shell is served
 * cache-first so the console opens instantly with no signal, GET reads fall back
 * to the last response, and writes are never intercepted — the IndexedDB queue
 * owns offline writes, and a service worker replaying a POST would be a second,
 * competing source of truth.
 */

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // Only in production: a stale worker in dev is a debugging trap.
  if (import.meta.env.DEV) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // A blocked worker only costs offline caching; the app still works.
    });
  });
}
