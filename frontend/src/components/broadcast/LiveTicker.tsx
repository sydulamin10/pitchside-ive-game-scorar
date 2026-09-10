import { cn } from "@/lib/utils";

/** Bottom headline that crawls while the ticker is on — including before the first ball. */
export function LiveTicker({
  text,
  enabled,
  fallback,
  className,
}: {
  text?: string | null;
  enabled?: boolean;
  fallback?: string | null;
  className?: string;
}) {
  const line = text?.trim() || fallback?.trim();
  if (!enabled || !line) return null;
  const loop = `${line}   ·   ${line}   ·   `;
  return (
    <div
      className={cn(
        "overflow-hidden border-y-2 border-flip/70 bg-ink/90 py-1.5 text-flip shadow-tile backdrop-blur-sm",
        className,
      )}
      role="marquee"
      aria-label={line}
    >
      <p className="animate-ticker font-sans text-[0.72rem] font-bold tracking-[0.16em] whitespace-nowrap uppercase">
        <span>{loop}</span>
        <span aria-hidden="true">{loop}</span>
      </p>
    </div>
  );
}
