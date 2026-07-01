"use client";
import { useEffect, useRef, useState } from "react";

// The "pinned" install affordance. Registers the service worker, then:
//  - Chrome/Edge/Android/desktop: catches beforeinstallprompt → shows an Install button that fires the
//    native prompt.
//  - iOS Safari (never fires beforeinstallprompt): shows an Install button that reveals the manual
//    "Share → Add to Home Screen" steps.
// Hides itself once the app is already installed (running standalone) or right after an install.
export default function InstallPWA() {
  const deferred = useRef<(Event & { prompt: () => void; userChoice: Promise<{ outcome: string }> }) | null>(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    if (standalone) return; // already installed

    const ua = navigator.userAgent || "";
    const ios = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    if (ios) { setIsIOS(true); setShow(true); return; } // iOS has no prompt event — always offer manual steps

    const onBIP = (e: Event) => { e.preventDefault(); deferred.current = e as any; setShow(true); };
    const onInstalled = () => { setShow(false); deferred.current = null; };
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  const onClick = async () => {
    if (isIOS) { setHelp((v) => !v); return; }
    const d = deferred.current;
    if (!d) return;
    d.prompt();
    try { await d.userChoice; } catch {}
    deferred.current = null;
    setShow(false);
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={onClick}
        title="Install Tape as an app on your device"
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-1 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
      >
        <span aria-hidden>⤓</span>
        <span>Install</span>
      </button>
      {isIOS && help && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setHelp(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-[13px] leading-relaxed text-[var(--text-2)] shadow-lg">
            <div className="mb-1 font-semibold text-[var(--text)]">Add Tape to your Home Screen</div>
            In Safari, tap the <b>Share</b> button <span aria-hidden>􀈂</span> (the square with an up arrow), then choose <b>Add to Home Screen</b>. It opens full-screen like an app — no App Store needed.
          </div>
        </>
      )}
    </div>
  );
}
