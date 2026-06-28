"use client";
import { useMemo, useState } from "react";

export interface CreditSeries { hy: [string, number][]; ig: [string, number][]; baa?: [string, number][] }

const TFS: [string, number][] = [["1M", 30], ["3M", 90], ["6M", 180], ["1Y", 365], ["3Y", 1100], ["5Y", 1830], ["10Y", 3660]];

/** Windowed IG/HY OAS + Moody's Baa–10Y credit-spread charts with a shared timeframe
 *  bar. Shared by the Rates & Credit page and the Economy dashboard. */
export default function CreditSpreads({ creditSeries, defaultDays = 365 }: { creditSeries?: CreditSeries; defaultDays?: number }) {
  const [days, setDays] = useState(defaultDays);
  const igSeries = creditSeries?.ig ?? [];
  const hySeries = creditSeries?.hy ?? [];
  const baaSeries = creditSeries?.baa ?? [];
  if (!igSeries.length && !hySeries.length && !baaSeries.length) return null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text-2)]">Credit spreads</h2>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {TFS.map(([lab, d]) => (
            <button key={lab} onClick={() => setDays(d)} className={"rounded-md px-2 py-1 text-xs transition-colors " + (days === d ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{lab}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OasCard label="Investment-grade OAS" hint="Spread over Treasuries on IG corporate bonds." note="ICE BofA · FRED carries ~3yr" color="#60a5fa" series={igSeries} days={days} />
        <OasCard label="High-yield OAS" hint="Junk-bond spread — the market's risk-appetite gauge." note="ICE BofA · FRED carries ~3yr" color="#f59e0b" series={hySeries} days={days} />
      </div>
      {baaSeries.length > 0 && (
        <div className="mt-4">
          <OasCard label="Baa – 10Y Treasury spread" hint="Moody's Baa (lowest investment-grade tier) corporate yield over the 10-year Treasury — a classic credit-risk gauge with decades of history, for the long cycle." note="Moody's · daily since 2014" color="#a855f7" series={baaSeries} days={days} />
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-4)]">OAS = option-adjusted spread (ICE BofA) — FRED&apos;s ICE license carries only a rolling ~3yr, so IG/HY top out at 3Y even with an API key; the Baa–10Y spread (Moody&apos;s) reaches back further for the longer cycle.</p>
    </section>
  );
}

function OasCard({ label, hint, note, color, series, days }: { label: string; hint: string; note?: string; color: string; series: [string, number][]; days: number }) {
  const cur = series.length ? series[series.length - 1][1] : null;
  const windowed = useMemo(() => {
    if (!series.length) return [];
    const lastT = new Date(series[series.length - 1][0]).getTime();
    const cutoff = lastT - days * 86_400_000;
    return series.filter((p) => new Date(p[0]).getTime() >= cutoff);
  }, [series, days]);

  const vals = series.map((p) => p[1]);
  const spanYrs = series.length > 1 ? Math.max(1, Math.round((new Date(series[series.length - 1][0]).getTime() - new Date(series[0][0]).getTime()) / (365 * 86_400_000))) : 0;
  const span = `the past ${spanYrs} years`;
  const below = cur != null && vals.length ? vals.filter((v) => v <= cur).length / vals.length : null;
  const read = below == null ? hint
    : below < 0.3 ? `Tighter than ${Math.round((1 - below) * 100)}% of ${span} — risk-on / complacent.`
    : below > 0.7 ? `Wider than ${Math.round(below * 100)}% of ${span} — credit stress building.`
    : `Mid-range vs. ${span}.`;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--text-2)]">{label}{note && <span className="ml-2 text-[10px] font-normal text-[var(--text-4)]">{note}</span>}</span>
        <span className="font-mono text-lg font-bold tabular-nums text-[var(--text)]">{cur == null ? "—" : `${cur.toFixed(2)}%`}</span>
      </div>
      <OasChart series={windowed} color={color} />
      <p className="mt-1 text-[11px] text-[var(--text-3)]">{read}</p>
    </div>
  );
}

function OasChart({ series, color }: { series: [string, number][]; color: string }) {
  const W = 480, H = 190, ML = 38, MR = 12, MT = 12, MB = 24;
  if (series.length < 2) return <div className="py-10 text-center text-xs text-[var(--text-3)]">Not enough data for this window.</div>;
  const times = series.map((p) => new Date(p[0]).getTime());
  const vals = series.map((p) => p[1]);
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  const pad = (vMax - vMin) * 0.12 || 0.1; vMin -= pad; vMax += pad;
  const tMin = times[0], tMax = times[times.length - 1];
  const x = (t: number) => ML + ((t - tMin) / (tMax - tMin || 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - vMin) / (vMax - vMin)) * (H - MT - MB);
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(times[i]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("");
  const rangeDays = (tMax - tMin) / 86_400_000;
  const fmt = (t: number) => new Date(t).toLocaleDateString("en-US", rangeDays <= 100 ? { month: "short", day: "numeric" } : { month: "short", year: "2-digit" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {[0, 0.5, 1].map((f, i) => {
        const v = vMin + f * (vMax - vMin);
        return <g key={i}><line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" /><text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{v.toFixed(2)}%</text></g>;
      })}
      {[0, 0.5, 1].map((f, i) => {
        const t = tMin + f * (tMax - tMin);
        return <text key={"x" + i} x={x(t)} y={H - 7} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize={9} fill="var(--text-4)">{fmt(t)}</text>;
      })}
      <line x1={ML} x2={ML} y1={MT} y2={H - MB} stroke="var(--border)" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} />
    </svg>
  );
}
