"use client";
import { useEffect, useMemo, useState } from "react";
import type { QuarterPoint } from "@/lib/financials";
import { LoadingState } from "./Spinner";

// Overlay 2–5 tickers' margin / revenue-growth trajectories on one time-axis chart (each
// company's own fiscal quarters, so the x-axis is real time, not an index). Pick the metric;
// toggle spot-quarter vs trailing-12-month. Data from /api/quarterly-fundamentals per ticker.

type Metric = "gm" | "om" | "g";
const METRICS: { key: Metric; label: string }[] = [
  { key: "gm", label: "Gross margin" },
  { key: "om", label: "EBIT margin" },
  { key: "g", label: "Revenue growth · YoY" },
];
const RANGES: [string, number][] = [["5Y", 5], ["10Y", 10], ["Max", 0]];
const DAY = 86_400_000;
const pct1 = (f: number) => `${(f * 100).toFixed(1)}%`;
const pctS = (f: number) => `${f >= 0 ? "+" : ""}${(f * 100).toFixed(1)}%`;

interface Pt { t: number; v: number }

function compute(q: QuarterPoint[], metric: Metric, mode: "ttm" | "spot"): Pt[] {
  const sum4 = (end: number, k: keyof QuarterPoint) => {
    if (end < 3) return null;
    let s = 0;
    for (let j = end - 3; j <= end; j++) { const v = q[j][k]; if (typeof v !== "number") return null; s += v; }
    return s;
  };
  const out: Pt[] = [];
  for (let i = 0; i < q.length; i++) {
    let rev: number | null, gp: number | null, oi: number | null, revPrev: number | null;
    if (mode === "ttm") { rev = sum4(i, "rev"); gp = sum4(i, "gp"); oi = sum4(i, "oi"); revPrev = sum4(i - 4, "rev"); }
    else { rev = q[i].rev; gp = q[i].gp; oi = q[i].oi; revPrev = i >= 4 ? q[i - 4].rev : null; }
    let v: number | null = null;
    if (metric === "gm") v = gp != null && rev != null && rev > 0 ? gp / rev : null;
    else if (metric === "om") v = oi != null && rev != null && rev > 0 ? oi / rev : null;
    else v = revPrev != null && revPrev > 0 && rev != null ? rev / revPrev - 1 : null;
    if (v != null) out.push({ t: Date.parse(q[i].date), v });
  }
  return out;
}

export default function CompareOverlay({ tickers }: { tickers: { symbol: string; color: string }[] }) {
  const [raw, setRaw] = useState<Record<string, QuarterPoint[]>>({});
  const [metric, setMetric] = useState<Metric>("gm");
  const [mode, setMode] = useState<"ttm" | "spot">("ttm");
  const [years, setYears] = useState(10);
  const [hi, setHi] = useState<number | null>(null);

  useEffect(() => {
    for (const { symbol } of tickers) {
      if (raw[symbol]) continue;
      fetch(`/api/quarterly-fundamentals/${encodeURIComponent(symbol)}`)
        .then((r) => r.json())
        .then((d) => setRaw((p) => (p[symbol] ? p : { ...p, [symbol]: Array.isArray(d?.quarters) ? d.quarters : [] })))
        .catch(() => setRaw((p) => ({ ...p, [symbol]: [] })));
    }
  }, [tickers, raw]);

  const series = useMemo(
    () => tickers.map(({ symbol, color }) => ({ symbol, color, pts: compute(raw[symbol] || [], metric, mode) })),
    [tickers, raw, metric, mode],
  );

  const loaded = tickers.every((t) => raw[t.symbol]);
  const allPts = series.flatMap((s) => s.pts);

  if (!loaded) return <Shell><LoadingState className="py-12" /></Shell>;
  if (allPts.length < 2) return <Shell><div className="py-16 text-center text-xs text-[var(--text-3)]">No quarterly history for these tickers.</div></Shell>;

  // window to the last `years`. The x-axis time domain spans the full quarterly range across all
  // tickers (independent of the selected metric), so switching to a sparse metric — e.g. gross
  // margin, which payment networks / financials (V, MA) don't report a clean gross profit for in
  // their deep filings — keeps the same timeline and the short line honestly shows where data
  // exists, instead of collapsing the axis to the few available points.
  const allQTs = Object.values(raw).flat().map((q) => Date.parse(q.date)).filter((t) => Number.isFinite(t));
  const maxT = allQTs.length ? Math.max(...allQTs) : Math.max(...allPts.map((p) => p.t));
  const cutoff = years ? maxT - years * 365 * DAY : -Infinity;
  const win = series.map((s) => ({ ...s, pts: s.pts.filter((p) => p.t >= cutoff) }));
  const wPts = win.flatMap((s) => s.pts);
  const wQTs = allQTs.filter((t) => t >= cutoff);
  const minT = wQTs.length ? Math.min(...wQTs) : wPts.length ? Math.min(...wPts.map((p) => p.t)) : maxT - DAY;
  const maxT2 = maxT;

  const W = 880, H = 340, ML = 46, MR = 14, MT = 16, MB = 28;
  const vals = wPts.map((p) => p.v);
  let lo = Math.min(...vals, ...(metric === "g" ? [0] : [])), hiV = Math.max(...vals, ...(metric === "g" ? [0] : []));
  const pad = (hiV - lo) * 0.1 || 0.02;
  lo -= pad; hiV += pad;
  const x = (t: number) => ML + (maxT2 === minT ? 0.5 : (t - minT) / (maxT2 - minT)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hiV - lo || 1)) * (H - MT - MB);
  const fmt = metric === "g" ? pctS : pct1;

  // union of all quarter timestamps (for hover hit columns + the guide)
  const unionT = [...new Set(wPts.map((p) => p.t))].sort((a, b) => a - b);
  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const near = (pts: Pt[], t: number) => { let best: Pt | null = null, bd = 45 * DAY; for (const p of pts) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; best = p; } } return best; };

  // year gridlines
  const yrs: number[] = [];
  for (let yr = new Date(minT).getUTCFullYear(); yr <= new Date(maxT2).getUTCFullYear(); yr++) yrs.push(yr);
  const yTicks = [lo, (lo + hiV) / 2, hiV];
  const TB = (a: boolean) => "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const hT = hi != null ? unionT[hi] : null;

  return (
    <Shell>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {METRICS.map((m) => <button key={m.key} onClick={() => setMetric(m.key)} className={TB(metric === m.key)}>{m.label}</button>)}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            <button onClick={() => setMode("spot")} className={TB(mode === "spot")}>Spot Q</button>
            <button onClick={() => setMode("ttm")} className={TB(mode === "ttm")}>TTM</button>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            {RANGES.map(([l, yr]) => <button key={l} onClick={() => setYears(yr)} className={TB(years === yr)}>{l}</button>)}
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} onMouseLeave={() => setHi(null)}>
        {yTicks.map((v, i) => (
          <g key={"y" + i}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" />
            <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{pct1(v)}</text>
          </g>
        ))}
        {metric === "g" && lo < 0 && hiV > 0 && <line x1={ML} x2={W - MR} y1={y(0)} y2={y(0)} stroke="var(--text-4)" strokeOpacity={0.5} strokeDasharray="4 3" />}
        {yrs.map((yr) => { const tx = x(Date.parse(`${yr}-01-01`)); return tx >= ML && tx <= W - MR ? <text key={yr} x={tx} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--text-4)">{yr}</text> : null; })}

        {win.map((s) => <path key={s.symbol} d={path(s.pts)} fill="none" stroke={s.color} strokeWidth={1.9} />)}

        {hT != null && (
          <>
            <line x1={x(hT)} x2={x(hT)} y1={MT} y2={H - MB} stroke="var(--text-4)" strokeOpacity={0.5} />
            {win.map((s) => { const p = near(s.pts, hT); return p ? <circle key={s.symbol} cx={x(p.t)} cy={y(p.v)} r={3} fill={s.color} /> : null; })}
            {(() => {
              const rows = win.map((s) => ({ s, p: near(s.pts, hT) })).filter((r) => r.p);
              const boxW = 132, boxH = 16 + rows.length * 14 + 6, left = x(hT) > W - MR - boxW - 6;
              return (
                <g transform={`translate(${left ? x(hT) - boxW - 8 : x(hT) + 8},${MT})`}>
                  <rect width={boxW} height={boxH} rx={6} fill="var(--bg)" stroke="var(--border)" />
                  <text x={9} y={15} fontSize={11} fontWeight={600} fill="var(--text-2)">{new Date(hT).toISOString().slice(0, 7)}</text>
                  {rows.map((r, k) => <text key={r.s.symbol} x={9} y={31 + k * 14} fontSize={10} fill={r.s.color}>{r.s.symbol} {fmt(r.p!.v)}</text>)}
                </g>
              );
            })()}
          </>
        )}

        {unionT.map((t, i) => {
          const half = (W - ML - MR) / Math.max(1, unionT.length - 1) / 2;
          return <rect key={i} x={x(t) - half} y={MT} width={half * 2} height={H - MT - MB} fill="transparent" onMouseEnter={() => setHi(i)} />;
        })}
      </svg>

      <p className="mt-1 text-[11px] text-[var(--text-4)]">
        {mode === "ttm" ? "Trailing-12-month" : "Spot-quarter"} {METRICS.find((m) => m.key === metric)!.label.toLowerCase()}, by each company's own fiscal quarter.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">{children}</section>;
}
