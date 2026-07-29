import { CloudOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * The honest offline notice.
 *
 * A scorer who has lost signal needs to know that (a) the app noticed, and
 * (b) their taps are still being kept. Anything vaguer than that gets people
 * re-entering balls they have already scored.
 */
export function ConnectionBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-flip/40 bg-flip/15 px-4 py-2 font-sans text-xs text-flip"
    >
      <CloudOff aria-hidden="true" className="size-4" />
      Offline — balls are saved on this device and will sync when the signal returns.
    </div>
  );
}
