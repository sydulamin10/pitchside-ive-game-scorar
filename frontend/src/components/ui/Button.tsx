import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "flap";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-flip text-ink border-flip-deep hover:bg-flip-deep hover:text-chalk active:translate-y-px",
  secondary: "bg-chalk text-ink border-chalk-deep hover:bg-chalk-dim active:translate-y-px",
  ghost:
    "bg-transparent text-chalk border-willow/60 hover:border-chalk hover:bg-pitch-line active:translate-y-px",
  danger: "bg-boundary text-chalk border-boundary hover:bg-boundary-soft active:translate-y-px",
  // A key on the mechanical board: dark tile, mono label.
  flap: "bg-ink text-chalk border-black font-mono shadow-tile hover:text-flip active:translate-y-px",
};

const SIZES: Record<Size, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled ?? loading}
      aria-busy={loading || undefined}
      className={cn(
        "tap inline-flex items-center justify-center gap-2 rounded-[3px] border font-sans font-semibold",
        "transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
