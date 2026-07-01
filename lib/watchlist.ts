"use client";
/**
 * Watchlist — Postgres-backed (per user, RLS) when signed in, localStorage when not. On first login
 * any local symbols are merged up into the account, then localStorage is cleared. The hook API
 * ({ list, has, toggle }) is unchanged, so every call site keeps working with zero edits.
 */
import { useCallback, useEffect, useState } from "react";
import { browserSupabase } from "./supabase/client";
import { useUser } from "./supabase/useUser";

const KEY = "screener.watchlist";
let wlMerged = false; // one-time local→cloud merge guard (blocks a StrictMode double-invoke race)

function readLocal(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeLocal(list: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function useWatchlist() {
  const { user, enabled } = useUser();
  const cloud = enabled && !!user;
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    if (cloud) {
      const sb = browserSupabase();
      if (!sb) return;
      (async () => {
        // One-time merge of pre-login local symbols (guarded + try/catch so a StrictMode double
        // invoke or a unique-violation race can't dupe or throw), then read the authoritative list.
        const local = readLocal();
        if (local.length && !wlMerged) {
          wlMerged = true;
          try {
            const { data: existing } = await sb.from("watchlist").select("symbol");
            const have = new Set((existing ?? []).map((r: { symbol: string }) => r.symbol));
            const toAdd = local.filter((s) => !have.has(s));
            if (toAdd.length) await sb.from("watchlist").insert(toAdd.map((symbol) => ({ symbol })));
            writeLocal([]);
          } catch {
            /* cloud is authoritative — ignore */
          }
        }
        const { data } = await sb.from("watchlist").select("symbol").order("created_at", { ascending: true });
        if (active && data) setList((data as { symbol: string }[]).map((r) => r.symbol));
      })();
      return () => {
        active = false;
      };
    }
    // signed-out: localStorage + cross-tab sync
    setList(readLocal());
    const onChange = () => setList(readLocal());
    window.addEventListener("storage", onChange);
    window.addEventListener("watchlist-change", onChange);
    return () => {
      active = false;
      window.removeEventListener("storage", onChange);
      window.removeEventListener("watchlist-change", onChange);
    };
  }, [cloud]);

  const toggle = useCallback(
    async (sym: string) => {
      if (cloud) {
        const sb = browserSupabase();
        if (!sb) return;
        const had = list.includes(sym);
        setList((prev) => (had ? prev.filter((s) => s !== sym) : [...prev, sym])); // optimistic
        const { error } = had ? await sb.from("watchlist").delete().eq("symbol", sym) : await sb.from("watchlist").insert({ symbol: sym });
        if (error) setList((prev) => (had ? (prev.includes(sym) ? prev : [...prev, sym]) : prev.filter((s) => s !== sym))); // revert on failure
        return;
      }
      const cur = readLocal();
      const next = cur.includes(sym) ? cur.filter((s) => s !== sym) : [...cur, sym];
      writeLocal(next);
      window.dispatchEvent(new Event("watchlist-change"));
    },
    [cloud, list],
  );

  const has = useCallback((sym: string) => list.includes(sym), [list]);
  return { list, has, toggle };
}
