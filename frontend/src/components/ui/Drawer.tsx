import { useEffect, useRef, useState, type ReactNode } from "react";

import { Seam } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";

/** Kept in step with the transition duration on the panel below. */
const TRANSITION_MS = 220;

/**
 * A panel that slides in from the edge of the screen — the shape controls want
 * on a phone held in one hand, where a centred dialog would cover the very
 * video or pad the controls act on.
 *
 * Stays mounted for the length of the close transition so it slides out rather
 * than vanishing, and otherwise behaves like the Modal: Escape closes it, a tap
 * on the backdrop closes it, the page behind does not scroll, and focus goes
 * back to whatever opened it.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  side = "left",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: "left" | "right";
  className?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  // Derived during render rather than in an effect: the panel has to exist in
  // the tree, off-screen, before anything can animate it on, and an effect
  // would spend a frame mounting it in its final position instead.
  if (open && !mounted) setMounted(true);
  if (!open && shown) setShown(false);

  useEffect(() => {
    if (!open) return;
    // Two frames: the first commits the off-screen start position, the second
    // flips to the on-screen one so the browser has something to animate
    // between. One frame is enough on most engines and not on all of them.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open]);

  // Stay mounted for the length of the slide-out, then leave the tree.
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      (openerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const closed = side === "left" ? "-translate-x-full" : "translate-x-full";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex",
        side === "right" && "justify-end",
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-black/60 transition-opacity duration-200 motion-reduce:transition-none",
          shown ? "opacity-100" : "opacity-0",
        )}
        onMouseDown={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative flex h-full w-[min(20rem,86vw)] flex-col border-pitch-line bg-pitch-deep",
          side === "left" ? "border-r" : "border-l",
          "transition-transform duration-200 ease-out motion-reduce:transition-none",
          shown ? "translate-x-0" : closed,
          className,
        )}
      >
        <header className="flex items-start justify-between gap-2 px-3 pt-3 pb-2">
          <div className="min-w-0">
            <h2 className="font-sans text-sm font-semibold text-chalk">{title}</h2>
            {description && (
              <p className="mt-0.5 font-sans text-[0.68rem] text-willow-soft">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[2px] border border-willow/30 px-2 py-1 font-sans text-xs leading-none text-willow-soft hover:border-willow/60 hover:text-chalk"
          >
            ✕
          </button>
        </header>
        <Seam />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>
        {footer && (
          <>
            <Seam />
            <footer className="px-3 py-2.5">{footer}</footer>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The always-visible grip that pulls the drawer out. Sits against the edge of
 * the screen so it is reachable with a thumb without covering the frame.
 */
export function DrawerHandle({
  onClick,
  label,
  side = "left",
  className,
}: {
  onClick: () => void;
  label: string;
  side?: "left" | "right";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "fixed top-1/2 z-30 -translate-y-1/2 border border-willow/35 bg-ink/85 px-1 py-3 text-willow-soft backdrop-blur-sm",
        "hover:border-flip/60 hover:text-flip active:bg-ink",
        side === "left"
          ? "left-0 rounded-r-[4px] border-l-0"
          : "right-0 rounded-l-[4px] border-r-0",
        className,
      )}
    >
      <span aria-hidden="true" className="flex flex-col items-center gap-1">
        <span className="block h-0.5 w-3.5 rounded-full bg-current" />
        <span className="block h-0.5 w-3.5 rounded-full bg-current" />
        <span className="block h-0.5 w-3.5 rounded-full bg-current" />
      </span>
    </button>
  );
}
