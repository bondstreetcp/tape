"use client";
import { useEffect, useState } from "react";
import { useMyNames } from "@/lib/myNames";
import type { LedgerData } from "@/lib/myNamesLedger";

// The top bar's "anything happened?" signal — counts ledger events newer than the My Names
// "since you last looked" cursor. One fetch per 10 minutes per tab-session (sessionStorage TTL);
// the route's own 10-min memo (keyed on the symbol set) makes even cold fetches cheap. Renders
// nothing while empty/unknown — the badge must only ever ADD information.

const TTL = 600_000;

/** Shared "N new events since the cursor" count — the top-bar badge and the Home morning strip
 *  read the same number from the same sessionStorage-TTL'd fetch. -1 = unknown (no cursor yet). */
export function useMyNamesNewCount(): { count: number; names: number } {
  const { list } = useMyNames();
  const [count, setCount] = useState(-1);

  useEffect(() => {
    if (!list.length) { setCount(-1); return; }
    const key = [...list].sort().join(",");
    let live = true;
    const cacheRaw = (() => { try { return window.sessionStorage.getItem("myNames.badge"); } catch { return null; } })();
    try {
      const c = cacheRaw ? JSON.parse(cacheRaw) : null;
      if (c && c.key === key && Date.now() - c.ts < TTL) { setCount(c.count); return; }
    } catch { /* recompute */ }
    const seenRaw = (() => { try { return window.localStorage.getItem("myNames.lastSeen"); } catch { return null; } })();
    const seenMs = seenRaw ? Date.parse(seenRaw) : NaN;
    if (!Number.isFinite(seenMs)) { setCount(-1); return; } // never visited the ledger — no cursor, no honest count
    fetch(`/api/my-names-ledger?syms=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: LedgerData) => {
        if (!live) return;
        const n = j.names.reduce((a, x) => a + x.events.filter((e) => { const t = Date.parse(e.ts); return Number.isFinite(t) && t > seenMs; }).length, 0);
        setCount(n);
        try { window.sessionStorage.setItem("myNames.badge", JSON.stringify({ key, ts: Date.now(), count: n })); } catch { /* cosmetic */ }
      })
      .catch(() => { /* badge is best-effort */ });
    return () => { live = false; };
  }, [list]);

  return { count, names: list.length };
}

export default function MyNamesBadge() {
  const { count } = useMyNamesNewCount();
  if (count <= 0) return null;
  return (
    <span className="ml-1 rounded-full bg-[var(--accent-strong)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white" title={`${count} new event${count !== 1 ? "s" : ""} in your names since you last looked`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}
