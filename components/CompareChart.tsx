"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { buildComparison } from "@/lib/compute";
import { ECON_PREFIX, prettySym } from "@/lib/econOverlays";
import MultiLineChart from "./MultiLineChart";

const COLORS = ["#60a5fa", "#f472b6", "#fbbf24", "#4ade80", "#c084fc", "#fb923c"];

type Bars = { daily: SeriesPoint[]; intraday: SeriesPoint[] };

export default function CompareChart({
  mainSymbol,
  mainDaily,
  mainIntraday,
  compareSymbols,
  tf,
  now,
}: {
  mainSymbol: string;
  mainDaily: SeriesPoint[];
  mainIntraday: SeriesPoint[];
  compareSymbols: string[];
  tf: TimeframeKey;
  now: number;
}) {
  const [fetched, setFetched] = useState<Record<string, Bars | null>>({});
  // Track requested symbols in a ref (not state) so this effect depends only on
  // compareSymbols — depending on `fetched` made each re-run's cleanup cancel the
  // in-flight fetch, so comparisons never plotted. No "alive"/"mounted" flag: in
  // dev StrictMode the mount→unmount→remount would leave it false forever; React
  // 18+ no-ops setState after unmount anyway.
  const requested = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const sym of compareSymbols) {
      if (requested.current.has(sym)) continue;
      requested.current.add(sym);
      const url = sym.startsWith(ECON_PREFIX)
        ? `/api/econ-series/${encodeURIComponent(sym.slice(ECON_PREFIX.length))}`
        : `/api/ohlc/${encodeURIComponent(sym)}`;
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const toPts = (a: any[]): SeriesPoint[] => (a || []).map((b: any) => ({ t: b.t, c: b.c }));
          setFetched((p) => ({ ...p, [sym]: d ? { daily: toPts(d.daily), intraday: toPts(d.intraday) } : null }));
        })
        .catch(() => {
          requested.current.delete(sym); // allow a retry on failure
          setFetched((p) => ({ ...p, [sym]: null }));
        });
    }
  }, [compareSymbols]);

  const { rows, series } = useMemo(() => {
    const items = [{ symbol: mainSymbol, daily: mainDaily, intraday: mainIntraday }];
    for (const sym of compareSymbols) {
      const f = fetched[sym];
      if (f) items.push({ symbol: sym, daily: f.daily, intraday: f.intraday });
    }
    const { rows } = buildComparison(items, tf, now);
    const series = items.map((it, i) => ({ symbol: it.symbol, color: COLORS[i % COLORS.length], label: prettySym(it.symbol) }));
    return { rows, series };
  }, [mainSymbol, mainDaily, mainIntraday, compareSymbols, fetched, tf, now]);

  const loading = compareSymbols.some((s) => fetched[s] === undefined || fetched[s] === null);

  return (
    <div>
      <MultiLineChart rows={rows} series={series} tf={tf} hidden={new Set()} highlight={null} showEndLabels />
      <p className="mt-1 text-center text-[11px] text-[var(--text-4)]">
        Rebased to % change over the window — compare relative performance.
        {loading && compareSymbols.length > 0 && " · loading…"}
      </p>
    </div>
  );
}
