"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { slugify } from "@/lib/slug";
import type { SectorMeta } from "@/lib/sectors";
import type { SectorAgg, SectorSeries, StockRow } from "@/lib/types";
import { TIMEFRAMES, COLOR_CLAMP, parseTimeframe, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { returnColor, trendColor } from "@/lib/color";
import { fmtPct, fmtMarketCap, fmtDateTime } from "@/lib/format";
import {
  matchesFilter,
  sliceSeries,
  seriesChangePct,
  isNearHigh,
  isNearLow,
  type HighLowFilter,
} from "@/lib/compute";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import ThresholdSelector from "./ThresholdSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import Treemap from "./Treemap";
import { useIsLight } from "./useIsLight";

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
  const searchParams = useSearchParams();
  const [tf, setTf] = usePersistedTimeframe(searchParams.get("tf"), "1d");
  const [filter, setFilter] = useState<HighLowFilter>("all");
  const [threshold, setThreshold] = useState(2);
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
    router.push(
      `/u/${universe}/sector/${meta.etf.toLowerCase()}/${slugify(industry)}?tf=${tf}`,
    );

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

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
            <Link href={`/u/${universe}`} className="hover:text-[var(--text)]">
              {UNIVERSE_BY_ID[universe]?.name ?? "Sectors"}
            </Link>
            <span>/</span>
            <span className="text-[var(--text-2)]">{meta.name}</span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold">{meta.etf}</h1>
            <span className="text-lg text-[var(--text-2)]">{meta.name}</span>
            <span
              className="text-lg font-semibold tabular-nums"
              style={{ color: trendColor(sectorReturn) }}
            >
              {fmtPct(sectorReturn)}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-3)]">
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
      <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-2)]">
            {meta.etf} price · {TIMEFRAMES.find((t) => t.key === tf)?.label}
          </h2>
          <span
            className="text-sm font-semibold tabular-nums"
            style={{ color: trendColor(windowChange) }}
          >
            {fmtPct(windowChange)} this range
          </span>
        </div>
        <IndicatorChart
          daily={series?.daily ?? []}
          intraday={series?.intraday ?? []}
          tf={tf}
          now={now}
          up={(windowChange ?? 0) >= 0}
          symbol={meta.etf}
        />
      </section>

      {/* industries — drill into a multi-line comparison */}
      <section className="mb-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-2)]">Industries</span>
            <span className="text-xs text-[var(--text-3)]">
              click any for a line chart of its constituents
            </span>
          </div>
          <Link
            href={`/u/${universe}/sector/${meta.etf.toLowerCase()}/compare?tf=${tf}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2563eb]/50 bg-[#2563eb]/15 px-3 py-1.5 text-sm font-medium text-[#93c5fd] transition-colors hover:bg-[#2563eb]/25"
          >
            ⇄ Compare sub-industries
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {industries.map((ind) => (
            <Link
              key={ind.slug}
              href={`/u/${universe}/sector/${meta.etf.toLowerCase()}/${ind.slug}?tf=${tf}`}
              className="group inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
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
              <span className="text-xs text-[var(--text-3)]">{ind.count}</span>
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
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")
                }
              >
                {f.label}
                {count != null && (
                  <span className="ml-1.5 text-xs text-[var(--text-3)]">{count}</span>
                )}
              </button>
            );
          })}
        </div>
        <ThresholdSelector value={threshold} onChange={setThreshold} />
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ColorLegend tf={tf} />
        <span className="text-xs text-[var(--text-3)]">
          Box size = market cap · color = {TIMEFRAMES.find((t) => t.key === tf)?.label}{" "}
          return · click an industry label for its line chart · showing{" "}
          {counts.matching}/{stocks.length}
        </span>
      </div>

      {/* treemap */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2">
        <Treemap
          stocks={stocks}
          tf={tf}
          filter={filter}
          threshold={threshold}
          selected={null}
          onSelect={(sym) =>
            sym && router.push(`/u/${universe}/stock/${encodeURIComponent(sym)}`)
          }
          onIndustryClick={goToIndustry}
        />
      </section>

    </main>
  );
}

function ColorLegend({ tf }: { tf: TimeframeKey }) {
  const light = useIsLight();
  const clamp = COLOR_CLAMP[tf];
  const stops = [-clamp, -clamp / 2, 0, clamp / 2, clamp];
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--text-3)]">
      <span>-{clamp}%</span>
      <div className="flex h-3 overflow-hidden rounded">
        {stops.map((s, i) => (
          <div key={i} style={{ background: returnColor(s, tf, light), width: 26, height: "100%" }} />
        ))}
      </div>
      <span>+{clamp}%</span>
    </div>
  );
}

