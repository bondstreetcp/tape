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
  const [updated, setUpdated] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const local = /^(localhost|127\.|192\.168\.|\[::1\])/.test(location.hostname);
      if (local) {
        // Dev/preview: NEVER run the SW. Dev chunks aren't content-hashed, so the SW's cache-first
        // static handler serves hours-old code against fresh data — the recurring "data updates but
        // my edit won't render" split-brain (2026-08-08, three times in one session). Actively
        // unregister anything a previous visit installed, so a dev box heals itself.
        navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      } else {
        // The build sha in the URL makes every deploy a NEW worker: install → skipWaiting →
        // clients.claim → controllerchange on open tabs, where the toast below offers a refresh.
        // Without it, VERSION in sw.js was hand-bumped (i.e., never) and tabs from two deploys ago
        // lazy-loaded dead chunks (the 2026-08-08 "pages aren't working anymore" class).
        navigator.serviceWorker.register(`/sw.js?v=${process.env.NEXT_PUBLIC_GIT_SHA || "dev"}`).catch(() => {});
        const hadController = !!navigator.serviceWorker.controller; // first-ever install also fires controllerchange — no toast for that
        const onChange = () => { if (hadController) setUpdated(true); };
        navigator.serviceWorker.addEventListener("controllerchange", onChange);
      }
    }

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

  // The update toast renders regardless of the install button's state — an already-installed
  // (standalone) user is exactly who needs to hear "a new version took over this tab".
  const toast = updated ? (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text)] shadow-lg">
        <span>Tape updated — refresh to load the new version.</span>
        <button onClick={() => window.location.reload()} className="rounded-md bg-[var(--accent-strong)] px-3 py-1 text-sm font-medium text-white">Refresh</button>
        <button onClick={() => setUpdated(false)} className="text-[var(--text-4)] hover:text-[var(--text)]" aria-label="Dismiss">✕</button>
      </div>
    </div>
  ) : null;

  if (!show) return toast;

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
      {toast}
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
