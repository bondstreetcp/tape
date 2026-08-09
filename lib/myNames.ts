"use client";
/**
 * My Names = portfolio ∪ watchlist (P2 of docs/SPEC-MY-NAMES-MONITOR.md) — ONE monitored universe
 * composed from the two client-side lists that already exist: the watchlist (lib/watchlist —
 * localStorage or the per-user table) and the pasted book (localStorage "tape.portfolio.positions",
 * parsed by lib/portfolio.parsePositions; negative shares = short, duplicate lines net). Neither
 * store changes — this is a read-time union with a per-symbol source/side map, so the ledger, the
 * desk wire, and the radar can show ▲ LONG / ▼ SHORT / ☆ WATCH chips from one derivation.
 */
import { useEffect, useMemo, useState } from "react";
import { useWatchlist } from "./watchlist";
import { parsePositions } from "./portfolio";

const BOOK_KEY = "tape.portfolio.positions";

export type NameSource = "watch" | "book";
export interface MyName {
  symbol: string;
  sources: NameSource[];
  /** book side from NET shares (duplicates summed); null for watch-only names */
  side: "long" | "short" | null;
}

/** Pure union — book names first (they carry real risk), then watch-only; both deduped, zero-net
 *  book lines dropped (they net out of the book, but a zero-net name still monitored via the
 *  watchlist keeps its watch source). */
export function composeMyNames(watchlist: string[], positions: { symbol: string; shares: number }[]): MyName[] {
  const watch = new Set(watchlist.map((s) => s.trim().toUpperCase()).filter(Boolean));
  const net = new Map<string, number>();
  for (const p of positions) {
    if (!p?.symbol || !Number.isFinite(p.shares)) continue;
    const k = p.symbol.trim().toUpperCase();
    net.set(k, (net.get(k) ?? 0) + p.shares);
  }
  for (const [k, v] of net) if (v === 0) net.delete(k);
  const out: MyName[] = [];
  for (const [sym, shares] of net) {
    const sources: NameSource[] = watch.has(sym) ? ["book", "watch"] : ["book"];
    out.push({ symbol: sym, sources, side: shares > 0 ? "long" : "short" });
  }
  for (const sym of watch) if (!net.has(sym)) out.push({ symbol: sym, sources: ["watch"], side: null });
  return out;
}

/** The client hook: watchlist (cloud-aware) + the pasted book, cross-tab reactive. */
export function useMyNames(): { names: MyName[]; list: string[]; bySymbol: Record<string, MyName> } {
  const { list: watch } = useWatchlist();
  const [bookText, setBookText] = useState("");
  useEffect(() => {
    const read = () => { try { setBookText(localStorage.getItem(BOOK_KEY) ?? ""); } catch { /* ignore */ } };
    read();
    // Cross-tab: the cockpit/radar save the book under this key; a storage event keeps the union live.
    const onStorage = (e: StorageEvent) => { if (e.key === BOOK_KEY) read(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const names = useMemo(() => composeMyNames(watch, parsePositions(bookText)), [watch, bookText]);
  return useMemo(() => ({
    names,
    list: names.map((n) => n.symbol),
    bySymbol: Object.fromEntries(names.map((n) => [n.symbol, n])),
  }), [names]);
}
