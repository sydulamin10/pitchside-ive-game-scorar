import { useEffect } from "react";

import { Spinner } from "@/components/ui/Surface";
import { API_ORIGIN } from "@/lib/api/client";

/** Facebook Login returns here on odcc.live so App Domains only need the website. */
export default function FacebookOAuthReturn() {
  useEffect(() => {
    const origin = API_ORIGIN || "https://api.odcc.live";
    window.location.replace(
      `${origin}/api/v1/public/social/facebook/callback${window.location.search}`,
    );
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-ink px-4">
      <Spinner label="Returning from Facebook" />
      <p className="font-sans text-sm text-willow-soft">Returning from Facebook…</p>
    </div>
  );
}
