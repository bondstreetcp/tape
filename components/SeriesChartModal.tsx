"use client";
import { useEffect, useState } from "react";

/**
 * Shared "click a card → full-history chart" modal for the macro dashboards (Real Economy, Energy, Positioning).
 * Domain-agnostic: pass a ChartDetail with the series history + a `fmt` for the value/Y-axis (each dashboard has its
 * own units/formatter). Extracted from RealEconomyPanel so Energy + Positioning get the same behaviour.
 */
export type ChartDetail = {
  label: string;
  unit: string;
  history: [string, number][];
  current: number | null;
  latestDate: string | null;
  source: string;
  note?: string;
  tooltip?: string;
  lines: { label: string; value: string; color?: string }[];
  fmt?: (v: number | null, unit: string) => string; // header value + Y-axis labels; defaults to a compact number
};

const DAY = 86_400_000;
const defaultFmt = (v: number | null): string =>
  v == null ? "—" : Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(+v.toFixed(2));

// "Nice" round tick values spanning [min,max] for a readable Y axis.
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const step0 = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag, step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(v);
  return out;
}

// Full chart with X + Y axes (history already windowed to the timeframe).
function DetailChart({ points, unit, fmt }: { points: [string, number][]; unit: string; fmt: (v: number | null, unit: string) => string }) {
  if (points.length < 2) return <div className="flex h-[260px] items-center justify-center text-[12px] text-[var(--text-4)]">Not enough history for this window.</div>;
  const W = 720, H = 260, mL = 52, mR = 12, mT = 10, mB = 26;
  const ts = points.map((p) => Date.parse(p[0]));
  const vals = points.map((p) => p[1]);
  const t0 = ts[0], t1 = ts[ts.length - 1];
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const yticks = niceTicks(vMin, vMax, 4);
  const lo = Math.min(vMin, yticks[0]), hi = Math.max(vMax, yticks[yticks.length - 1]);
  const x = (t: number) => mL + ((t - t0) / (t1 - t0 || 1)) * (W - mL - mR);
  const y = (v: number) => mT + (1 - (v - lo) / (hi - lo || 1)) * (H - mT - mB);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(ts[i]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const spanDays = (t1 - t0) / DAY;
  const fmtDate = (t: number) => {
    const d = new Date(t);
    if (spanDays > 1100) return String(d.getUTCFullYear());
    if (spanDays > 170) return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const xticks: number[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) xticks.push(t0 + ((t1 - t0) * i) / n);
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ height: "260px" }}>
      {yticks.map((v, i) => (
        <g key={i}>
          <line x1={mL} x2={W - mR} y1={y(v)} y2={y(v)} stroke="var(--divider)" strokeWidth={1} />
          <text x={mL - 6} y={y(v) + 3} fontSize={10} textAnchor="end" fill="var(--text-4)">{fmt(v, unit)}</text>
        </g>
      ))}
      {xticks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 8} fontSize={10} textAnchor={i === 0 ? "start" : i === n ? "end" : "middle"} fill="var(--text-4)">{fmtDate(t)}</text>
      ))}
      <path d={line} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(t1)} cy={y(vals[vals.length - 1])} r={3.2} fill={up ? "#22c55e" : "#ef4444"} />
    </svg>
  );
}

const TF_OPTS = [
  { label: "1Y", days: 366 }, { label: "3Y", days: 1096 }, { label: "5Y", days: 1827 }, { label: "10Y", days: 3653 },
  { label: "6M", days: 184 }, { label: "3M", days: 92 },
];

export default function SeriesChartModal({ item, onClose }: { item: ChartDetail; onClose: () => void }) {
  const fmt = item.fmt ?? defaultFmt;
  const hist = item.history || [];
  const spanDays = hist.length >= 2 ? (Date.parse(hist[hist.length - 1][0]) - Date.parse(hist[0][0])) / DAY : 0;
  const opts = [...TF_OPTS].filter((o) => o.days < spanDays).sort((a, b) => a.days - b.days);
  opts.push({ label: "Max", days: Infinity });
  const [tf, setTf] = useState<string>(() => (opts.find((o) => o.label === "5Y") ? "5Y" : opts.find((o) => o.label === "3Y") ? "3Y" : "Max"));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const days = opts.find((o) => o.label === tf)?.days ?? Infinity;
  const cutoff = Date.now() - days * DAY;
  const windowed = days === Infinity ? hist : hist.filter((p) => Date.parse(p[0]) >= cutoff);
  const pts = windowed.length >= 2 ? windowed : hist.slice(-2);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-[var(--text)]">{item.label}</div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-[12px] text-[var(--text-3)]">
              <span className="font-mono text-lg font-bold tabular-nums text-[var(--text)]">{fmt(item.current, item.unit)}</span>
              <span className="text-[var(--text-4)]">{item.unit}{item.latestDate ? ` · ${item.latestDate}` : ""}</span>
              {item.lines.map((l, i) => <span key={i}><b className="text-[var(--text-4)]">{l.label}</b> <span className="tabular-nums font-medium" style={{ color: l.color }}>{l.value}</span></span>)}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-[var(--text-4)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" aria-label="Close">✕</button>
        </div>
        <div className="mb-2 inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {opts.map((o) => (
            <button key={o.label} onClick={() => setTf(o.label)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (tf === o.label ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{o.label}</button>
          ))}
        </div>
        <DetailChart points={pts} unit={item.unit} fmt={fmt} />
        {item.tooltip && <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-3)]">{item.tooltip}</p>}
        <div className="mt-1.5 text-[11px] leading-snug text-[var(--text-4)]">{item.source}{item.note ? <span className="text-[#f59e0b]"> · {item.note}</span> : null}</div>
      </div>
    </div>
  );
}
