/**
 * Install / Open app — native PWA install, or desktop shortcut download + open.
 */

import { Download, Share, X } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import {
  installOrOpenApp,
  isAndroid,
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
  const iosHintOpen = useInstallPrompt((s) => s.iosHintOpen);
  const setIosHintOpen = useInstallPrompt((s) => s.setIosHintOpen);
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
      toast("Installed. Shortcut is on your home screen / app list.", "success");
    } else if (result === "desktop-shortcut") {
      toast(
        "Shortcut file downloaded — open it once to put Pitchside on your Desktop.",
        "success",
      );
    }
  };

  const mobileTip = isAndroid()
    ? "Open this site with https:// (see /install checklist). Then tap Add to Home Screen — Chrome will show Install and put the Pitchside logo on your home screen."
    : "Tap Share → Add to Home Screen → Add. The Pitchside logo appears on your home screen.";

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

      {iosHintOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
        >
          <div className="w-full max-w-sm rounded-[4px] border border-willow/30 bg-pitch p-4 shadow-tile">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p
                  id="ios-install-title"
                  className="font-sans text-sm font-semibold text-chalk"
                >
                  {isAndroid() ? "Add icon on Android" : "Add icon on iPhone"}
                </p>
                <p className="mt-2 font-sans text-xs leading-relaxed text-willow">
                  {isAndroid() ? (
                    mobileTip
                  ) : (
                    <>
                      Tap <Share aria-hidden="true" className="inline size-3.5 text-flip" /> Share
                      → <strong className="text-chalk">Add to Home Screen</strong>.
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close"
                className="rounded-[2px] p-1 text-willow hover:text-chalk"
                onClick={() => setIosHintOpen(false)}
              >
                <X className="size-4" />
              </button>
            </div>
            <Button className="mt-4 w-full" size="sm" onClick={() => setIosHintOpen(false)}>
              OK
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
