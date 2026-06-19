"use client";
import { useEffect, useMemo, useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { buildComparison } from "@/lib/compute";
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

  useEffect(() => {
    let alive = true;
    for (const sym of compareSymbols) {
      if (sym in fetched) continue;
      setFetched((p) => ({ ...p, [sym]: p[sym] ?? null })); // mark in-flight
      fetch(`/api/ohlc/${encodeURIComponent(sym)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          const toPts = (a: any[]): SeriesPoint[] => (a || []).map((b: any) => ({ t: b.t, c: b.c }));
          setFetched((p) => ({ ...p, [sym]: d ? { daily: toPts(d.daily), intraday: toPts(d.intraday) } : null }));
        })
        .catch(() => alive && setFetched((p) => ({ ...p, [sym]: null })));
    }
    return () => {
      alive = false;
    };
  }, [compareSymbols, fetched]);

  const { rows, series } = useMemo(() => {
    const items = [{ symbol: mainSymbol, daily: mainDaily, intraday: mainIntraday }];
    for (const sym of compareSymbols) {
      const f = fetched[sym];
      if (f) items.push({ symbol: sym, daily: f.daily, intraday: f.intraday });
    }
    const { rows } = buildComparison(items, tf, now);
    const series = items.map((it, i) => ({ symbol: it.symbol, color: COLORS[i % COLORS.length] }));
    return { rows, series };
  }, [mainSymbol, mainDaily, mainIntraday, compareSymbols, fetched, tf, now]);

  const loading = compareSymbols.some((s) => fetched[s] === undefined || fetched[s] === null);

  return (
    <div>
      <MultiLineChart rows={rows} series={series} tf={tf} hidden={new Set()} highlight={null} showEndLabels />
      <p className="mt-1 text-center text-[11px] text-[#5b6478]">
        Rebased to % change over the window — compare relative performance.
        {loading && compareSymbols.length > 0 && " · loading…"}
      </p>
    </div>
  );
}
