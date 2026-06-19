"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { slugify } from "@/lib/slug";
import type { SectorMeta } from "@/lib/sectors";
import type { SectorAgg, SectorSeries, StockRow, StockSeries } from "@/lib/types";
import { TIMEFRAMES, COLOR_CLAMP, type TimeframeKey } from "@/lib/timeframes";
import { returnColor, trendColor } from "@/lib/color";
import { fmtPct, fmtMarketCap, fmtPrice, fmtDateTime } from "@/lib/format";
import {
  matchesFilter,
  sliceSeries,
  seriesChangePct,
  xyToPoints,
  isNearHigh,
  isNearLow,
  type HighLowFilter,
} from "@/lib/compute";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import ThresholdSelector from "./ThresholdSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import Treemap from "./Treemap";

const IndicatorChart = dynamic(() => import("./IndicatorChart"), { ssr: false });

const FILTERS: { key: HighLowFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "high", label: "Near 52w high" },
  { key: "low", label: "Near 52w low" },
  { key: "either", label: "Either" },
];

export default function SectorView({
  meta,
  sector,
  stocks,
  series,
  generatedAt,
  universe,
}: {
  meta: SectorMeta;
  sector: SectorAgg | null;
  stocks: StockRow[];
  series: SectorSeries | null;
  generatedAt: string;
  universe: string;
}) {
  const [tf, setTf] = useState<TimeframeKey>("1d");
  const [filter, setFilter] = useState<HighLowFilter>("all");
  const [threshold, setThreshold] = useState(2);
  const [selected, setSelected] = useState<string | null>(null);
  const router = useRouter();

  const now = useMemo(() => Date.parse(generatedAt) || Date.now(), [generatedAt]);

  const industries = useMemo(() => {
    const m = new Map<string, { count: number; cap: number }>();
    for (const s of stocks) {
      const e = m.get(s.industry) ?? { count: 0, cap: 0 };
      e.count++;
      e.cap += s.marketCap || 0;
      m.set(s.industry, e);
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, slug: slugify(name), ...v }))
      .sort((a, b) => b.cap - a.cap);
  }, [stocks]);

  const goToIndustry = (industry: string) =>
    router.push(`/u/${universe}/sector/${meta.etf.toLowerCase()}/${slugify(industry)}`);

  const chartPoints = useMemo(() => {
    if (!series) return [];
    return sliceSeries(series.intraday, series.daily, tf, now);
  }, [series, tf, now]);

  const windowChange = seriesChangePct(chartPoints);
  const sectorReturn = sector?.returns[tf] ?? windowChange;

  const counts = useMemo(() => {
    let high = 0;
    let low = 0;
    for (const s of stocks) {
      if (isNearHigh(s, threshold)) high++;
      if (isNearLow(s, threshold)) low++;
    }
    const matching = stocks.filter((s) => matchesFilter(s, filter, threshold)).length;
    return { high, low, matching };
  }, [stocks, threshold, filter]);

  const selectedRow = selected
    ? stocks.find((s) => s.symbol === selected) ?? null
    : null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-[#8b93a7]">
            <Link href={`/u/${universe}`} className="hover:text-[#e6e9f0]">
              {UNIVERSE_BY_ID[universe]?.name ?? "Sectors"}
            </Link>
            <span>/</span>
            <span className="text-[#aab2c5]">{meta.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">{meta.etf}</h1>
            <span className="text-lg text-[#aab2c5]">{meta.name}</span>
            <span
              className="text-lg font-semibold tabular-nums"
              style={{ color: trendColor(sectorReturn) }}
            >
              {fmtPct(sectorReturn)}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#8b93a7]">
            {stocks.length} constituents · {fmtMarketCap(sector?.marketCap)} total
            cap · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UniverseSwitcher current={universe} etf={meta.etf} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </div>

      {/* price chart with indicators */}
      <section className="mb-5 rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[#aab2c5]">
            {meta.etf} price · {TIMEFRAMES.find((t) => t.key === tf)?.label}
          </h2>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: trendColor(windowChange) }}
          >
            {fmtPct(windowChange)} this range
          </span>
        </div>
        <IndicatorChart points={chartPoints} tf={tf} up={(windowChange ?? 0) >= 0} />
      </section>

      {/* industries — drill into a multi-line comparison */}
      <section className="mb-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-[#aab2c5]">Industries</span>
          <span className="text-xs text-[#8b93a7]">
            click any for a line chart comparing all its constituents
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {industries.map((ind) => (
            <Link
              key={ind.slug}
              href={`/u/${universe}/sector/${meta.etf.toLowerCase()}/${ind.slug}`}
              className="group inline-flex items-center gap-2 rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-1.5 text-sm transition-colors hover:border-[#3a4256] hover:bg-[#1a1f2e]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#60a5fa]">
                <polyline
                  points="3,17 9,11 13,15 21,6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{ind.name}</span>
              <span className="text-xs text-[#8b93a7]">{ind.count}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* controls */}
      <section className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const active = f.key === filter;
            const count =
              f.key === "high" ? counts.high : f.key === "low" ? counts.low : null;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
                  (active
                    ? "border-[#2563eb] bg-[#2563eb]/20 text-white"
                    : "border-[#2a2e39] bg-[#131722] text-[#8b93a7] hover:text-[#e6e9f0]")
                }
              >
                {f.label}
                {count != null && (
                  <span className="ml-1.5 text-xs text-[#8b93a7]">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <ThresholdSelector value={threshold} onChange={setThreshold} />
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ColorLegend tf={tf} />
        <span className="text-xs text-[#8b93a7]">
          Box size = market cap · color = {TIMEFRAMES.find((t) => t.key === tf)?.label}{" "}
          return · click an industry label for its line chart · showing{" "}
          {counts.matching}/{stocks.length}
        </span>
      </div>

      {/* treemap */}
      <section className="rounded-xl border border-[#2a2e39] bg-[#0b0e14] p-2">
        <Treemap
          stocks={stocks}
          tf={tf}
          filter={filter}
          threshold={threshold}
          selected={selected}
          onSelect={setSelected}
          onIndustryClick={goToIndustry}
        />
      </section>

      {selectedRow && (
        <StockDetail
          row={selectedRow}
          tf={tf}
          now={now}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}

function ColorLegend({ tf }: { tf: TimeframeKey }) {
  const clamp = COLOR_CLAMP[tf];
  const stops = [-clamp, -clamp / 2, 0, clamp / 2, clamp];
  return (
    <div className="flex items-center gap-2 text-xs text-[#8b93a7]">
      <span>-{clamp}%</span>
      <div className="flex h-3 overflow-hidden rounded">
        {stops.map((s, i) => (
          <div key={i} style={{ background: returnColor(s, tf), width: 26, height: "100%" }} />
        ))}
      </div>
      <span>+{clamp}%</span>
    </div>
  );
}

function StockDetail({
  row,
  tf,
  now,
  onClose,
}: {
  row: StockRow;
  tf: TimeframeKey;
  now: number;
  onClose: () => void;
}) {
  const [series, setSeries] = useState<StockSeries | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setSeries(null);
    fetch(`/api/series/${encodeURIComponent(row.symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active) {
          setSeries(d);
          setLoading(false);
        }
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [row.symbol]);

  const points = useMemo(
    () =>
      series
        ? sliceSeries(xyToPoints(series.intraday), xyToPoints(series.daily), tf, now)
        : [],
    [series, tf, now],
  );
  const change = seriesChangePct(points);

  const span = row.fiftyTwoWeekHigh - row.fiftyTwoWeekLow;
  const pos =
    span > 0
      ? Math.min(100, Math.max(0, ((row.price - row.fiftyTwoWeekLow) / span) * 100))
      : 50;

  return (
    <section className="mt-4 rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-bold">{row.symbol}</span>
            <span className="text-sm text-[#8b93a7]">{row.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-[#8b93a7]">
            {row.industry} · {fmtMarketCap(row.marketCap)} cap
          </div>
        </div>
        <button onClick={onClose} className="text-sm text-[#8b93a7] hover:text-[#e6e9f0]">
          ✕
        </button>
      </div>

      {/* per-stock price chart with indicators */}
      <div className="mt-3">
        {loading ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-[#8b93a7]">
            Loading {row.symbol} price history…
          </div>
        ) : (
          <IndicatorChart points={points} tf={tf} up={(change ?? 0) >= 0} />
        )}
      </div>

      {/* 52-week range bar */}
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-xs text-[#8b93a7]">
          <span>52-wk low ${fmtPrice(row.fiftyTwoWeekLow)}</span>
          <span className="font-semibold text-[#e6e9f0]">${fmtPrice(row.price)}</span>
          <span>52-wk high ${fmtPrice(row.fiftyTwoWeekHigh)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-[#ef4444] via-[#6b7280] to-[#22c55e]">
          <div
            className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-white shadow"
            style={{ left: `calc(${pos}% - 2px)` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-[#8b93a7]">
          <span className="text-[#ef4444]">+{row.pctFromLow.toFixed(1)}% above low</span>
          <span className="text-[#22c55e]">{row.pctFromHigh.toFixed(1)}% from high</span>
        </div>
      </div>

      {/* timeframe returns */}
      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {TIMEFRAMES.map((t) => (
          <div
            key={t.key}
            className="rounded-lg border border-[#2a2e39] bg-[#0b0e14] px-2 py-2 text-center"
          >
            <div className="text-[11px] text-[#8b93a7]">{t.label}</div>
            <div
              className="mt-0.5 text-sm font-semibold tabular-nums"
              style={{ color: trendColor(row.returns[t.key]) }}
            >
              {fmtPct(row.returns[t.key], 1)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
