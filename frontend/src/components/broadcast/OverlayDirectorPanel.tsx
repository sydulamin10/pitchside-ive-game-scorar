import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { ImageUpload } from "@/components/media/ImageUpload";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { OVERLAY_DESIGNS, parseOverlayDesign } from "@/components/broadcast/overlayThemes";
import { matches } from "@/lib/api/endpoints";
import type { OverlayBrandMode, OverlayDirector, OverlayPanel } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

const PANELS: Array<[OverlayPanel, string]> = [
  ["hidden", "Score only"],
  ["live", "Live"],
  ["scorecard", "Scorecard"],
  ["over", "Over analysis"],
  ["innings1", "1st innings"],
  ["innings2", "2nd innings"],
  ["squad", "Squads"],
  ["sponsor", "Sponsor on air"],
];

const BRAND: Array<[OverlayBrandMode, string]> = [
  ["none", "Nothing"],
  ["name", "Name"],
  ["logo", "Logo"],
];

const EMPTY: OverlayDirector = {
  panel: "hidden",
  ticker: "",
  ticker_on: false,
  show_tournament: true,
  design: "circle",
  brand_mode: "name",
  brand_name: "",
  brand_logo_url: "",
  sponsor_logo_url: "",
  sponsor_on: false,
};

export function OverlayDirectorPanel({
  matchId,
  graphics,
  className,
  saveFn,
}: {
  matchId?: string;
  graphics?: OverlayDirector | null;
  className?: string;
  saveFn?: (patch: Partial<OverlayDirector>) => Promise<unknown>;
}) {
  const current = graphics ?? EMPTY;
  const [ticker, setTicker] = useState(current.ticker);
  const [brandName, setBrandName] = useState(current.brand_name ?? "");
  const design = parseOverlayDesign(current.design);
  const brandMode = current.brand_mode ?? (current.show_tournament === false ? "none" : "name");

  useEffect(() => {
    setTicker(current.ticker);
  }, [current.ticker]);

  useEffect(() => {
    setBrandName(current.brand_name ?? "");
  }, [current.brand_name]);

  const save = useMutation({
    mutationFn: (patch: Partial<OverlayDirector>) => {
      if (saveFn) return saveFn(patch);
      if (!matchId) return Promise.reject(new Error("Missing match."));
      return matches.patchOverlay(matchId, patch);
    },
    onError: (err) => toastError(err, "Could not update the live overlay."),
    onSuccess: () => toast("Live overlay updated.", "success"),
  });

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
        On the live screen
      </p>
      <p className="font-sans text-[0.68rem] text-willow-soft">
        These controls change the camera phone and overlay at the same time: score design, corner
        name or logo, sponsor, scorecard and squad.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {PANELS.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            type="button"
            variant={current.panel === id ? "secondary" : "ghost"}
            disabled={save.isPending}
            onClick={() => save.mutate({ panel: id })}
            aria-pressed={current.panel === id}
          >
            {label}
          </Button>
        ))}
      </div>

      <div>
        <p className="mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Live score design
        </p>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {OVERLAY_DESIGNS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate({ design: item.id })}
              className={cn(
                "rounded-[3px] border px-2 py-1.5 text-left",
                design === item.id
                  ? "border-boundary bg-boundary/10"
                  : "border-willow/30 hover:border-willow/50",
              )}
            >
              <span className="block font-sans text-[0.7rem] font-semibold text-chalk">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Corner name or logo
        </p>
        <p className="mb-2 font-sans text-[0.68rem] text-willow-soft">
          Tournament match or a one-off — pick name, logo, or hide it. Live screen follows this
          instantly.
        </p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {BRAND.map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              type="button"
              variant={brandMode === id ? "secondary" : "ghost"}
              disabled={save.isPending}
              onClick={() => save.mutate({ brand_mode: id, show_tournament: id !== "none" })}
            >
              {label}
            </Button>
          ))}
        </div>
        <TextField
          label="Name on the live screen"
          value={brandName}
          onChange={(event) => setBrandName(event.target.value)}
          onBlur={() => {
            const next = brandName.trim();
            if (next === (current.brand_name ?? "").trim()) return;
            save.mutate({ brand_name: next });
          }}
          placeholder="Cup name, club gala, or leave blank for the tournament"
        />
        <ImageUpload
          kind="generic"
          label="Logo on the live screen"
          value={current.brand_logo_url}
          onChange={(url) => save.mutate({ brand_logo_url: url, brand_mode: "logo", show_tournament: true })}
          className="mt-2"
        />
      </div>

      <div>
        <p className="mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Sponsor logo
        </p>
        <p className="mb-2 font-sans text-[0.68rem] text-willow-soft">
          Same as squad and scorecard: upload here, then put Sponsor on air or keep it in the
          corner.
        </p>
        <ImageUpload
          kind="generic"
          label="Sponsor logo"
          value={current.sponsor_logo_url}
          onChange={(url) => save.mutate({ sponsor_logo_url: url, sponsor_on: true })}
        />
        <label className="mt-2 flex items-center gap-2 font-sans text-xs text-willow-soft">
          <input
            type="checkbox"
            checked={Boolean(current.sponsor_on)}
            onChange={(event) => save.mutate({ sponsor_on: event.target.checked })}
          />
          Keep sponsor in the corner
        </label>
      </div>

      <TextField
        label="Scrolling headline"
        value={ticker}
        onChange={(event) => setTicker(event.target.value)}
        onBlur={() => {
          const next = ticker.trim();
          if (next === current.ticker) return;
          save.mutate({ ticker: next, ticker_on: next.length > 0 ? true : current.ticker_on });
        }}
        placeholder="ODCC LIVE · Final at the Parade Ground"
      />
      <label className="flex items-center gap-2 font-sans text-xs text-willow-soft">
        <input
          type="checkbox"
          checked={current.ticker_on}
          onChange={(event) => save.mutate({ ticker_on: event.target.checked })}
        />
        Run the headline on the live screen
      </label>
    </div>
  );
}
