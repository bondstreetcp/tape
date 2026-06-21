"use client";
import { useEffect, useState } from "react";

export interface LiveQuote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  state: string;
  extPrice: number | null;
  extChangePct: number | null;
  time: number | null;
}

/** Poll /api/quote for live prices on a set of symbols. Refreshes on an interval,
 *  skips while the tab is hidden, and re-fetches when it becomes visible again. */
export function useLiveQuotes(symbols: string[], intervalMs = 30_000) {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const key = [...symbols].sort().join(",");

  useEffect(() => {
    if (!key) { setQuotes({}); setUpdatedAt(null); return; }
    let alive = true;
    const load = () => {
      setLoading(true);
      fetch(`/api/quote?symbols=${encodeURIComponent(key)}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive) return;
          const m: Record<string, LiveQuote> = {};
          for (const q of d.quotes || []) m[q.symbol] = q;
          setQuotes(m);
          setUpdatedAt(Date.now());
        })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    };
    load(); // initial fetch always runs
    // interval refreshes pause while the tab is backgrounded (don't hammer Yahoo)
    const id = setInterval(() => { if (!document.hidden) load(); }, intervalMs);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [key, intervalMs]);

  return { quotes, updatedAt, loading };
}
