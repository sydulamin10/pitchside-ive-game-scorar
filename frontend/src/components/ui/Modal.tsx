import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Seam } from "@/components/ui/Surface";

/**
 * A dialog that behaves on a phone held in one hand: it sits at the bottom of
 * small screens, closes on Escape or a tap outside, and returns focus to
 * whatever opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "flex max-h-[92vh] w-full flex-col overflow-hidden border border-pitch-line bg-pitch-deep",
          "rounded-t-[6px] sm:rounded-[3px]",
          wide ? "sm:max-w-3xl" : "sm:max-w-md",
        )}
      >
        <header className="px-4 pt-4 pb-3">
          <h2 className="font-sans text-base font-semibold text-chalk">{title}</h2>
          {description && (
            <p className="mt-1 font-sans text-xs text-willow-soft">{description}</p>
          )}
        </header>
        <Seam />
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && (
          <>
            <Seam />
            <footer className="flex flex-wrap justify-end gap-2 px-4 py-3">{footer}</footer>
          </>
        )}
      </div>
    </div>
  );
}
