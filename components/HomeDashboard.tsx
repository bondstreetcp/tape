"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Snapshot } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { returnColor, trendColor } from "@/lib/color";
import { fmtPct, fmtDateTime } from "@/lib/format";
import { isNearHigh, isNearLow } from "@/lib/compute";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import ThresholdSelector from "./ThresholdSelector";
import UniverseSwitcher from "./UniverseSwitcher";

export default function HomeDashboard({
  snapshot,
  universe,
}: {
  snapshot: Snapshot;
  universe: string;
}) {
  const [tf, setTf] = useState<TimeframeKey>("1d");
  const [threshold, setThreshold] = useState(2);

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

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {UNIVERSE_BY_ID[universe]?.name ?? "Sector"} Screener
            </h1>
            <p className="mt-1 text-sm text-[#8b93a7]">
              {breadth.total} constituents · {snapshot.sectors.length} sectors · as of{" "}
              {fmtDateTime(snapshot.generatedAt)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link
                href={`/u/${universe}/screener`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2563eb]/50 bg-[#2563eb]/15 px-3 py-1.5 text-sm font-medium text-[#93c5fd] transition-colors hover:bg-[#2563eb]/25"
              >
                ⊞ Screener
              </Link>
              <Link
                href={`/u/${universe}/compare`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2563eb]/50 bg-[#2563eb]/15 px-3 py-1.5 text-sm font-medium text-[#93c5fd] transition-colors hover:bg-[#2563eb]/25"
              >
                ⇄ Compare sectors
              </Link>
              <Link
                href={`/u/${universe}/watchlist`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-1.5 text-sm font-medium text-[#aab2c5] transition-colors hover:border-[#3a4256]"
              >
                ★ Watchlist
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <UniverseSwitcher current={universe} />
            <TimeframeSelector value={tf} onChange={setTf} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2a2e39] bg-[#131722] px-4 py-3">
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {sectorStats.map((sec) => {
          const r = sec.returns[tf];
          return (
            <Link
              key={sec.etf}
              href={`/u/${universe}/sector/${sec.etf.toLowerCase()}`}
              className="group relative overflow-hidden rounded-xl border border-[#2a2e39] p-4 transition-transform hover:-translate-y-0.5 hover:border-[#3a4256]"
              style={{ background: returnColor(r, tf) }}
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

      <p className="mt-6 text-center text-xs text-[#8b93a7]">
        Click a sector to see its constituents grouped by industry, with a price
        chart and 52-week high/low highlighting.
      </p>
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
      <span className="text-[#8b93a7]">{label}</span>
      <span className="font-semibold tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
