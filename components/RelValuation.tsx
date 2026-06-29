"use client";
import { useEffect, useState } from "react";
import type { RelStat } from "@/lib/relValuation";
import type { MultipleKey } from "@/lib/valuationHistory";

// inlined (not imported from lib/valuationHistory — that module pulls in fs, which can't bundle client-side)
const ML: Record<MultipleKey, string> = { pe: "P/E", evEbitda: "EV/EBITDA", ps: "P/S", pb: "P/B" };

// International tickers have no EDGAR-built valuation history → skip the fetch (the route would 404 anyway).
const NON_US = /\.(T|HK|KS|L|PA|AS|DE|MI|SW|TO|BR|ST|MX|MC|HE|OL|ST|VI)$/i;

type Resp = { available: true; label: string; asOf: string | null; stats: RelStat[] } | "err" | null;

function Spark({ stat, rich }: { stat: RelStat; rich: boolean }) {
  const pts = stat.series.map((p) => p.rel);
  if (pts.length < 2 || stat.medianRel == null) return null;
  const lo = Math.min(...pts, stat.medianRel), hi = Math.max(...pts, stat.medianRel);
  const W = 120, H = 28;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H;
  const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-[120px]" preserveAspectRatio="none">
      <line x1={0} x2={W} y1={y(stat.medianRel)} y2={y(stat.medianRel)} stroke="var(--text-4)" strokeOpacity={0.5} strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={rich ? "#ef4444" : "#22c55e"} strokeWidth={1.4} />
    </svg>
  );
}

export default function RelValuation({ symbol }: { symbol: string }) {
  const [d, setD] = useState<Resp>(null);
  useEffect(() => {
    if (NON_US.test(symbol)) { setD("err"); return; }
    let live = true;
    fetch(`/api/rel-valuation/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((j) => { if (live) setD(j?.available ? j : "err"); })
      .catch(() => { if (live) setD("err"); });
    return () => { live = false; };
  }, [symbol]);

  if (d == null || d === "err") return null; // silent until resolved / when unavailable (intl, no history)

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Valuation vs the {d.label}</h3>
        <span className="text-[11px] text-[var(--text-4)]">multiple ÷ index median, over ~10yr</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[440px] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[var(--text-3)]">
              <th className="py-1 pr-2 font-medium">Multiple</th>
              <th className="px-2 py-1 text-right font-medium">Co</th>
              <th className="px-2 py-1 text-right font-medium">{d.label}</th>
              <th className="px-2 py-1 text-right font-medium" title="Company multiple ÷ index multiple, now">vs index</th>
              <th className="px-2 py-1 text-right font-medium" title="That relative vs its own 10-yr median (negative = cheaper vs market than usual)">vs own norm</th>
              <th className="pl-2 py-1 text-right font-medium">10yr relative</th>
            </tr>
          </thead>
          <tbody>
            {d.stats.map((s) => {
              const rich = (s.pctOfMedian ?? 0) > 0;
              return (
                <tr key={s.mk} className="border-b border-[var(--divider)] last:border-0">
                  <td className="py-1.5 pr-2 text-[var(--text-2)]">{ML[s.mk]}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text)]">{s.current?.toFixed(1) ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{s.currentIdx?.toFixed(1) ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-[var(--text-2)]">{s.currentRel != null ? `${s.currentRel.toFixed(2)}×` : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold" style={{ color: s.pctOfMedian == null ? "var(--text-3)" : rich ? "#ef4444" : "#22c55e" }}>{s.pctOfMedian == null ? "—" : `${s.pctOfMedian >= 0 ? "+" : ""}${s.pctOfMedian.toFixed(0)}%`}</td>
                  <td className="pl-2 py-1.5"><div className="flex justify-end"><Spark stat={s} rich={rich} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-[var(--text-4)]">
        Index = median multiple across the {d.label} (today&apos;s members, median-of-ratios — a relative-richness gauge, not a cap-weighted point-in-time index P/E). &quot;vs own norm&quot; compares the current relative to its own 10-yr median: green = cheaper vs the market than usual. US names only.
      </p>
    </section>
  );
}
