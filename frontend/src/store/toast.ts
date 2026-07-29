import { create } from "zustand";

import { ApiError } from "@/lib/api/client";
import { uuid } from "@/lib/utils";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  /** Machine code from the API, shown small so a bug report can quote it. */
  code?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">, ttlMs?: number) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast, ttlMs = 5_000) => {
    const id = uuid();
    set((state) => ({ toasts: [...state.toasts.slice(-3), { ...toast, id }] }));
    window.setTimeout(() => get().dismiss(id), ttlMs);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function toast(message: string, tone: ToastTone = "info"): void {
  useToasts.getState().push({ message, tone });
}

/** Surface an API failure without ever showing the user a raw stack trace. */
export function toastError(error: unknown, fallback = "Something went wrong."): void {
  if (error instanceof ApiError) {
    useToasts.getState().push({
      message: error.message,
      tone: error.isOffline ? "warning" : "error",
      code: error.code,
    });
    return;
  }
  useToasts.getState().push({ message: fallback, tone: "error" });
}
