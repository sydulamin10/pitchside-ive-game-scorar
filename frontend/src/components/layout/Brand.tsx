import { cn } from "@/lib/utils";

/**
 * The mark: a cricket ball's seam. Two stitched arcs, no wordmark inside it, so
 * it survives being 16px in a browser tab.
 */
export function SeamMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("text-flip", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="12" cy="12" r="9.25" />
      <path d="M6.4 4.6c2.5 4.4 2.5 10.4 0 14.8" strokeDasharray="2 2.2" />
      <path d="M17.6 4.6c-2.5 4.4-2.5 10.4 0 14.8" strokeDasharray="2 2.2" />
    </svg>
  );
}

/** A minimal bat, used as a section ornament rather than an emoji. */
export function BatMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("text-willow", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <rect x="7" y="3" width="7" height="12" rx="2" />
      <path d="M10.5 15v3.5M9 21h3.5" />
    </svg>
  );
}

/** Three stumps, for empty states. */
export function StumpsMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("text-willow", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M7 6v13M12 6v13M17 6v13" />
      <path d="M6 5.4h5.2M12.8 5.4H18" />
    </svg>
  );
}
