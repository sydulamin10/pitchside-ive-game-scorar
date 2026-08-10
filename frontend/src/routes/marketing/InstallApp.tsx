/**
 * Dedicated install page — big Install control for phones to add home-screen icon.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router";

import { InstallAppButton } from "@/components/layout/InstallAppButton";
import { Button } from "@/components/ui/Button";
import { Panel, Seam, SectionTitle } from "@/components/ui/Surface";
import { ensureServiceWorkerReady } from "@/lib/pwa";
import {
  isAndroid,
  isIosSafari,
  isStandaloneDisplay,
  useInstallPrompt,
} from "@/lib/pwaInstall";

export default function InstallAppPage() {
  const deferred = useInstallPrompt((s) => s.deferred);
  const installed = useInstallPrompt((s) => s.installed);
  const [swReady, setSwReady] = useState(false);
  const [secure, setSecure] = useState(false);
  const standalone = isStandaloneDisplay();

  useEffect(() => {
    setSecure(window.isSecureContext);
    void ensureServiceWorkerReady().then(setSwReady);
  }, []);

  const canNativeInstall = Boolean(deferred) && !installed && !standalone;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-10">
      <div className="flex flex-col items-center text-center">
        <img
          src="/icons/icon-192.png"
          alt="Pitchside"
          width={96}
          height={96}
          className="rounded-[18px] border border-willow/30 shadow-tile"
        />
        <h1 className="mt-4 font-sans text-2xl font-bold text-chalk">Install Pitchside</h1>
        <p className="mt-2 font-sans text-sm text-willow">
          Add the cricket-ball icon to your phone. Tap it anytime — opens like an app
          (fullscreen, no browser bar).
        </p>
      </div>

      <Panel className="p-4">
        {(standalone || installed) && (
          <>
            <p className="font-sans text-sm text-flip">Already installed on this device.</p>
            <Link to="/app" className="mt-3 inline-block">
              <Button>Open Pitchside</Button>
            </Link>
            <Seam className="my-4" />
          </>
        )}

        <div className="flex flex-col items-stretch gap-3">
          <InstallAppButton
            size="lg"
            variant="primary"
            className="w-full justify-center"
            label={canNativeInstall ? "Add to Home Screen" : "Install app"}
          />
          {canNativeInstall && (
            <p className="text-center font-sans text-xs text-flip">
              Ready — tap the button, then confirm Install. Your logo will appear on the home
              screen.
            </p>
          )}
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionTitle>Checklist</SectionTitle>
        <Seam className="my-3" />
        <ul className="space-y-2 font-sans text-sm">
          <Check ok={secure} label="Secure connection (HTTPS)" />
          <Check ok={swReady} label="App service worker ready" />
          <Check
            ok={canNativeInstall || standalone || installed}
            label="Browser can add home-screen icon"
          />
        </ul>
        {!secure && (
          <p className="mt-3 font-sans text-xs text-boundary">
            Open the <strong className="text-chalk">https://</strong> Network address from the
            Vite terminal on your phone (not http://). Accept the certificate warning once, then
            return here.
          </p>
        )}
        {secure && !canNativeInstall && !standalone && isAndroid() && (
          <p className="mt-3 font-sans text-xs text-willow">
            Use <strong className="text-chalk">Chrome</strong> on Android. Wait a few seconds after
            the page loads (until the checklist turns green), then tap Install. If it still does
            not offer Install, Chrome menu (⋮) → <strong className="text-chalk">Install app</strong>
            .
          </p>
        )}
        {isIosSafari() && !standalone && (
          <p className="mt-3 font-sans text-xs text-willow">
            iPhone: tap Share → <strong className="text-chalk">Add to Home Screen</strong> → Add.
          </p>
        )}
      </Panel>

      <Link to="/" className="text-center font-sans text-sm text-willow underline">
        Back to site
      </Link>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-chalk">
      <span
        className={
          ok
            ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-flip text-[11px] font-bold text-ink"
            : "inline-flex h-5 w-5 items-center justify-center rounded-full border border-willow/40 text-[11px] text-willow"
        }
      >
        {ok ? "✓" : "·"}
      </span>
      {label}
    </li>
  );
}
