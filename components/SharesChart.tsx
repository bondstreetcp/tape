"use client";
import type { FinPeriod } from "@/lib/financials";

const fmtSh = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${v.toFixed(0)}`);
const plabel = (date: string, type: "annual" | "quarterly") => {
  const d = new Date(date);
  return type === "annual" ? `FY${String(d.getFullYear()).slice(2)}` : d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

/** Diluted shares outstanding over time — the buyback (shrinking) vs. dilution (growing)
 *  story. Shown at the bottom of the Statements tab. */
export default function SharesChart({ periods, type }: { periods: FinPeriod[]; type: "annual" | "quarterly" }) {
  const f = (p: FinPeriod, k: string) => (typeof p[k] === "number" && Number.isFinite(p[k] as number) ? (p[k] as number) : null);
  const pts = periods
    .map((p) => ({ date: p.date, v: f(p, "dilutedAverageShares") ?? f(p, "basicAverageShares") ?? f(p, "ordinarySharesNumber") }))
    .filter((p): p is { date: string; v: number } => p.v != null && p.v > 0)
    .sort((a, b) => a.date.localeCompare(b.date)); // oldest → newest
  if (pts.length < 2) return null;

  const first = pts[0].v, last = pts[pts.length - 1].v;
  const chgPct = (last / first - 1) * 100;
  const shrinking = chgPct < -0.5, growing = chgPct > 0.5;
  const accent = shrinking ? "#22c55e" : growing ? "#ef4444" : "#60a5fa";
  const trendWord = shrinking ? "net buybacks" : growing ? "net dilution" : "roughly flat";

  const W = 720, H = 220, ML = 54, MR = 16, MT = 16, MB = 30;
  const vals = pts.map((p) => p.v);
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  const pad = (vMax - vMin) * 0.18 || vMax * 0.05;
  vMin = Math.max(0, vMin - pad); vMax += pad;
  const n = pts.length;
  const x = (i: number) => ML + (n === 1 ? 0.5 : i / (n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - MT - MB);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${(H - MB).toFixed(1)}L${x(0).toFixed(1)} ${(H - MB).toFixed(1)}Z`;
  const yTicks = [vMin, (vMin + vMax) / 2, vMax];
  const every = n > 10 ? Math.ceil(n / 8) : 1;

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Shares outstanding <span className="font-normal text-[var(--text-4)]">· diluted weighted-avg</span></h3>
        <span className="text-xs font-medium tabular-nums" style={{ color: accent }}>
          {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(1)}% over {n} {type === "annual" ? "yrs" : "qtrs"} · {trendWord}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" />
            <text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{fmtSh(v)}</text>
          </g>
        ))}
        <defs>
          <linearGradient id="shg" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity={0.18} />
            <stop offset="100%" stopColor={accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#shg)" />
        <path d={line} fill="none" stroke={accent} strokeWidth={1.9} />
        {pts.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.v)} r={2.4} fill={accent} />)}
        {pts.map((p, i) => (i % every === 0 || i === n - 1 ? <text key={"l" + i} x={x(i)} y={H - 9} textAnchor="middle" fontSize={9} fill="var(--text-4)">{plabel(p.date, type)}</text> : null))}
      </svg>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-4)]">
        Falling share count = buybacks returning capital to shareholders; rising = dilution (stock comp, equity raises, M&amp;A). Diluted weighted-average shares per {type === "annual" ? "fiscal year" : "quarter"}.
      </p>
    </section>
  );
}
