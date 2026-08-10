/**
 * Service worker registration — required for real home-screen / desktop PWA install.
 */

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        // Install prompt only appears once this document is controlled.
        if (
          !navigator.serviceWorker.controller &&
          !sessionStorage.getItem("pitchside.sw.reload")
        ) {
          sessionStorage.setItem("pitchside.sw.reload", "1");
          location.reload();
        }
      } catch {
        // Offline caching / installability unavailable; app still works.
      }
    })();
  });
}

export async function ensureServiceWorkerReady(timeoutMs = 4000): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return Boolean(navigator.serviceWorker.controller || (await navigator.serviceWorker.getRegistration()));
  } catch {
    return false;
  }
}
