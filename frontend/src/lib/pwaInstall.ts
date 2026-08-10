/**
 * PWA install + desktop shortcut creation.
 * Native beforeinstallprompt when the browser allows it; Windows/macOS fallback
 * downloads a real shortcut that launches Chrome/Edge in --app mode.
 */

import { create } from "zustand";

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type InstallState = {
  deferred: BeforeInstallPromptEvent | null;
  installed: boolean;
  iosHintOpen: boolean;
  setDeferred: (event: BeforeInstallPromptEvent | null) => void;
  setInstalled: (value: boolean) => void;
  setIosHintOpen: (open: boolean) => void;
};

export const useInstallPrompt = create<InstallState>((set) => ({
  deferred: null,
  installed: false,
  iosHintOpen: false,
  setDeferred: (deferred) => set({ deferred }),
  setInstalled: (installed) => set({ installed }),
  setIosHintOpen: (iosHintOpen) => set({ iosHintOpen }),
}));

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

export function isWindowsDesktop(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

export function isMacDesktop(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Macintosh/i.test(navigator.userAgent) &&
    navigator.maxTouchPoints === 0
  );
}

export function appStartUrl(): string {
  return `${window.location.origin}/app`;
}

function downloadTextFile(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/** Windows: .vbs creates Desktop + Start Menu .lnk launching Chrome/Edge --app= */
export function downloadWindowsShortcut(appUrl: string = appStartUrl()): void {
  const safeUrl = appUrl.replace(/"/g, "");
  const vbs = [
    'Set sh = CreateObject("WScript.Shell")',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'desktop = sh.SpecialFolders("Desktop")',
    'startMenu = sh.SpecialFolders("StartMenu") & "\\Programs"',
    'chrome = ""',
    "candidates = Array(_",
    '  sh.ExpandEnvironmentStrings("%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"),_',
    '  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"),_',
    '  sh.ExpandEnvironmentStrings("%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"),_',
    '  sh.ExpandEnvironmentStrings("%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"),_',
    '  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe")_',
    ")",
    "For Each p In candidates",
    "  If fso.FileExists(p) Then chrome = p : Exit For",
    "Next",
    'If chrome = "" Then',
    '  MsgBox "Chrome or Edge not found. Install Chrome, then run this again.", 16, "Pitchside"',
    "  WScript.Quit 1",
    "End If",
    "Sub MakeLink(folder)",
    '  If Not fso.FolderExists(folder) Then Exit Sub',
    '  Set link = sh.CreateShortcut(folder & "\\Pitchside.lnk")',
    "  link.TargetPath = chrome",
    `  link.Arguments = "--app=""${safeUrl}"""`,
    "  link.WorkingDirectory = fso.GetParentFolderName(chrome)",
    '  link.Description = "Pitchside — cricket scoring"',
    '  link.IconLocation = chrome & ",0"',
    "  link.Save",
    "End Sub",
    "MakeLink desktop",
    "On Error Resume Next",
    "MakeLink startMenu",
    'MsgBox "Pitchside shortcut created on your Desktop (and Start Menu if allowed).", 64, "Pitchside"',
    "",
  ].join("\r\n");

  downloadTextFile("Pitchside-Create-Shortcut.vbs", vbs, "application/octet-stream");
}

/** macOS: .command opens Chrome/Edge in app mode; user double-clicks once. */
export function downloadMacShortcut(appUrl: string = appStartUrl()): void {
  const safeUrl = appUrl.replace(/"/g, '\\"');
  const script = `#!/bin/bash
APP_URL="${safeUrl}"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$APP_URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "Microsoft Edge" --args --app="$APP_URL"
else
  open "$APP_URL"
fi
`;
  downloadTextFile("Pitchside.command", script, "text/x-shellscript");
}

export function openAppWindow(url: string = appStartUrl()): void {
  if (isStandaloneDisplay()) {
    window.location.assign(url);
    return;
  }

  const width = Math.min(440, screen.availWidth);
  const height = Math.min(860, screen.availHeight);
  const left = Math.max(0, Math.round((screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((screen.availHeight - height) / 2));
  const features = [
    "popup=yes",
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    "toolbar=no",
    "location=no",
    "status=no",
    "menubar=no",
    "scrollbars=yes",
    "resizable=yes",
  ].join(",");

  const win = window.open(url, "pitchside-app", features);
  if (!win || win.closed) {
    window.location.assign(url);
    return;
  }
  win.focus();
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
  | "desktop-shortcut"
  | "android-ready";

/**
 * 1) Native PWA install FIRST (must stay in the click gesture — no long awaits).
 * 2) Desktop fallback: download Chrome/Edge --app shortcut.
 * 3) Mobile without prompt: show home-screen tip (HTTPS required for Android).
 */
export async function installOrOpenApp(): Promise<InstallResult> {
  const url = appStartUrl();
  const state = useInstallPrompt.getState();

  if (state.installed || isStandaloneDisplay()) {
    window.location.assign(url);
    return "opened";
  }

  // Use the deferred prompt immediately — awaiting SW/timeout first breaks Chrome's
  // user-gesture requirement and the home-screen icon never appears.
  const deferred = state.deferred;
  if (deferred) {
    await deferred.prompt();
    const choice = await deferred.userChoice;
    useInstallPrompt.getState().setDeferred(null);
    if (choice.outcome === "accepted") {
      useInstallPrompt.getState().setInstalled(true);
      // OS adds the icon and usually opens the installed app; land on /app too.
      window.location.assign(url);
      return "accepted";
    }
    return "dismissed";
  }

  if (isIosSafari()) {
    useInstallPrompt.getState().setIosHintOpen(true);
    return "ios";
  }

  if (isAndroid()) {
    // No beforeinstallprompt yet (often HTTP / SW not controlling). Tip the user.
    useInstallPrompt.getState().setIosHintOpen(true);
    return "android-ready";
  }

  if (isWindowsDesktop()) {
    downloadWindowsShortcut(url);
    openAppWindow(url);
    return "desktop-shortcut";
  }
  if (isMacDesktop()) {
    downloadMacShortcut(url);
    openAppWindow(url);
    return "desktop-shortcut";
  }

  openAppWindow(url);
  return "opened";
}

/** @deprecated use installOrOpenApp */
export async function promptInstallApp() {
  return installOrOpenApp();
}
