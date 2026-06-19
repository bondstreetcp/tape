"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "screener.watchlist";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** localStorage-backed watchlist, synced across components in the same tab. */
export function useWatchlist() {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    setList(read());
    const onChange = () => setList(read());
    window.addEventListener("storage", onChange);
    window.addEventListener("watchlist-change", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("watchlist-change", onChange);
    };
  }, []);

  const toggle = useCallback((sym: string) => {
    const cur = read();
    const next = cur.includes(sym)
      ? cur.filter((s) => s !== sym)
      : [...cur, sym];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("watchlist-change"));
  }, []);

  const has = useCallback((sym: string) => list.includes(sym), [list]);
  return { list, has, toggle };
}
