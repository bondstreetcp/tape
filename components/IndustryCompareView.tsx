"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { SectorMeta } from "@/lib/sectors";
import type { SectorSeries, XY } from "@/lib/types";
import { TIMEFRAMES, parseTimeframe, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { buildComparison, xyToPoints } from "@/lib/compute";
import { colorFor, ETF_LINE_COLOR } from "@/lib/palette";
import { trendColor } from "@/lib/color";
import { fmtPct, fmtDateTime, fmtMarketCap } from "@/lib/format";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import type { SeriesDef } from "./MultiLineChart";

const MultiLineChart = dynamic(() => import("./MultiLineChart"), { ssr: false });

interface IndustryAgg {
  industry: string;
  slug: string;
  count: number;
  cap: number;
  daily: XY[];
  intraday: XY[];
}

export default function IndustryCompareView({
  meta,
  universe,
  industries,
  etfSeries,
  generatedAt,
}: {
  meta: SectorMeta;
  universe: string;
  industries: IndustryAgg[];
  etfSeries: SectorSeries | null;
  generatedAt: string;
}) {
  const searchParams = useSearchParams();
  const [tf, setTf] = usePersistedTimeframe(searchParams.get("tf"), "3m");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);

  const now = useMemo(() => Date.parse(generatedAt) || Date.now(), [generatedAt]);

  const colorByKey = useMemo(() => {
    const m: Record<string, string> = { [meta.etf]: ETF_LINE_COLOR };
    industries.forEach((ind, i) => (m[ind.industry] = colorFor(i)));
    return m;
  }, [industries, meta.etf]);

  const { rows, endPct } = useMemo(() => {
    const items = [
      {
        symbol: meta.etf,
        intraday: etfSeries?.intraday ?? [],
        daily: etfSeries?.daily ?? [],
      },
      ...industries.map((ind) => ({
        symbol: ind.industry,
        intraday: xyToPoints(ind.intraday),
        daily: xyToPoints(ind.daily),
      })),
    ];
    const { rows, meta: cmeta } = buildComparison(items, tf, now);
    const endPct: Record<string, number | null> = {};
    for (const m of cmeta) endPct[m.symbol] = m.endPct;
    return { rows, endPct };
  }, [industries, etfSeries, meta.etf, tf, now]);

  const chartSeries: SeriesDef[] = useMemo(
    () => [
      { symbol: meta.etf, color: ETF_LINE_COLOR, isRef: true },
      ...industries.map((ind) => ({ symbol: ind.industry, color: colorByKey[ind.industry] })),
    ],
    [industries, meta.etf, colorByKey],
  );

  const legend = useMemo(() => {
    return industries
      .map((ind) => ({ ...ind, end: endPct[ind.industry] ?? null }))
      .sort((a, b) => (b.end ?? -1e9) - (a.end ?? -1e9));
  }, [industries, endPct]);

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const allKeys = [meta.etf, ...industries.map((i) => i.industry)];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/u/${universe}/sector/${meta.etf.toLowerCase()}?tf=${tf}`}
            className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-1.5 text-sm font-medium text-[#aab2c5] transition-colors hover:border-[#3a4256] hover:text-[#e6e9f0]"
          >
            ← Back to {meta.name}
          </Link>
          <div className="flex items-center gap-2 text-sm text-[#8b93a7]">
            <Link href={`/u/${universe}`} className="hover:text-[#e6e9f0]">
              {UNIVERSE_BY_ID[universe]?.name ?? "Sectors"}
            </Link>
            <span>/</span>
            <Link
              href={`/u/${universe}/sector/${meta.etf.toLowerCase()}?tf=${tf}`}
              className="hover:text-[#e6e9f0]"
            >
              {meta.etf} {meta.name}
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold">
            {meta.name} — industry relative performance
          </h1>
          <p className="mt-1 text-xs text-[#8b93a7]">
            {industries.length} sub-industries · each line = a cap-weighted index
            rebased to % · dashed white = {meta.etf} (whole sector) · as of{" "}
            {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UniverseSwitcher current={universe} etf={meta.etf} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <section className="min-w-0 flex-1 rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
          <MultiLineChart
            rows={rows}
            series={chartSeries}
            tf={tf}
            hidden={hidden}
            highlight={highlight}
          />
        </section>

        <aside className="w-full shrink-0 lg:w-80">
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
                onClick={() => setHidden(new Set(allKeys))}
                className="rounded border border-[#2a2e39] px-2 py-0.5 text-[#8b93a7] hover:text-[#e6e9f0]"
              >
                None
              </button>
            </div>
          </div>

          <div className="max-h-[440px] overflow-y-auto rounded-xl border border-[#2a2e39] bg-[#131722]">
            <Row
              label={`${meta.name} (whole sector)`}
              color={ETF_LINE_COLOR}
              meta={meta.etf}
              end={endPct[meta.etf] ?? null}
              hidden={hidden.has(meta.etf)}
              onToggle={() => toggle(meta.etf)}
              onHover={() => setHighlight(meta.etf)}
              onLeave={() => setHighlight(null)}
              isRef
              href={`/u/${universe}/sector/${meta.etf.toLowerCase()}`}
            />
            {legend.map((ind) => (
              <Row
                key={ind.industry}
                label={ind.industry}
                color={colorByKey[ind.industry]}
                meta={`${ind.count} · ${fmtMarketCap(ind.cap)}`}
                end={ind.end}
                hidden={hidden.has(ind.industry)}
                onToggle={() => toggle(ind.industry)}
                onHover={() => setHighlight(ind.industry)}
                onLeave={() => setHighlight(null)}
                href={`/u/${universe}/sector/${meta.etf.toLowerCase()}/${ind.slug}?tf=${tf}`}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#8b93a7]">
            Click a row to hide/show · hover to highlight · the ↗ opens that
            sub-industry's constituents.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Row({
  label,
  color,
  meta,
  end,
  hidden,
  onToggle,
  onHover,
  onLeave,
  isRef,
  href,
}: {
  label: string;
  color: string;
  meta: string;
  end: number | null;
  hidden: boolean;
  onToggle: () => void;
  onHover: () => void;
  onLeave: () => void;
  isRef?: boolean;
  href: string;
}) {
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={
        "flex items-center gap-2 border-b border-[#1f2430] px-3 py-2 transition-colors hover:bg-[#1a1f2e] " +
        (hidden ? "opacity-40 " : "") +
        (isRef ? "bg-[#0f1420]" : "")
      }
    >
      <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm"
          style={{ background: color, outline: isRef ? "1px dashed #8b93a7" : "none" }}
        />
        <span className="min-w-0">
          <span className="block truncate text-sm">{label}</span>
          <span className="block text-[11px] text-[#8b93a7]">{meta}</span>
        </span>
      </button>
      <span
        className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums"
        style={{ color: trendColor(end) }}
      >
        {fmtPct(end, 1)}
      </span>
      <Link
        href={href}
        className="shrink-0 text-[#8b93a7] hover:text-[#60a5fa]"
        title="Open constituents"
      >
        ↗
      </Link>
    </div>
  );
}
