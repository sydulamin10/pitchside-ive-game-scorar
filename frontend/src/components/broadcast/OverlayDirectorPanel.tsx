import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { ImageUpload } from "@/components/media/ImageUpload";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { OVERLAY_DESIGNS, parseOverlayDesign } from "@/components/broadcast/overlayThemes";
import { matches } from "@/lib/api/endpoints";
import type {
  OverlayBrandMode,
  OverlayDirector,
  OverlayPanel,
  OverlaySponsor,
} from "@/lib/api/types";
import { CLOSE_ALL_PATCH, RESTORE_DEFAULT_PATCH, activeSponsors } from "@/lib/broadcast/overlayRules";
import { cn } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

const PANELS: Array<[OverlayPanel, string]> = [
  ["hidden", "Score only"],
  ["live", "Live"],
  ["scorecard", "Scorecard"],
  ["over", "Over analysis"],
  ["worm", "Worm graph"],
  ["runrate", "Run rate"],
  ["innings1", "1st innings"],
  ["innings2", "2nd innings"],
  ["squad", "Squads"],
  ["summary", "Match summary"],
  ["sponsor", "Sponsor on air"],
  ["clean", "Clean camera"],
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
  design: "icc",
  brand_mode: "name",
  brand_name: "",
  brand_logo_url: "",
  sponsor_logo_url: "",
  sponsor_on: false,
  sponsors: [],
  sponsor_layout: "corner",
  scorebar_on: true,
  logo_on: true,
  player_card_on: true,
  anim_four: true,
  anim_six: true,
  anim_wicket: true,
  anim_extras: true,
  anim_cue: "",
  clean: false,
  scorebar_pos: "bottom",
  logo_pos: "top-left",
  sponsor_pos: "top-right",
  deck_pos: "top",
};

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-[3px] border border-willow/20 px-2 py-1.5 font-sans text-xs text-willow-soft">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function PosButtons<T extends string>({
  value,
  options,
  disabled,
  onPick,
}: {
  value: T;
  options: Array<[T, string]>;
  disabled?: boolean;
  onPick: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([id, label]) => (
        <Button
          key={id}
          size="sm"
          type="button"
          variant={value === id ? "secondary" : "ghost"}
          disabled={disabled}
          onClick={() => onPick(id)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

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
  const current: OverlayDirector = { ...EMPTY, ...graphics };
  const [ticker, setTicker] = useState(current.ticker);
  const [brandName, setBrandName] = useState(current.brand_name ?? "");
  const design = parseOverlayDesign(current.design);
  const brandMode = current.brand_mode ?? (current.show_tournament === false ? "none" : "name");
  const sponsors = current.sponsors?.length ? current.sponsors : activeSponsors(current);

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

  const cue = (kind: string) => save.mutate({ anim_cue: `${kind}:${Date.now()}` });

  const setSponsors = (next: OverlaySponsor[]) => {
    const capped = next.slice(0, 6);
    const onAir = capped.filter((item) => item.on && item.url);
    save.mutate({
      sponsors: capped,
      sponsor_logo_url: onAir[0]?.url ?? "",
      sponsor_on: onAir.length > 0 ? current.sponsor_on || true : false,
    });
  };

  const moveSponsor = (index: number, dir: -1 | 1) => {
    const next = [...sponsors];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    const a = next[index];
    const b = next[swap];
    if (!a || !b) return;
    next[index] = b;
    next[swap] = a;
    setSponsors(next);
  };

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
        <Button
          size="sm"
          type="button"
          variant="secondary"
          disabled={save.isPending}
          onClick={() => save.mutate(CLOSE_ALL_PATCH)}
        >
          Close all overlays
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => save.mutate(RESTORE_DEFAULT_PATCH)}
        >
          Restore default
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PANELS.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            type="button"
            variant={current.panel === id ? "secondary" : "ghost"}
            disabled={save.isPending}
            onClick={() => save.mutate({ panel: id, clean: id === "clean" })}
            aria-pressed={current.panel === id}
          >
            {label}
          </Button>
        ))}
      </div>

      <div>
        <p className="mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Overlay control
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Toggle
            label="Live score bar"
            checked={current.scorebar_on !== false}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ scorebar_on: on, clean: false })}
          />
          <Toggle
            label="ODCC LIVE logo"
            checked={current.logo_on !== false}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ logo_on: on })}
          />
          <Toggle
            label="Highlight headline"
            checked={current.ticker_on}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ ticker_on: on })}
          />
          <Toggle
            label="Player card"
            checked={current.player_card_on !== false}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ player_card_on: on })}
          />
        </div>
      </div>

      <div>
        <p className="mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Animation control
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <Toggle
            label="4 animation"
            checked={current.anim_four !== false}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ anim_four: on })}
          />
          <Toggle
            label="6 animation"
            checked={current.anim_six !== false}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ anim_six: on })}
          />
          <Toggle
            label="Wicket animation"
            checked={current.anim_wicket !== false}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ anim_wicket: on })}
          />
          <Toggle
            label="Wide / no-ball"
            checked={current.anim_extras !== false}
            disabled={save.isPending}
            onChange={(on) => save.mutate({ anim_extras: on })}
          />
        </div>
        <p className="mt-2 mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Manual animation
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(["four", "six", "wicket", "wide", "no_ball"] as const).map((kind) => (
            <Button
              key={kind}
              size="sm"
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => cue(kind)}
            >
              {kind === "four" ? "4" : kind === "six" ? "6" : kind === "no_ball" ? "No ball" : kind === "wicket" ? "Wicket" : "Wide"}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Positions
        </p>
        <p className="mb-1 font-sans text-[0.62rem] text-willow-soft">Score bar</p>
        <PosButtons
          value={current.scorebar_pos ?? "bottom"}
          options={[
            ["top", "Top"],
            ["center", "Center"],
            ["bottom", "Bottom"],
          ]}
          disabled={save.isPending}
          onPick={(scorebar_pos) => save.mutate({ scorebar_pos })}
        />
        <p className="mt-2 mb-1 font-sans text-[0.62rem] text-willow-soft">Squad / cards</p>
        <PosButtons
          value={current.deck_pos ?? "top"}
          options={[
            ["top", "Top"],
            ["center", "Center"],
            ["bottom", "Bottom"],
          ]}
          disabled={save.isPending}
          onPick={(deck_pos) => save.mutate({ deck_pos })}
        />
        <p className="mt-2 mb-1 font-sans text-[0.62rem] text-willow-soft">Logo</p>
        <PosButtons
          value={current.logo_pos ?? "top-left"}
          options={[
            ["top-left", "Top left"],
            ["top-right", "Top right"],
            ["bottom-left", "Bottom left"],
            ["bottom-right", "Bottom right"],
          ]}
          disabled={save.isPending}
          onPick={(logo_pos) => save.mutate({ logo_pos })}
        />
        <p className="mt-2 mb-1 font-sans text-[0.62rem] text-willow-soft">Sponsor</p>
        <PosButtons
          value={current.sponsor_layout ?? "corner"}
          options={[
            ["corner", "Corner"],
            ["grid", "Grid"],
            ["fullscreen", "Full screen"],
          ]}
          disabled={save.isPending}
          onPick={(sponsor_layout) =>
            save.mutate({
              sponsor_layout,
              panel: sponsor_layout === "fullscreen" || sponsor_layout === "grid" ? "sponsor" : current.panel,
              sponsor_on: true,
            })
          }
        />
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
          onChange={(url) => save.mutate({ brand_logo_url: url, brand_mode: url ? "logo" : brandMode, show_tournament: Boolean(url) || brandMode !== "none" })}
          className="mt-2"
        />
      </div>

      <div>
        <p className="mb-1 font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
          Sponsors
        </p>
        <p className="mb-2 font-sans text-[0.68rem] text-willow-soft">
          Up to 6 logos. Put Sponsor on air for a large board, or keep them in the
          corner.
        </p>
        <div className="flex flex-col gap-3">
          {sponsors.map((item, index) => (
            <div key={item.id || index} className="rounded-[3px] border border-willow/20 p-2">
              <ImageUpload
                kind="generic"
                label={`Sponsor ${index + 1}`}
                value={item.url}
                onChange={(url) => {
                  const next = [...sponsors];
                  if (!url) {
                    setSponsors(next.filter((_, i) => i !== index));
                    return;
                  }
                  next[index] = { ...item, url, on: true };
                  setSponsors(next);
                }}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 font-sans text-xs text-willow-soft">
                  <input
                    type="checkbox"
                    checked={item.on !== false}
                    onChange={(event) => {
                      const next = [...sponsors];
                      next[index] = { ...item, on: event.target.checked };
                      setSponsors(next);
                    }}
                  />
                  On air
                </label>
                <Button size="sm" type="button" variant="ghost" disabled={index === 0} onClick={() => moveSponsor(index, -1)}>
                  Up
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  disabled={index === sponsors.length - 1}
                  onClick={() => moveSponsor(index, 1)}
                >
                  Down
                </Button>
              </div>
            </div>
          ))}
        </div>
        {sponsors.length < 6 ? (
          <ImageUpload
            kind="generic"
            label="Add another sponsor"
            value=""
            onChange={(url) => {
              if (!url) return;
              if (sponsors.length >= 6) return;
              setSponsors([
                ...sponsors,
                { id: `s${Date.now()}`, url, on: true },
              ]);
            }}
            className="mt-3"
          />
        ) : (
          <p className="mt-3 font-sans text-[0.68rem] text-willow-soft">Maximum 6 sponsors on a match.</p>
        )}
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
