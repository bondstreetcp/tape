"use client";
import { useEffect, useState } from "react";
import InfoDot from "./InfoDot";

interface SurfaceData {
  symbol: string;
  spot: number;
  asOf: string;
  moneyness: number[]; // % (K/spot − 1)
  expiries: { date: string; dte: number; atmVol: number | null; skewPer10: number | null; rmse: number; n: number }[];
  grid: number[][]; // expiries × moneyness → fitted IV %
  richCheap: { expiry: string; dte: number; strike: number; moneyness: number; observedIV: number; fittedIV: number; residPts: number }[];
  error?: string;
}

const clampByte = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
const hex = (r: number, g: number, b: number) => "#" + [r, g, b].map((x) => clampByte(x).toString(16).padStart(2, "0")).join("");
// sequential cool→warm IV scale: blue-200 → amber-200 → red-600
const STOPS = [
  [191, 219, 254],
  [253, 230, 138],
  [220, 38, 38],
];
function ivColor(t: number): string {
  const tt = Math.max(0, Math.min(1, t));
  const seg = tt < 0.5 ? 0 : 1;
  const lt = tt < 0.5 ? tt / 0.5 : (tt - 0.5) / 0.5;
  const a = STOPS[seg],
    b = STOPS[seg + 1];
  return hex(a[0] + (b[0] - a[0]) * lt, a[1] + (b[1] - a[1]) * lt, a[2] + (b[2] - a[2]) * lt);
}

// The per-name implied-vol SURFACE: a smile fitted to each expiry's chain, shown as a fitted-IV heatmap
// (moneyness × expiry) + each listed strike's rich/cheap residual vs its own fitted smile. Generalizes the
// one-off skew/term charts into the whole structure, and surfaces per-strike pricing dislocations.
export default function IvSurface({ symbol }: { symbol: string }) {
  const [d, setD] = useState<SurfaceData | "loading" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setD("loading");
    fetch(`/api/iv-surface/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setD(j && !j.error && Array.isArray(j.grid) && j.grid.length ? j : "error"); })
      .catch(() => alive && setD("error"));
    return () => { alive = false; };
  }, [symbol]);

  if (d === "loading") return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-4)]">Fitting the vol surface…</div>;
  if (d === "error") return null; // no liquid chain → hide silently

  const rows = d.expiries.length,
    cols = d.moneyness.length;
  const flat = d.grid.flat().filter((v) => v > 0);
  const lo = flat.length ? Math.min(...flat) : 0,
    hi = flat.length ? Math.max(...flat) : 1;
  const norm = (v: number) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);
  const W = 680,
    ML = 44,
    MR = 8,
    MT = 6,
    MB = 20,
    cellH = 22;
  const cw = (W - ML - MR) / cols,
    H = MT + rows * cellH + MB;
  const atmIdx = d.moneyness.indexOf(0);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          Implied-vol surface <InfoDot term="Vol surface" /> <span className="font-normal text-[var(--text-4)]">· fitted IV % by moneyness <InfoDot term="Moneyness" /> × expiry</span>
        </h3>
        <span className="text-[11px] text-[var(--text-4)]" title="Each expiry's smile is a liquidity-weighted quadratic fit of total variance in log-moneyness (robust to junk OTM quotes). Cells = the fitted IV; the list below is each listed strike's rich/cheap vs that fitted smile.">
          spot ${d.spot.toFixed(2)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" style={{ height: "auto" }}>
          {d.grid.map((rowVals, i) =>
            rowVals.map((v, j) => {
              const x = ML + j * cw,
                yTop = MT + i * cellH,
                t = norm(v);
              return (
                <g key={`${i}-${j}`}>
                  <rect x={x} y={yTop} width={cw - 0.5} height={cellH - 0.5} fill={v > 0 ? ivColor(t) : "var(--surface-2)"} />
                  {v > 0 && (
                    <text x={x + cw / 2} y={yTop + cellH / 2 + 3} fontSize={8.5} textAnchor="middle" fill={t > 0.62 ? "#ffffff" : "#1f2937"} className="tabular-nums">
                      {v.toFixed(0)}
                    </text>
                  )}
                </g>
              );
            }),
          )}
          {atmIdx >= 0 && <line x1={ML + atmIdx * cw + cw / 2} y1={MT} x2={ML + atmIdx * cw + cw / 2} y2={MT + rows * cellH} stroke="var(--text)" strokeOpacity={0.28} strokeDasharray="2 2" />}
          {d.expiries.map((e, i) => (
            <text key={`e${i}`} x={ML - 4} y={MT + i * cellH + cellH / 2 + 3} fontSize={9} textAnchor="end" fill="var(--text-4)" className="tabular-nums">
              {e.dte}d
            </text>
          ))}
          {d.moneyness.map((m, j) => (
            <text key={`m${j}`} x={ML + j * cw + cw / 2} y={H - 7} fontSize={9} textAnchor="middle" fill={m === 0 ? "var(--text-2)" : "var(--text-4)"} className="tabular-nums">
              {m > 0 ? `+${m}` : m}
            </text>
          ))}
        </svg>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-4)]">
        <span>expiry (dte) ↕ · moneyness K/spot−1 (%) ↔ · dashed = ATM</span>
        <span className="flex items-center gap-1">
          {lo.toFixed(0)}%
          <span className="inline-block h-2 w-24 rounded" style={{ background: `linear-gradient(to right, ${ivColor(0)}, ${ivColor(0.5)}, ${ivColor(1)})` }} />
          {hi.toFixed(0)}% IV
        </span>
      </div>

      {d.richCheap.length > 0 && (
        <div className="mt-3 border-t border-[var(--divider)] pt-2">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]" title="Listed strikes furthest from their expiry's fitted smile — the per-strike pricing dislocations. This is a code-detected statistical signal: a rich strike may simply be pricing a real catalyst, so pair it with the news/filings read before trading it.">
            Richest / cheapest listed strikes vs the fitted smile
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {d.richCheap.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[12px] tabular-nums">
                <span className="text-[var(--text-3)]">
                  {r.dte}d · {r.strike} <span className="text-[var(--text-4)]">({r.moneyness > 0 ? "+" : ""}{r.moneyness}%)</span>
                </span>
                <span className="text-[var(--text-4)]">{r.observedIV}% vs {r.fittedIV}%</span>
                <b style={{ color: r.residPts > 0 ? "#ef4444" : "#22c55e" }}>{r.residPts > 0 ? `rich +${r.residPts}` : `cheap ${Math.abs(r.residPts)}`}</b>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
