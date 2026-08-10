/**
 * Client-side QR (PNG data URL) — reliable display without depending on API SVG.
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { cn } from "@/lib/utils";

export function QrCode({
  value,
  size = 176,
  className,
  label = "QR code",
}: {
  value: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: size * 2,
      color: { dark: "#0a1f14", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-[2px] border border-willow/30 bg-chalk p-2 font-sans text-[10px] text-ink",
          className,
        )}
        style={{ width: size, height: size }}
      >
        QR unavailable
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={cn("animate-pulse rounded-[2px] border border-willow/30 bg-chalk/80", className)}
        style={{ width: size, height: size }}
        aria-busy
      />
    );
  }

  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      className={cn("rounded-[2px] border border-willow/30 bg-chalk p-1", className)}
    />
  );
}
