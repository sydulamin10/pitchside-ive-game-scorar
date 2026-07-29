import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useToasts, type ToastTone } from "@/store/toast";

const TONES: Record<ToastTone, string> = {
  info: "border-willow bg-pitch-deep text-chalk",
  success: "border-flip bg-pitch-deep text-chalk",
  warning: "border-flip bg-pitch-deep text-flip",
  error: "border-boundary bg-pitch-deep text-chalk",
};

export function Toaster() {
  const toasts = useToasts((state) => state.toasts);
  const dismiss = useToasts((state) => state.dismiss);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-96"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-[3px] border px-3 py-2.5",
            TONES[toast.tone],
          )}
        >
          <p className="flex-1 font-sans text-sm">
            {toast.message}
            {toast.code && (
              <span className="mt-0.5 block font-mono text-[0.65rem] text-willow">
                {toast.code}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            aria-label="Dismiss"
            className="rounded-[2px] p-1 text-willow-soft hover:text-chalk"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
