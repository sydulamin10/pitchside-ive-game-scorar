/**
 * Install app — native PWA only (home screen / Start menu icon, standalone window).
 */

import { Download, Share, X } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import {
  installOrOpenApp,
  isAndroid,
  isDesktopOs,
  isIosSafari,
  isStandaloneDisplay,
  useInstallPrompt,
} from "@/lib/pwaInstall";
import { cn } from "@/lib/utils";
import { toast } from "@/store/toast";

export function InstallAppButton({
  size = "sm",
  variant = "secondary",
  className,
  label,
}: {
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  label?: string;
}) {
  const navigate = useNavigate();
  const installed = useInstallPrompt((s) => s.installed);
  const tipOpen = useInstallPrompt((s) => s.tipOpen);
  const setTipOpen = useInstallPrompt((s) => s.setTipOpen);
  const standalone = isStandaloneDisplay();

  const buttonLabel =
    label ?? (installed || standalone ? "Open app" : "Install app");

  const onClick = async () => {
    if (standalone) {
      void navigate("/app");
      return;
    }
    const result = await installOrOpenApp();
    if (result === "accepted") {
      toast("Installed — open ODCC LIVE from your home screen or app list.", "success");
    }
  };

  const tipTitle = isIosSafari()
    ? "Add icon on iPhone"
    : isAndroid()
      ? "Add icon on Android"
      : "Install on this computer";

  const tipBody = isIosSafari() ? (
    <>
      Tap <Share aria-hidden="true" className="inline size-3.5 text-flip" /> Share →{" "}
      <strong className="text-chalk">Add to Home Screen</strong> → Add. Opens fullscreen like an
      app.
    </>
  ) : isAndroid() ? (
    <>
      Chrome menu (⋮) → <strong className="text-chalk">Install app</strong> or{" "}
      <strong className="text-chalk">Add to Home screen</strong>. The ODCC LIVE logo appears on
      your home screen.
    </>
  ) : (
    <>
      In <strong className="text-chalk">Chrome</strong> or Edge: address bar install icon, or menu
      (⋮) → <strong className="text-chalk">Install ODCC LIVE</strong> / Install app. It opens in
      its own window — no browser tabs.
    </>
  );

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn(className)}
        onClick={() => void onClick()}
      >
        <Download aria-hidden="true" className="size-4" />
        {buttonLabel}
      </Button>

      {tipOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-tip-title"
        >
          <div className="w-full max-w-sm rounded-[4px] border border-willow/30 bg-pitch p-4 shadow-tile">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p
                  id="install-tip-title"
                  className="font-sans text-sm font-semibold text-chalk"
                >
                  {tipTitle}
                </p>
                <p className="mt-2 font-sans text-xs leading-relaxed text-willow">{tipBody}</p>
                {isDesktopOs() && (
                  <p className="mt-2 font-sans text-xs text-willow">
                    Stay on <strong className="text-chalk">https://</strong> and wait a few seconds
                    for Install to appear.
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Close"
                className="rounded-[2px] p-1 text-willow hover:text-chalk"
                onClick={() => setTipOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <Button className="mt-4 w-full" size="sm" onClick={() => setTipOpen(false)}>
              OK
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
