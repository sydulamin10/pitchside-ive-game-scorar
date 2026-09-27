import type { CompactState } from "@/lib/api/types";
import { overlayBrandLogo, overlayBrandMode, overlayBrandName } from "@/lib/broadcast/overlayBrand";
import { activeSponsors, showCornerSponsor, showLogo } from "@/lib/broadcast/overlayRules";
import { cn } from "@/lib/utils";

export function OverlayBrandChip({
  state,
  className,
}: {
  state: CompactState | null;
  className?: string;
}) {
  const mode = overlayBrandMode(state);
  const name = overlayBrandName(state);
  const logo = overlayBrandLogo(state);
  if (!showLogo(state?.graphics) || mode === "none") return null;
  if (mode === "logo") {
    if (!logo) return null;
    return (
      <div
        className={cn(
          "pointer-events-none flex items-center rounded-[3px] border border-white/25 bg-ink/75 p-1.5 shadow-tile backdrop-blur-[2px]",
          className,
        )}
      >
        <img src={logo} alt="" className="h-[4.5rem] w-[4.5rem] rounded-[2px] object-contain" />
      </div>
    );
  }
  if (!name) return null;
  return (
    <div
      className={cn(
        "pointer-events-none flex max-w-[min(80vw,22rem)] items-center rounded-[3px] border border-white/25 bg-ink/75 px-3 py-2 text-chalk shadow-tile backdrop-blur-[2px]",
        className,
      )}
    >
      <p className="truncate font-sans text-[18px] font-bold tracking-wide uppercase">{name}</p>
    </div>
  );
}

export function OverlaySponsorChip({
  state,
  className,
}: {
  state: CompactState | null;
  className?: string;
}) {
  const urls = activeSponsors(state?.graphics);
  if (!showCornerSponsor(state?.graphics) || urls.length === 0) return null;
  return (
    <div
      className={cn(
        "pointer-events-none flex items-center rounded-[3px] border border-white/20 bg-ink/70 p-1.5 shadow-tile backdrop-blur-[2px]",
        className,
      )}
    >
      {urls.slice(0, 3).map((item) => (
        <img
          key={item.id}
          src={item.url}
          alt="Sponsor"
          className="h-16 max-w-[9rem] object-contain"
        />
      ))}
    </div>
  );
}
