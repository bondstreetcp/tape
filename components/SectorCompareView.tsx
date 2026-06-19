"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { XY } from "@/lib/types";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { buildComparison, xyToPoints } from "@/lib/compute";
import { colorFor } from "@/lib/palette";
import { trendColor } from "@/lib/color";
import { fmtPct, fmtDateTime } from "@/lib/format";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import type { SeriesDef } from "./MultiLineChart";

const MultiLineChart = dynamic(() => import("./MultiLineChart"), { ssr: false });

interface SectorLine {
  etf: string;
  name: string;
  count: number;
  daily: XY[];
  intraday: XY[];
}

export default function SectorCompareView({
  universe,
  sectors,
  generatedAt,
}: {
  universe: string;
  sectors: SectorLine[];
  generatedAt: string;
}) {
  const [tf, setTf] = usePersistedTimeframe(null, "ytd");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);

  const now = useMemo(() => Date.parse(generatedAt) || Date.now(), [generatedAt]);

  const colorByEtf = useMemo(() => {
    const m: Record<string, string> = {};
    sectors.forEach((s, i) => (m[s.etf] = colorFor(i)));
    return m;
  }, [sectors]);

  const { rows, endPct } = useMemo(() => {
    const items = sectors.map((s) => ({
      symbol: s.etf,
      intraday: xyToPoints(s.intraday),
      daily: xyToPoints(s.daily),
    }));
    const { rows, meta } = buildComparison(items, tf, now);
    const endPct: Record<string, number | null> = {};
    for (const m of meta) endPct[m.symbol] = m.endPct;
    return { rows, endPct };
  }, [sectors, tf, now]);

  const chartSeries: SeriesDef[] = useMemo(
    () => sectors.map((s) => ({ symbol: s.etf, color: colorByEtf[s.etf] })),
    [sectors, colorByEtf],
  );

  const legend = useMemo(
    () =>
      sectors
        .map((s) => ({ ...s, end: endPct[s.etf] ?? null }))
        .sort((a, b) => (b.end ?? -1e9) - (a.end ?? -1e9)),
    [sectors, endPct],
  );

  const toggle = (etf: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(etf) ? next.delete(etf) : next.add(etf);
      return next;
    });

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/u/${universe}`}
            className="text-sm text-[#8b93a7] hover:text-[#e6e9f0]"
          >
            ← {UNIVERSE_BY_ID[universe]?.name ?? "Sectors"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Sector relative performance</h1>
          <p className="mt-1 text-xs text-[#8b93a7]">
            {sectors.length} sectors · SPDR sector ETFs rebased to % · as of{" "}
            {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UniverseSwitcher current={universe} />
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
            showEndLabels
          />
        </section>

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
                onClick={() => setHidden(new Set(sectors.map((s) => s.etf)))}
                className="rounded border border-[#2a2e39] px-2 py-0.5 text-[#8b93a7] hover:text-[#e6e9f0]"
              >
                None
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722]">
            {legend.map((s) => (
              <div
                key={s.etf}
                onMouseEnter={() => setHighlight(s.etf)}
                onMouseLeave={() => setHighlight(null)}
                className={
                  "flex items-center gap-2 border-b border-[#1f2430] px-3 py-2 transition-colors hover:bg-[#1a1f2e] " +
                  (hidden.has(s.etf) ? "opacity-40" : "")
                }
              >
                <button
                  onClick={() => toggle(s.etf)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: colorByEtf[s.etf] }}
                  />
                  <span className="font-mono text-sm font-semibold">{s.etf}</span>
                  <span className="min-w-0 truncate text-xs text-[#8b93a7]">
                    {s.name}
                  </span>
                </button>
                <span
                  className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums"
                  style={{ color: trendColor(s.end) }}
                >
                  {fmtPct(s.end, 1)}
                </span>
                <Link
                  href={`/u/${universe}/sector/${s.etf.toLowerCase()}`}
                  className="shrink-0 text-[#8b93a7] hover:text-[#60a5fa]"
                  title="Open sector"
                >
                  ↗
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#8b93a7]">
            Click a row to hide/show · hover to highlight · ↗ opens the sector.
          </p>
        </aside>
      </div>
    </main>
  );
}
