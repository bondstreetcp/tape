"use client";
import { useEffect, useState } from "react";

/**
 * Poll a JSON endpoint on an interval while `enabled`, so the "live intraday" charts actually stay
 * live instead of freezing at page-load. Returns the latest response, the time it last arrived
 * (`asOf`), and a `loading` flag for the in-flight refresh. Stops when disabled (e.g. the user
 * switches off the 1D/1W tenor) or the component unmounts.
 *
 * The underlying endpoints are edge-cached (~2 min) + 15-minute-bar granular, so a ~60s poll keeps
 * the in-progress bar and any newly-arrived bars current without hammering Yahoo.
 */
export function usePolledFetch(
  enabled: boolean,
  url: string | null,
  intervalMs = 60_000,
): { data: any; asOf: number | null; loading: boolean } {
  const [data, setData] = useState<any>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !url) return;
    let alive = true;
    const tick = () => {
      setLoading(true);
      fetch(url)
        .then((r) => r.json())
        .then((d) => { if (alive) { setData(d); setAsOf(Date.now()); } })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [enabled, url, intervalMs]);

  return { data, asOf, loading };
}

/** Local wall-clock HH:MM:SS for an "updated …" stamp. */
export function fmtClock(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
