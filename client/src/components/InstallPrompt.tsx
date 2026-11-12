import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIOS, isStandalone } from "@/lib/push";

/** Captured early in main.tsx (the event can fire before React mounts). */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global {
  interface Window { __pxInstallPrompt?: InstallEvent | null }
}

const DISMISS_KEY = "px-install-dismissed-at";
const DISMISS_DAYS = 14;

function recentlyDismissed(): boolean {
  const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

/** "Install app" (Android / desktop) and the iPhone "Add to Home Screen" hint. */
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(() => window.__pxInstallPrompt ?? null);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());
  const ios = isIOS();

  useEffect(() => {
    const onReady = () => setInstallEvent(window.__pxInstallPrompt ?? null);
    const onInstalled = () => { setHidden(true); window.__pxInstallPrompt = null; };
    window.addEventListener("px-install-ready", onReady);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("px-install-ready", onReady);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || (!installEvent && !ios)) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setHidden(true);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice.catch(() => ({ outcome: "dismissed" }));
    window.__pxInstallPrompt = null;
    setInstallEvent(null);
    if (choice.outcome !== "accepted") dismiss();
  };

  return (
    <div
      role="dialog"
      aria-label="Install Pixely"
      className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-md rounded-[.6rem] border border-border bg-[hsl(var(--popover))] p-4 shadow-2xl shadow-slate-950/50 lg:left-auto lg:right-6 lg:bottom-6 lg:mx-0"
    >
      <div className="flex items-start gap-3">
        <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-[.5rem]" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100">Install Pixely</p>
          {ios ? (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
              Get order alerts on your iPhone: tap <Share className="inline h-3.5 w-3.5 -mt-0.5" /> <b className="text-slate-200">Share</b> → <b className="text-slate-200">Add to Home Screen</b>, then open Pixely from your Home Screen (iOS 16.4+).
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">Open it like an app and get order alerts on this device.</p>
          )}
          {!ios && (
            <Button size="sm" className="mt-3 h-9" onClick={install}>
              <Download className="mr-1.5 h-4 w-4" />Install app
            </Button>
          )}
        </div>
        <button onClick={dismiss} className="-m-1 flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-white" aria-label="Not now">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
