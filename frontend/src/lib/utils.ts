import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** A v4 UUID from the platform CSPRNG, with a fallback for insecure contexts. */
export function uuid(): string {
  // `randomUUID` is unavailable on http origins, so keep a byte-level fallback.
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `4.2` overs, never `4.20`: the decimal is a ball count, not a fraction. */
export function oversText(legalBalls: number, ballsPerOver = 6): string {
  const overs = Math.floor(legalBalls / ballsPerOver);
  return `${overs}.${legalBalls % ballsPerOver}`;
}

export function rate(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}

export function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(epochMs: number | null): string {
  if (epochMs === null) return "never";
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Local-time ISO string for `datetime-local` inputs. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Reading a form.
 *
 * `FormData.get` can hand back a `File`, which stringifies to `[object Object]`
 * and would happily be sent to the API. These three narrow it honestly instead.
 */
export function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function formNumber(data: FormData, key: string): number | null {
  const text = formText(data, key);
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An unchecked box is absent from the form data entirely. */
export function formFlag(data: FormData, key: string): boolean {
  return data.get(key) !== null;
}

export function formTexts(data: FormData, key: string): string[] {
  return data
    .getAll(key)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
