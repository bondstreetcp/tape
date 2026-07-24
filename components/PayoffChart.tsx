"use client";
import { useMemo, useState } from "react";
import type { PayoffCurve } from "@/lib/optionsBook";

/**
 * P&L-at-expiry chart for one underlying — the classic options payoff diagram. The solid line is value at
 * expiration (the hockey stick); the dashed line is today's mark-to-market, so the gap between them is the
 * time value still left to decay. Strikes, breakevens and the current spot are marked.
 *
 * Pure SVG (no chart library) and theme-aware via CSS vars, matching the rest of Prism.
 */
export default function PayoffChart({ curve, money }: { curve: PayoffCurve; money: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520, H = 200, PAD_L = 8, PAD_R = 8, PAD_T = 10, PAD_B = 20;

  const { xOf, yOf, expiryPath, todayPath, zeroY, pts } = useMemo(() => {
    const pts = curve.points;
    const xs = pts.map((p) => p.spot);
    const ys = [...pts.map((p) => p.expiry), ...pts.map((p) => p.today), 0];
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = y1 - y0 || 1;
    const xOf = (s: number) => PAD_L + ((s - x0) / (x1 - x0 || 1)) * (W - PAD_L - PAD_R);
    const yOf = (v: number) => PAD_T + (1 - (v - y0) / span) * (H - PAD_T - PAD_B);
    const path = (key: "expiry" | "today") =>
      pts.map((p, i) => `${i ? "L" : "M"}${xOf(p.spot).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join(" ");
    return { xOf, yOf, expiryPath: path("expiry"), todayPath: path("today"), zeroY: yOf(0), pts };
  }, [curve]);

  // Nearest plotted point to the cursor, for the readout.
  const hoverPt = hover == null ? null : pts.reduce((a, p) => (Math.abs(xOf(p.spot) - hover) < Math.abs(xOf(a.spot) - hover) ? p : a));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Profit and loss at expiry for ${curve.symbol} across underlying prices`}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(((e.clientX - r.left) / r.width) * W);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* zero line */}
        <line x1={PAD_L} x2={W - PAD_R} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeWidth="1" />
        {/* profit / loss shading against the at-expiry curve */}
        <path d={`${expiryPath} L${xOf(pts[pts.length - 1].spot)},${zeroY} L${xOf(pts[0].spot)},${zeroY} Z`} fill="var(--pos)" opacity="0.10" />
        {/* strikes */}
        {curve.strikes.map((k) => (
          <line key={k} x1={xOf(k)} x2={xOf(k)} y1={PAD_T} y2={H - PAD_B} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" />
        ))}
        {/* breakevens */}
        {curve.breakevens.map((b, i) => (
          <line key={i} x1={xOf(b)} x2={xOf(b)} y1={PAD_T} y2={H - PAD_B} stroke="var(--warn)" strokeWidth="1" strokeDasharray="3 2" opacity="0.7" />
        ))}
        {/* current spot */}
        <line x1={xOf(curve.spot)} x2={xOf(curve.spot)} y1={PAD_T} y2={H - PAD_B} stroke="var(--accent)" strokeWidth="1.5" />
        {/* today's mark-to-market, then the at-expiry hockey stick on top */}
        <path d={todayPath} fill="none" stroke="var(--text-4)" strokeWidth="1.4" strokeDasharray="4 3" />
        <path d={expiryPath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {hoverPt && (
          <>
            <line x1={xOf(hoverPt.spot)} x2={xOf(hoverPt.spot)} y1={PAD_T} y2={H - PAD_B} stroke="var(--text-3)" strokeWidth="1" opacity="0.5" />
            <circle cx={xOf(hoverPt.spot)} cy={yOf(hoverPt.expiry)} r="3.5" fill="var(--accent)" />
          </>
        )}
        {/* x-axis labels: plot ends + spot */}
        <text x={PAD_L} y={H - 6} fill="var(--text-4)" fontSize="10" fontFamily="ui-monospace, monospace">${pts[0].spot.toFixed(0)}</text>
        <text x={xOf(curve.spot)} y={H - 6} fill="var(--accent)" fontSize="10" textAnchor="middle" fontFamily="ui-monospace, monospace">${curve.spot.toFixed(0)}</text>
        <text x={W - PAD_R} y={H - 6} fill="var(--text-4)" fontSize="10" textAnchor="end" fontFamily="ui-monospace, monospace">${pts[pts.length - 1].spot.toFixed(0)}</text>
      </svg>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-4)]">
        <span className="flex items-center gap-1"><span className="inline-block h-[2px] w-4" style={{ background: "var(--accent)" }} />at expiry</span>
        <span className="flex items-center gap-1"><span className="inline-block h-[2px] w-4" style={{ background: "var(--text-4)", opacity: 0.8 }} />today</span>
        {curve.breakevens.length > 0 && (
          <span>breakeven <span className="font-mono text-[var(--warn)]">{curve.breakevens.map((b) => `$${b.toFixed(0)}`).join(" · ")}</span></span>
        )}
        <span className="ml-auto font-mono tabular-nums">
          {hoverPt ? (
            <>
              <span className="text-[var(--text-3)]">${hoverPt.spot.toFixed(0)}</span>{" "}
              <span style={{ color: hoverPt.expiry >= 0 ? "var(--pos)" : "var(--neg)" }}>{hoverPt.expiry >= 0 ? "+" : "−"}{money(Math.abs(hoverPt.expiry))}</span>
            </>
          ) : (
            <>
              <span style={{ color: "var(--pos)" }}>max {curve.maxProfit == null ? "unbounded" : money(curve.maxProfit)}</span>
              {" · "}
              <span style={{ color: "var(--neg)" }}>min {curve.maxLoss == null ? "unbounded" : `−${money(Math.abs(curve.maxLoss))}`}</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
