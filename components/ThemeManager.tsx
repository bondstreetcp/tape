"use client";
import { useEffect } from "react";

/**
 * Bulletproof theme persistence. The inline <head> script in layout.tsx sets the
 * theme on first paint; this keeps it stuck. A MutationObserver on <html>'s class
 * re-syncs to the saved preference if anything ever clears it (a server re-render,
 * router.refresh, a streamed shell) — independent of navigation events, which is
 * why this is an observer rather than a usePathname effect (root-layout client
 * children don't reliably re-render on route change). It only acts on a mismatch,
 * so it never fights the toggle and can't loop.
 */
export default function ThemeManager() {
  useEffect(() => {
    const apply = () => {
      try {
        const light = localStorage.getItem("theme") === "light";
        const el = document.documentElement;
        if (light !== el.classList.contains("light")) el.classList.toggle("light", light);
      } catch {}
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return null;
}
