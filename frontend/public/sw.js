/*
 * Pitchside service worker.
 *
 * Hand-written on purpose. A generated worker would precache every hashed build
 * asset, which is fine, but it would also tempt us into intercepting writes —
 * and offline writes here belong to the IndexedDB queue in the app, which knows
 * about client event ids, ordering and duplicate detection. A worker replaying a
 * POST would be a second, competing source of truth for the score.
 *
 * The rules, in one place:
 *
 *   navigations      network-first on the app shell, cached fallback offline
 *   SPA paths        same as navigations (`/app/matches/new` is not a data API)
 *   /assets/*        cache-first and kept forever (the filenames are hashed)
 *   other GETs       network-first, falling back to the last good response
 *   anything else    passed straight through, untouched
 */

const VERSION = "v6";
const SHELL_CACHE = `pitchside-shell-${VERSION}`;
const ASSET_CACHE = `pitchside-assets-${VERSION}`;
const DATA_CACHE = `pitchside-data-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE]);

const SHELL_URL = "/index.html";
const SHELL_FILES = [
  SHELL_URL,
  "/",
  "/app",
  "/manifest.webmanifest",
  "/branding/odcc-live.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];


self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One failing file must not fail the whole install, so add them singly.
      await Promise.all(
        SHELL_FILES.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {}),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !KEEP.has(name)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Writes, streams and cross-origin traffic are none of our business.
  if (request.method !== "GET") return;
  if (request.headers.get("accept") === "text/event-stream") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // Client-side routes have no file extension. Chrome sometimes fetches them
  // with mode !== "navigate"; treating that as data makes Start Match look offline.
  const last = url.pathname.split("/").pop() ?? "";
  if (request.mode === "navigate" || !last.includes(".")) {
    event.respondWith(shell(request));
    return;
  }

  event.respondWith(networkFirst(request, DATA_CACHE));
});

/**
 * Prefer the network shell so a deploy's new index.html (and hashed JS with the
 * correct API URL) is picked up immediately. Fall back to cache only offline.
 */
async function shell(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) void cache.put(SHELL_URL, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(SHELL_URL)) ??
      (await cache.match("/")) ??
      Response.error()
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Opaque and error responses are not worth keeping.
    if (response.ok && response.type === "basic") void cache.put(request, response.clone());
    return response;
  } catch {
    return cached ?? Response.error();
  }
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") void cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}
