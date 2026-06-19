"use client";
import { useEffect, useState } from "react";
import { parseTimeframe, type TimeframeKey } from "./timeframes";

const KEY = "screener.tf";

/**
 * A timeframe that persists across navigation so it "defaults to the previous
 * view": an explicit `?tf=` in the URL wins, otherwise the last timeframe the
 * user picked (localStorage), otherwise the page's fallback. Picking a new
 * timeframe stores it for the next page.
 */
export function usePersistedTimeframe(urlTf?: string | null, fallback: TimeframeKey = "1d") {
  const [tf, setTfState] = useState<TimeframeKey>(() => parseTimeframe(urlTf ?? null) ?? fallback);

  // After mount, adopt the stored preference (unless the URL pinned one). Done in
  // an effect so SSR/first paint matches the fallback and doesn't hydration-warn.
  useEffect(() => {
    if (parseTimeframe(urlTf ?? null)) return;
    try {
      const stored = parseTimeframe(localStorage.getItem(KEY));
      if (stored) setTfState(stored);
    } catch {
      /* no localStorage */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTf = (t: TimeframeKey) => {
    setTfState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  };

  return [tf, setTf] as const;
}
