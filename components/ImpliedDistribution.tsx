"use client";
import { useState } from "react";
import InfoDot from "./InfoDot";

export interface DistExp {
  date: string;
  dte: number;
  pts: [number, number][]; // [price, density], ascending in price
  p05: number;
  p16: number;
  p50: number;
  p84: number;
  p95: number;
  pUp: number; // P(S_T > spot)
  skew: number;
}

const W = 680,
  ML = 8,
  MR = 8,
  MT = 12,
  MB = 20,
  H = 190;

// The market-implied probability distribution of the stock at expiry, extracted from the fitted smile via
// Breeden–Litzenberger. The area is split at spot — red mass below, green above — so the asymmetry the
// options market is pricing (fat downside tail, upside skew) is visible at a glance.
export default function ImpliedDistribution({ dist, spot, currency = "USD" }: { dist: DistExp[]; spot: number; currency?: string }) {
  const [idx, setIdx] = useState(0);
  if (!dist?.length) return null;
  const sel = dist[Math.min(idx, dist.length - 1)];
  const pts = sel.pts;
  if (pts.length < 3) return null;

  const xmin = pts[0][0],
    xmax = pts[pts.length - 1][0];
  const maxD = Math.max(...pts.map((p) => p[1])) || 1;
  const x = (p: number) => ML + ((p - xmin) / (xmax - xmin || 1)) * (W - ML - MR);
  const baseY = H - MB;
  const y = (d: number) => MT + (1 - d / maxD) * (baseY - MT);

  const densAt = (price: number): number => {
    if (price <= pts[0][0]) return pts[0][1];
    if (price >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] >= price) {
        const t = (price - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1);
        return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
      }
    }
    return 0;
  };
  const sC = Math.max(xmin, Math.min(xmax, spot));
  const dSpot = densAt(sC);

  const seg = (p: [number, number]) => `L ${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`;
  const downPath = `M ${x(xmin).toFixed(1)} ${baseY} ${pts.filter((p) => p[0] <= sC).map(seg).join(" ")} L ${x(sC).toFixed(1)} ${y(dSpot).toFixed(1)} L ${x(sC).toFixed(1)} ${baseY} Z`;
  const upPath = `M ${x(sC).toFixed(1)} ${baseY} L ${x(sC).toFixed(1)} ${y(dSpot).toFixed(1)} ${pts.filter((p) => p[0] >= sC).map(seg).join(" ")} L ${x(xmax).toFixed(1)} ${baseY} Z`;
  let line = "";
  pts.forEach((p, i) => (line += `${i ? "L" : "M"}${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)} `));

  const fmt = (v: number) => {
    const sym = currency === "USD" ? "$" : "";
    return `${sym}${v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 2 : v < 100 ? 1 : 0 })}`;
  };
  const upPct = Math.round(sel.pUp * 100);
  const skewTag =
    sel.skew > 0.2 ? { t: "upside-skewed", c: "#22c55e" } : sel.skew < -0.2 ? { t: "downside-skewed", c: "#ef4444" } : { t: "≈ symmetric", c: "var(--text-3)" };
  const vline = (px: number, color: string, dash: string, op = 1) => (
    <line x1={x(px)} x2={x(px)} y1={MT} y2={baseY} stroke={color} strokeDasharray={dash} strokeOpacity={op} strokeWidth={1} />
  );

  return (
    <div className="mt-3 border-t border-[var(--divider)] pt-3">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">
          Implied distribution<InfoDot term="Implied distribution" /> <span className="font-normal normal-case tracking-normal text-[var(--text-4)]">· price odds at expiry, from the smile</span>
        </div>
        {dist.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {dist.map((e, i) => (
              <button
                key={e.date}
                onClick={() => setIdx(i)}
                className={"rounded px-1.5 py-0.5 text-[10px] tabular-nums transition-colors " + (i === Math.min(idx, dist.length - 1) ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:bg-[var(--surface-2)]")}
                title={`expiry ${e.date}`}
              >
                {e.dte}d
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" style={{ height: "auto" }}>
          {/* 1σ band */}
          <rect x={x(sel.p16)} y={MT} width={Math.max(0, x(sel.p84) - x(sel.p16))} height={baseY - MT} fill="var(--text)" fillOpacity={0.05} />
          <path d={downPath} fill="#ef4444" fillOpacity={0.16} />
          <path d={upPath} fill="#22c55e" fillOpacity={0.16} />
          <path d={line.trim()} fill="none" stroke="var(--text-2)" strokeWidth={1.4} />
          {vline(sel.p16, "var(--text-4)", "2 2", 0.8)}
          {vline(sel.p84, "var(--text-4)", "2 2", 0.8)}
          {vline(sel.p50, "#60a5fa", "0", 0.9)}
          {spot >= xmin && spot <= xmax && vline(spot, "var(--text)", "4 2", 0.65)}
          {/* axis labels */}
          <text x={x(sel.p16)} y={H - 6} fontSize={8.5} textAnchor="middle" fill="var(--text-4)" className="tabular-nums">{fmt(sel.p16)}</text>
          <text x={x(sel.p84)} y={H - 6} fontSize={8.5} textAnchor="middle" fill="var(--text-4)" className="tabular-nums">{fmt(sel.p84)}</text>
          {spot >= xmin && spot <= xmax && <text x={x(spot)} y={MT - 3} fontSize={8.5} textAnchor="middle" fill="var(--text-2)" className="tabular-nums">now {fmt(spot)}</text>}
          <text x={x(sel.p50)} y={H - 6} fontSize={8.5} textAnchor="middle" fill="#60a5fa" className="tabular-nums">med {fmt(sel.p50)}</text>
        </svg>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="text-[var(--text-3)]">
          <span className="font-semibold text-[#22c55e]">{upPct}%</span> up<InfoDot text="Market-implied probability the stock finishes above today's price at this expiry." /> · <span className="font-semibold text-[#ef4444]">{100 - upPct}%</span> down
        </span>
        <span className="text-[var(--text-3)]">
          68% between <b className="tabular-nums text-[var(--text-2)]">{fmt(sel.p16)}</b> – <b className="tabular-nums text-[var(--text-2)]">{fmt(sel.p84)}</b>
        </span>
        <span className="text-[var(--text-4)] tabular-nums">90%: {fmt(sel.p05)} – {fmt(sel.p95)}</span>
        <span style={{ color: skewTag.c }} title="Skewness of the implied distribution. Downside-skewed (fat left tail) is the equity norm — the options market pays up for crash protection.">
          skew {sel.skew > 0 ? "+" : ""}{sel.skew.toFixed(2)} · {skewTag.t}<InfoDot text="Asymmetry of the implied distribution: a fat left tail (downside-skewed) is the equity norm; a fat right tail flags priced-in upside (buyout, squeeze)." />
        </span>
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-4)]">
        Extracted from the fitted smile (Breeden–Litzenberger): f(K) = e<sup>rT</sup>·∂²C/∂K². The body is anchored to live quotes; the far tails are the smile model&apos;s extrapolation.
      </p>
    </div>
  );
}
