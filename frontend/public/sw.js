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
 *   navigations      cache-first on the app shell, revalidated in the background,
 *                    so the scoring console opens with no signal at all
 *   /assets/*        cache-first and kept forever (the filenames are hashed)
 *   other GETs       network-first, falling back to the last good response
 *   anything else    passed straight through, untouched
 */

const VERSION = "v1";
const SHELL_CACHE = `pitchside-shell-${VERSION}`;
const ASSET_CACHE = `pitchside-assets-${VERSION}`;
const DATA_CACHE = `pitchside-data-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE]);

const SHELL_URL = "/index.html";
const SHELL_FILES = [SHELL_URL, "/", "/manifest.webmanifest", "/icons/seam.svg"];

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

  if (request.mode === "navigate") {
    event.respondWith(shell(request));
    return;
  }

  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, DATA_CACHE));
});

/**
 * Every route is client-rendered, so any navigation can be answered with the one
 * shell document. Serving it from cache first is what makes the console open
 * instantly at a ground with no signal; the network copy replaces it quietly.
 */
async function shell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match(SHELL_URL)) ?? (await cache.match("/"));

  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(SHELL_URL, response.clone());
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    void fresh;
    return cached;
  }
  return (await fresh) ?? Response.error();
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
    throw new Error("offline and nothing cached for this request");
  }
}
