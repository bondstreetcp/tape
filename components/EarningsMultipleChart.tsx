"use client";
import { useEffect, useState } from "react";

interface EMPoint { t: number; price: number; eps: number; fair: number; lo: number; hi: number }
interface EM {
  asOf: string;
  series: EMPoint[];
  normalPE: number; loPE: number; hiPE: number;
  currentPE: number | null; price: number; fair: number;
  premiumPct: number | null; epsCagr: number | null; years: number;
}

const usd = (v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(v < 10 ? 1 : 0)}`);

export default function EarningsMultipleChart({ symbol }: { symbol: string }) {
  const [data, setData] = useState<EM | "loading" | "err" | null>("loading");
  useEffect(() => {
    let a = true;
    setData("loading");
    fetch(`/api/earnings-multiple/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => a && setData(d.chart || "err"))
      .catch(() => a && setData("err"));
    return () => { a = false; };
  }, [symbol]);

  if (data === "loading")
    return <Card><div className="py-6 text-center text-sm text-[var(--text-3)]">Loading earnings multiple…</div></Card>;
  if (data === "err" || !data || !data.series?.length) return null;

  const prem = data.premiumPct;
  const premColor = prem == null ? undefined : prem > 8 ? "#ef4444" : prem < -8 ? "#22c55e" : "var(--text-2)";
  const premLabel = prem == null ? "—" : `${prem >= 0 ? "+" : "−"}${Math.abs(prem).toFixed(0)}%`;
  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">
          Earnings multiple <span className="font-normal text-[var(--text-4)]">· price vs. normal P/E · ~{data.years}y</span>
        </h3>
        {prem != null && (
          <span className="text-xs font-medium" style={premColor ? { color: premColor } : undefined}>
            {premLabel} {prem >= 0 ? "above" : "below"} fair value
          </span>
        )}
      </div>
      <EMChart d={data} />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Current P/E" value={data.currentPE == null ? "—" : `${data.currentPE.toFixed(1)}×`} />
        <Stat label="Normal P/E" value={`${data.normalPE.toFixed(1)}×`} />
        <Stat label="EPS growth (CAGR)" value={data.epsCagr == null ? "—" : `${data.epsCagr >= 0 ? "+" : "−"}${Math.abs(data.epsCagr * 100).toFixed(0)}%`} color={data.epsCagr == null ? undefined : data.epsCagr >= 0 ? "#22c55e" : "#ef4444"} />
        <Stat label="Fair value" value={usd(data.fair)} color={premColor} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
        The <span style={{ color: "#f59e0b" }}>orange line</span> is earnings × the stock&apos;s own normal P/E ({data.normalPE.toFixed(1)}×, its ~{data.years}-yr median); the band shades the 25th–75th-percentile multiple. Price above the band ⇒ the market is paying up vs. its own history; below ⇒ cheaper. EPS is trailing annual diluted with a ~75-day reporting lag (no look-ahead). Not a price target.
      </p>
    </Card>
  );
}

function EMChart({ d }: { d: EM }) {
  const s = d.series;
  const W = 1000, H = 250, ML = 50, MR = 14, MT = 12, MB = 22;
  const n = s.length;
  let yMin = Infinity, yMax = -Infinity;
  for (const p of s) { yMin = Math.min(yMin, p.lo, p.price); yMax = Math.max(yMax, p.hi, p.price); }
  yMin *= 0.94; yMax *= 1.06;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - MT - MB);
  const line = (f: (p: EMPoint) => number) => s.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(f(p)).toFixed(1)}`).join("");
  const band =
    s.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.hi).toFixed(1)}`).join("") +
    s.slice().reverse().map((p, i) => `L${x(n - 1 - i).toFixed(1)} ${y(p.lo).toFixed(1)}`).join("") + "Z";

  const ticks = 4;
  const yvals = Array.from({ length: ticks + 1 }, (_, i) => yMin + (i / ticks) * (yMax - yMin));
  const years: { i: number; label: string }[] = [];
  let lastYr = "";
  s.forEach((p, i) => {
    const yr = new Date(p.t).getFullYear().toString();
    if (yr !== lastYr) { years.push({ i, label: yr }); lastYr = yr; }
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {yvals.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" strokeWidth={1} />
          <text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={11} fill="var(--text-4)">{usd(v)}</text>
        </g>
      ))}
      <path d={band} fill="#f59e0b" opacity={0.1} />
      <path d={line((p) => p.fair)} fill="none" stroke="#f59e0b" strokeWidth={1.8} />
      <path d={line((p) => p.price)} fill="none" stroke="var(--text)" strokeWidth={1.6} />
      {/* x-axis: baseline, year ticks + labels */}
      <line x1={ML} x2={W - MR} y1={H - MB} y2={H - MB} stroke="var(--border-strong)" strokeWidth={1} />
      {years.map((yr, i) => (
        <g key={i}>
          <line x1={x(yr.i)} x2={x(yr.i)} y1={H - MB} y2={H - MB + 4} stroke="var(--text-4)" strokeWidth={1} />
          <text x={x(yr.i)} y={H - 4} textAnchor={i === 0 ? "start" : "middle"} fontSize={11} fill="var(--text-3)">{yr.label}</text>
        </g>
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
