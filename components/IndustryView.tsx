"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { SectorMeta } from "@/lib/sectors";
import type { SectorSeries, StockRow, StockSeries } from "@/lib/types";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import { buildComparison, xyToPoints, isNearHigh, isNearLow } from "@/lib/compute";
import { colorFor, ETF_LINE_COLOR } from "@/lib/palette";
import { trendColor } from "@/lib/color";
import { fmtPct, fmtDateTime } from "@/lib/format";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import type { SeriesDef } from "./MultiLineChart";

const MultiLineChart = dynamic(() => import("./MultiLineChart"), { ssr: false });

export default function IndustryView({
  meta,
  industry,
  stocks,
  seriesBySymbol,
  etfSeries,
  generatedAt,
  universe,
}: {
  meta: SectorMeta;
  industry: string;
  stocks: StockRow[];
  seriesBySymbol: Record<string, StockSeries>;
  etfSeries: SectorSeries | null;
  generatedAt: string;
  universe: string;
}) {
  const [tf, setTf] = useState<TimeframeKey>("3m");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);

  const now = useMemo(() => Date.parse(generatedAt) || Date.now(), [generatedAt]);

  // Stable color per stock, assigned in market-cap order (independent of timeframe).
  const colorBySymbol = useMemo(() => {
    const m: Record<string, string> = { [meta.etf]: ETF_LINE_COLOR };
    stocks.forEach((s, i) => (m[s.symbol] = colorFor(i)));
    return m;
  }, [stocks, meta.etf]);

  const { rows, endPct } = useMemo(() => {
    const items = [
      {
        symbol: meta.etf,
        intraday: etfSeries?.intraday ?? [],
        daily: etfSeries?.daily ?? [],
      },
      ...stocks.map((s) => {
        const sr = seriesBySymbol[s.symbol];
        return {
          symbol: s.symbol,
          intraday: xyToPoints(sr?.intraday ?? []),
          daily: xyToPoints(sr?.daily ?? []),
        };
      }),
    ];
    const { rows, meta: cmeta } = buildComparison(items, tf, now);
    const endPct: Record<string, number | null> = {};
    for (const m of cmeta) endPct[m.symbol] = m.endPct;
    return { rows, endPct };
  }, [stocks, seriesBySymbol, etfSeries, meta.etf, tf, now]);

  // Chart series order (ETF first); legend sorted by performance with ETF pinned.
  const chartSeries: SeriesDef[] = useMemo(
    () => [
      { symbol: meta.etf, color: ETF_LINE_COLOR, isRef: true },
      ...stocks.map((s) => ({ symbol: s.symbol, color: colorBySymbol[s.symbol] })),
    ],
    [stocks, meta.etf, colorBySymbol],
  );

  const legend = useMemo(() => {
    const rowsArr = stocks.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      end: endPct[s.symbol] ?? s.returns[tf] ?? null,
      near: isNearHigh(s, 2) ? "high" : isNearLow(s, 2) ? "low" : null,
    }));
    rowsArr.sort((a, b) => (b.end ?? -1e9) - (a.end ?? -1e9));
    return rowsArr;
  }, [stocks, endPct, tf]);

  const toggle = (sym: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(sym) ? next.delete(sym) : next.add(sym);
      return next;
    });

  const allSymbols = [meta.etf, ...stocks.map((s) => s.symbol)];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* breadcrumb + header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-[#8b93a7]">
            <Link href={`/u/${universe}`} className="hover:text-[#e6e9f0]">
              {UNIVERSE_BY_ID[universe]?.name ?? "Sectors"}
            </Link>
            <span>/</span>
            <Link
              href={`/u/${universe}/sector/${meta.etf.toLowerCase()}`}
              className="hover:text-[#e6e9f0]"
            >
              {meta.etf} {meta.name}
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold">{industry}</h1>
          <p className="mt-1 text-xs text-[#8b93a7]">
            {stocks.length} constituents · each line rebased to % change · dashed
            white = {meta.etf} · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UniverseSwitcher current={universe} etf={meta.etf} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* chart */}
        <section className="min-w-0 flex-1 rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
          <MultiLineChart
            rows={rows}
            series={chartSeries}
            tf={tf}
            hidden={hidden}
            highlight={highlight}
          />
        </section>

        {/* interactive legend */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[#aab2c5]">
              {TIMEFRAMES.find((t) => t.key === tf)?.label} performance
            </span>
            <div className="flex gap-1 text-xs">
              <button
                onClick={() => setHidden(new Set())}
                className="rounded border border-[#2a2e39] px-2 py-0.5 text-[#8b93a7] hover:text-[#e6e9f0]"
              >
                All
              </button>
              <button
                onClick={() => setHidden(new Set(allSymbols))}
                className="rounded border border-[#2a2e39] px-2 py-0.5 text-[#8b93a7] hover:text-[#e6e9f0]"
              >
                None
              </button>
            </div>
          </div>

          <div className="max-h-[440px] overflow-y-auto rounded-xl border border-[#2a2e39] bg-[#131722]">
            {/* ETF reference row */}
            <LegendRow
              symbol={meta.etf}
              name={`${meta.name} (sector ETF)`}
              color={ETF_LINE_COLOR}
              end={endPct[meta.etf] ?? null}
              near={null}
              hidden={hidden.has(meta.etf)}
              onToggle={() => toggle(meta.etf)}
              onHover={() => setHighlight(meta.etf)}
              onLeave={() => setHighlight(null)}
              isRef
            />
            {legend.map((r) => (
              <LegendRow
                key={r.symbol}
                symbol={r.symbol}
                name={r.name}
                color={colorBySymbol[r.symbol]}
                end={r.end}
                near={r.near as "high" | "low" | null}
                hidden={hidden.has(r.symbol)}
                onToggle={() => toggle(r.symbol)}
                onHover={() => setHighlight(r.symbol)}
                onLeave={() => setHighlight(null)}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#8b93a7]">
            Click a row to hide/show its line · hover to highlight.
          </p>
        </aside>
      </div>
    </main>
  );
}

function LegendRow({
  symbol,
  name,
  color,
  end,
  near,
  hidden,
  onToggle,
  onHover,
  onLeave,
  isRef,
}: {
  symbol: string;
  name: string;
  color: string;
  end: number | null;
  near: "high" | "low" | null;
  hidden: boolean;
  onToggle: () => void;
  onHover: () => void;
  onLeave: () => void;
  isRef?: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={
        "flex w-full items-center gap-2 border-b border-[#1f2430] px-3 py-2 text-left transition-colors hover:bg-[#1a1f2e] " +
        (hidden ? "opacity-40" : "") +
        (isRef ? " bg-[#0f1420]" : "")
      }
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: color, outline: isRef ? "1px dashed #8b93a7" : "none" }}
      />
      <span className="w-12 shrink-0 font-mono text-sm font-semibold">{symbol}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-[#8b93a7]">{name}</span>
      {near && (
        <span className={near === "high" ? "text-[#22c55e]" : "text-[#ef4444]"}>
          {near === "high" ? "▲" : "▼"}
        </span>
      )}
      <span
        className="w-16 shrink-0 text-right text-sm tabular-nums"
        style={{ color: trendColor(end) }}
      >
        {fmtPct(end, 1)}
      </span>
    </button>
  );
}
