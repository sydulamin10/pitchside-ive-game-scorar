import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";

import { cn } from "@/lib/utils";
import { isStandaloneDisplay } from "@/lib/pwaInstall";

/**
 * Previous-page control for the browser. Hidden in the installed app, where
 * the OS already supplies back navigation.
 */
export function HistoryBackButton({
  fallback = "/app",
  className,
}: {
  fallback?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  if (typeof window !== "undefined" && isStandaloneDisplay()) return null;

  return (
    <button
      type="button"
      aria-label="Go back"
      onClick={() => {
        if (window.history.length > 1) navigate(-1);
        else void navigate(fallback);
      }}
      className={cn(
        "tap inline-flex items-center gap-1 rounded-[2px] border border-willow/40 px-2 py-1.5",
        "font-sans text-xs font-semibold text-willow-soft hover:border-flip/60 hover:text-flip",
        className,
      )}
    >
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Back
    </button>
  );
}
