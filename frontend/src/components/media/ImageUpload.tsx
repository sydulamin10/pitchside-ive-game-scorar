import { useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { media } from "@/lib/api/endpoints";
import { cn } from "@/lib/utils";
import { toastError } from "@/store/toast";

type Kind = "team_logo" | "team_cover" | "player_photo" | "player_cover" | "generic";

export function ImageUpload({
  kind,
  value,
  onChange,
  label,
  className,
  round,
}: {
  kind: Kind;
  value: string | null | undefined;
  onChange: (url: string) => void;
  label: string;
  className?: string;
  round?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const url = await media.uploadFile(file, kind);
      onChange(url);
    } catch (error) {
      toastError(error, "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="font-sans text-xs tracking-wide text-willow uppercase">{label}</span>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-20 w-20 items-center justify-center overflow-hidden border border-willow/30 bg-ink/40",
            round ? "rounded-full" : "rounded-[4px]",
          )}
        >
          {value ? (
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="font-sans text-[10px] text-willow">No image</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {value ? "Replace" : "Upload"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
        </div>
      </div>
    </div>
  );
}
