"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Snapshot } from "@/lib/types";
import type { CatalystMap } from "@/lib/catalysts";
import type { TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { returnColor, trendColor } from "@/lib/color";
import { fmtPct, fmtDateTime } from "@/lib/format";
import { isNearHigh, isNearLow } from "@/lib/compute";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import ThresholdSelector from "./ThresholdSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import MoversSection from "./MoversSection";
import AnalystFeed from "./AnalystFeed";
import { useIsLight } from "./useIsLight";
import MarketAlert from "./MarketAlert";
import Treemap from "./Treemap";
import IndexChart from "./IndexChart";

export default function HomeDashboard({
  snapshot,
  universe,
  catalysts = {},
}: {
  snapshot: Snapshot;
  universe: string;
  catalysts?: CatalystMap;
}) {
  const [tf, setTf] = usePersistedTimeframe(null, "1d");
  const [threshold, setThreshold] = useState(2);
  const light = useIsLight();
  const router = useRouter();
  const meta = UNIVERSE_BY_ID[universe];
  const intl = !!meta?.international;

  const sectorStats = useMemo(() => {
    return snapshot.sectors
      .map((sec) => {
        const members = snapshot.stocks.filter((s) => s.etf === sec.etf);
        let nearHigh = 0;
        let nearLow = 0;
        for (const m of members) {
          if (isNearHigh(m, threshold)) nearHigh++;
          if (isNearLow(m, threshold)) nearLow++;
        }
        return { ...sec, nearHigh, nearLow };
      })
      .sort((a, b) => (b.returns[tf] ?? -999) - (a.returns[tf] ?? -999));
  }, [snapshot, tf, threshold]);

  const breadth = useMemo(() => {
    let up = 0;
    let down = 0;
    let nearHigh = 0;
    let nearLow = 0;
    for (const s of snapshot.stocks) {
      const r = s.returns[tf];
      if (r != null && r > 0) up++;
      else if (r != null && r < 0) down++;
      if (isNearHigh(s, threshold)) nearHigh++;
      if (isNearLow(s, threshold)) nearLow++;
    }
    return { up, down, nearHigh, nearLow, total: snapshot.stocks.length };
  }, [snapshot, tf, threshold]);

  // Cap-weighted return of the constituents for the selected timeframe — a faithful stand-in
  // for the index's move (the published indices are cap-weighted too). We weight by each
  // name's START-of-period cap, recovered as cap/(1+return); weighting by the current cap
  // would over-count names that already rallied (their cap is inflated by the very move we're
  // averaging), badly skewing longer windows. Returns are stored in percent.
  const indexReturn = useMemo(() => {
    let wsum = 0;
    let rsum = 0;
    for (const s of snapshot.stocks) {
      const r = s.returns[tf];
      const cap = s.marketCap;
      if (r == null || cap == null || !(cap > 0)) continue;
      const denom = 1 + r / 100;
      if (denom <= 0) continue; // skip ~total-loss outliers (start cap → ∞)
      const cap0 = cap / denom;
      wsum += cap0;
      rsum += cap0 * r;
    }
    return wsum > 0 ? rsum / wsum : null;
  }, [snapshot, tf]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                {UNIVERSE_BY_ID[universe]?.name ?? "Markets"}
              </h1>
              {indexReturn != null && (
                <span className="text-lg font-semibold tabular-nums sm:text-xl" style={{ color: trendColor(indexReturn) }}>
                  {fmtPct(indexReturn, 2)}
                  <span className="ml-1 align-middle text-xs font-normal text-[var(--text-4)]">{tf.toUpperCase()}</span>
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--text-3)]">
              {breadth.total} constituents{intl ? "" : ` · ${snapshot.sectors.length} sectors`} · as of{" "}
              {fmtDateTime(snapshot.generatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <UniverseSwitcher current={universe} />
            <TimeframeSelector value={tf} onChange={setTf} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Stat label="Advancing" value={`${breadth.up}`} color="#22c55e" />
            <Stat label="Declining" value={`${breadth.down}`} color="#ef4444" />
            <Link href={`/u/${universe}/screener?filter=high`} className="hover:underline" title="Open in screener">
              <Stat label="Near 52-wk high" value={`${breadth.nearHigh}`} color="#22c55e" />
            </Link>
            <Link href={`/u/${universe}/screener?filter=low`} className="hover:underline" title="Open in screener">
              <Stat label="Near 52-wk low" value={`${breadth.nearLow}`} color="#ef4444" />
            </Link>
          </div>
          <ThresholdSelector value={threshold} onChange={setThreshold} />
        </div>
      </header>

      <MarketAlert />

      {intl ? (
        // International indices: show the index chart + a constituent heatmap
        // (grouped by sector NAME), not US-GICS sector buckets.
        <div className="flex flex-col gap-3">
          {meta?.indexSymbol && <IndexChart symbol={meta.indexSymbol} name={meta.name} />}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2">
            <Treemap
              stocks={snapshot.stocks}
              tf={tf}
              filter="all"
              threshold={threshold}
              selected={null}
              onSelect={(s) => { if (s) router.push(`/u/${universe}/stock/${encodeURIComponent(s)}`); }}
              groupBy="nativeSector"
            />
          </div>
          <p className="text-center text-xs text-[var(--text-3)]">
            All constituents — sized by market cap, colored by {tf.toUpperCase()} return, grouped by sector. Click a tile to open the stock.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {sectorStats.map((sec) => {
            const r = sec.returns[tf];
            return (
              <Link
                key={sec.etf}
                href={`/u/${universe}/sector/${sec.etf.toLowerCase()}`}
                className="group relative overflow-hidden rounded-xl border border-[var(--border)] p-4 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.45)] transition-transform hover:-translate-y-0.5 hover:border-[var(--border-strong)]"
                style={{ background: returnColor(r, tf, light) }}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono text-lg font-bold leading-none">
                      {sec.etf}
                    </div>
                    <div className="mt-1 text-xs text-white/70">{sec.name}</div>
                  </div>
                  <div className="text-right text-2xl font-semibold tabular-nums">
                    {fmtPct(r, 2)}
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between text-xs text-white/80">
                  <span>{sec.count} stocks</span>
                  <span className="flex items-center gap-2">
                    <span className="text-[#bbf7d0]">▲ {sec.nearHigh}</span>
                    <span className="text-[#fecaca]">▼ {sec.nearLow}</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <MoversSection universe={universe} stocks={snapshot.stocks} tf={tf} catalysts={catalysts} />

      <AnalystFeed universe={universe} />

      {!intl && (
        <p className="mt-6 text-center text-xs text-[var(--text-3)]">
          Click a sector to see its constituents grouped by industry, with a price
          chart and 52-week high/low highlighting.
        </p>
      )}
    </main>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[var(--text-3)]">{label}</span>
      <span className="font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
