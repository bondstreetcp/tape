"use client";
import { useEffect, useState } from "react";

interface MetricBand { current: number | null; min: number; p25: number; median: number; p75: number; max: number; percentile: number | null }
interface Point { t: number; pe: number | null; ps: number | null; ev: number | null }
interface Bands { asOf: string; series: Point[]; pe: MetricBand | null; ps: MetricBand | null; evEbitda: MetricBand | null }

const METRICS = [
  { key: "pe", label: "P/E", field: "pe" as const, band: "pe" as const },
  { key: "ps", label: "P/S", field: "ps" as const, band: "ps" as const },
  { key: "ev", label: "EV/EBITDA", field: "ev" as const, band: "evEbitda" as const },
] as const;

const fmt = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}×`);
const pctColor = (p: number | null) => (p == null ? undefined : p >= 0.8 ? "#ef4444" : p <= 0.2 ? "#22c55e" : "var(--text-2)");
function verdict(b: MetricBand): string {
  if (b.percentile == null) return "";
  const pc = Math.round(b.percentile * 100);
  if (b.percentile >= 0.8) return `Trading richer than ${pc}% of the last few years — expensive vs. its own history.`;
  if (b.percentile <= 0.2) return `Cheaper than ${100 - pc}% of the last few years — inexpensive vs. its own history.`;
  return `Around the middle of its historical range (${pc}th percentile).`;
}

export default function ValuationBands({ symbol }: { symbol: string }) {
  const [data, setData] = useState<Bands | "loading" | "err" | null>("loading");
  const [metric, setMetric] = useState<"pe" | "ps" | "ev">("pe");
  useEffect(() => {
    let a = true;
    setData("loading");
    fetch(`/api/valuation-bands/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => a && setData(d.bands || "err"))
      .catch(() => a && setData("err"));
    return () => { a = false; };
  }, [symbol]);

  if (data === "loading")
    return <Card><div className="py-6 text-center text-sm text-[var(--text-3)]">Loading valuation history…</div></Card>;
  if (data === "err" || !data) return null;

  const m = METRICS.find((x) => x.key === metric)!;
  const b = data[m.band];
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">
          Valuation vs. its own history <span className="font-normal text-[var(--text-4)]">· ~{Math.max(1, Math.round(data.series.length / 52))}y</span>
        </h3>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {METRICS.map((x) => (
            <button
              key={x.key}
              onClick={() => setMetric(x.key)}
              className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (metric === x.key ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {!b ? (
        <div className="py-6 text-center text-xs text-[var(--text-3)]">{m.label} history unavailable for this name.</div>
      ) : (
        <>
          <BandChart series={data.series} field={m.field} b={b} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Current" value={fmt(b.current)} />
            <Stat label="Median" value={fmt(b.median)} />
            <Stat label="Range" value={`${fmt(b.min)} – ${fmt(b.max)}`} />
            <Stat label="Percentile" value={b.percentile == null ? "—" : `${Math.round(b.percentile * 100)}th`} color={pctColor(b.percentile)} />
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-4)]">{verdict(b)} <span className="text-[var(--border-strong)]">Bands shade the 25th–75th percentile; dashed line = median.</span></p>
        </>
      )}
    </Card>
  );
}

function BandChart({ series, field, b }: { series: Point[]; field: "pe" | "ps" | "ev"; b: MetricBand }) {
  const W = 1000, H = 230, ML = 46, MR = 12, MT = 12, MB = 24;
  const n = series.length;
  const yMin = b.min * 0.96, yMax = b.max * 1.04;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - MT - MB);
  let d = "", started = false;
  series.forEach((s, i) => {
    const v = s[field];
    if (v == null) { started = false; return; }
    d += `${started ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    started = true;
  });
  let lastI = n - 1;
  for (let i = n - 1; i >= 0; i--) if (series[i][field] != null) { lastI = i; break; }
  const ticks = [b.max, b.median, b.min];
  // x-axis: one label per calendar-year boundary (the series is ~weekly)
  const yrLabels: { x: number; label: string }[] = [];
  { let last = ""; for (let i = 0; i < n; i++) { const t = series[i].t; const ms = t < 1e12 ? t * 1000 : t; const yr = String(new Date(ms).getFullYear()); if (yr !== last) { yrLabels.push({ x: x(i), label: yr }); last = yr; } } }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      <rect x={ML} width={W - ML - MR} y={y(b.p75)} height={Math.max(0, y(b.p25) - y(b.p75))} fill="#2563eb" opacity={0.12} />
      <line x1={ML} x2={W - MR} y1={y(b.median)} y2={y(b.median)} stroke="var(--text-3)" strokeDasharray="4 3" strokeWidth={1} />
      {ticks.map((v, i) => (
        <text key={i} x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={11} fill="var(--text-4)">{v.toFixed(1)}×</text>
      ))}
      <path d={d} fill="none" stroke="#60a5fa" strokeWidth={1.6} />
      {b.current != null && (
        <>
          <circle cx={x(lastI)} cy={y(b.current)} r={3.2} fill="#60a5fa" />
          <text x={x(lastI) - 5} y={y(b.current) - 6} textAnchor="end" fontSize={11} fontWeight={600} fill="#93c5fd">{b.current.toFixed(1)}×</text>
        </>
      )}
      {yrLabels.map((l, i) => (
        <text key={"x" + i} x={l.x} y={H - 6} textAnchor={i === 0 ? "start" : "middle"} fontSize={11} fill="var(--text-4)">{l.label}</text>
      ))}
    </svg>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">{children}</section>;
}
function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5">
      <div className="text-[10px] text-[var(--text-3)]">{label}</div>
      <div className="text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
