import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The stitched-seam divider used instead of shadows or gradient rules. */
export function Seam({ className, chalk = false }: { className?: string; chalk?: boolean }) {
  return <div aria-hidden="true" className={cn("seam", chalk && "seam--chalk", className)} />;
}

/** A ledger page: chalk paper, faint rules, hairline border. */
export function Paper({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...rest} className={cn("paper rounded-[3px] border border-chalk-deep", className)}>
      {children}
    </div>
  );
}

/** A panel on the dark ground: for controls and secondary information. */
export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...rest}
      className={cn("rounded-[3px] border border-pitch-line bg-pitch-deep", className)}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  as: Tag = "h2",
  className,
}: {
  children: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "font-sans text-[0.7rem] font-bold tracking-[0.16em] uppercase text-willow-soft",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

type Tone = "live" | "neutral" | "wicket" | "quiet";

const TONES: Record<Tone, string> = {
  live: "border-flip/70 bg-flip/15 text-flip",
  neutral: "border-willow/50 bg-willow/10 text-chalk",
  wicket: "border-boundary/70 bg-boundary/20 text-boundary-soft",
  quiet: "border-willow/35 bg-transparent text-willow",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-0.5",
        "font-sans text-[0.65rem] font-bold tracking-[0.12em] uppercase",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A pulsing amber dot. The only place in the app where anything blinks. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("relative flex size-2", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-flip opacity-70" />
      <span className="relative inline-flex size-2 rounded-full bg-flip" />
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Seam className="w-24" />
      <h3 className="font-sans text-base text-chalk">{title}</h3>
      <p className="max-w-md text-sm text-willow-soft">{description}</p>
      {action}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-willow-soft">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span className="font-sans text-sm">{label}</span>
    </div>
  );
}
