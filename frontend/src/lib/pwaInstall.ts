/**
 * Native PWA install only — home-screen / app launcher icon, standalone window.
 * No .vbs / .command downloads.
 */

import { create } from "zustand";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallState = {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
  tipOpen: boolean;
  setDeferred: (event: BeforeInstallPromptEvent | null) => void;
  setInstalled: (value: boolean) => void;
  setTipOpen: (open: boolean) => void;
};

export const useInstallPrompt = create<InstallState>((set) => ({
  deferred: null,
  installed: false,
  tipOpen: false,
  setDeferred: (deferred) => set({ deferred }),
  setInstalled: (installed) => set({ installed }),
  setTipOpen: (tipOpen) => set({ tipOpen }),
}));

/** @deprecated use tipOpen / setTipOpen */
export const setIosHintOpen = (open: boolean) =>
  useInstallPrompt.getState().setTipOpen(open);

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const media = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    "standalone" in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return media || iosStandalone;
}

export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const chromeIos = /CriOS|FxiOS|EdgiOS/.test(ua);
  return iOS && webkit && !chromeIos;
}

export function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function isDesktopOs(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Windows|Macintosh|Linux/i.test(ua) && !/Android|iPhone|iPad|iPod/i.test(ua);
}

export function appStartUrl(): string {
  return `${window.location.origin}/app`;
}

export function bindInstallPromptListeners(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const { setDeferred, setInstalled } = useInstallPrompt.getState();
  if (isStandaloneDisplay()) setInstalled(true);

  const onBip = (event: Event) => {
    event.preventDefault();
    setDeferred(event as BeforeInstallPromptEvent);
  };
  const onInstalled = () => {
    setDeferred(null);
    setInstalled(true);
  };

  window.addEventListener("beforeinstallprompt", onBip);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onBip);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export type InstallResult =
  | "accepted"
  | "dismissed"
  | "opened"
  | "ios"
  | "manual-tip";

/**
 * Native Chrome/Edge install prompt when available.
 * Otherwise show how to Install / Add to Home Screen — never download a .vbs.
 */
export async function installOrOpenApp(): Promise<InstallResult> {
  const url = appStartUrl();
  const state = useInstallPrompt.getState();

  if (state.installed || isStandaloneDisplay()) {
    window.location.assign(url);
    return "opened";
  }

  const deferred = state.deferred;
  if (deferred) {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    useInstallPrompt.getState().setDeferred(null);
    if (choice.outcome === "accepted") {
      useInstallPrompt.getState().setInstalled(true);
      window.location.assign(url);
      return "accepted";
    }
    return "dismissed";
  }

  // No deferred prompt yet — teach Install / Add to Home Screen (phone or PC).
  useInstallPrompt.getState().setTipOpen(true);
  if (isIosSafari()) return "ios";
  return "manual-tip";
}

/** @deprecated use installOrOpenApp */
export async function promptInstallApp() {
  return installOrOpenApp();
}
