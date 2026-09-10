import type { CompactState } from "@/lib/api/types";
import { overlayBrandLogo, overlayBrandMode, overlayBrandName } from "@/lib/broadcast/overlayBrand";
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
  if (mode === "none") return null;
  if (mode === "logo") {
    if (!logo) return null;
    return (
      <div
        className={cn(
          "pointer-events-none flex items-center rounded-[3px] border border-white/25 bg-ink/75 p-1 shadow-tile backdrop-blur-[2px]",
          className,
        )}
      >
        <img src={logo} alt="" className="h-9 w-9 rounded-[2px] object-contain" />
      </div>
    );
  }
  if (!name) return null;
  return (
    <div
      className={cn(
        "pointer-events-none flex max-w-[min(72vw,16rem)] items-center rounded-[3px] border border-white/25 bg-ink/75 px-2 py-1.5 text-chalk shadow-tile backdrop-blur-[2px]",
        className,
      )}
    >
      <p className="truncate font-sans text-[11px] font-bold tracking-wide uppercase">{name}</p>
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
  const url = state?.graphics?.sponsor_logo_url?.trim();
  if (!state?.graphics?.sponsor_on || !url) return null;
  if (state.graphics.panel === "sponsor") return null;
  return (
    <div
      className={cn(
        "pointer-events-none flex items-center rounded-[3px] border border-white/20 bg-ink/70 p-1 shadow-tile backdrop-blur-[2px]",
        className,
      )}
    >
      <img src={url} alt="Sponsor" className="h-9 max-w-[7rem] object-contain" />
    </div>
  );
}
