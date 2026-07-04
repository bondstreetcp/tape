"use client";
import { useEffect, useState } from "react";
import InfoDot from "./InfoDot";

interface GammaData {
  symbol: string;
  asOf: string;
  expiries: { date: string; dte: number }[];
  spot: number;
  totalGex: number;
  grossGex: number;
  flip: number | null;
  pcRatio: number | null;
  callWall: { strike: number; oi: number } | null;
  putWall: { strike: number; oi: number } | null;
  strikes: { strike: number; gex: number; callOI: number; putOI: number }[];
  error?: string;
}

const money = (v: number) => {
  const s = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}mn`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
};

const W = 680,
  ML = 8,
  MR = 8,
  MT = 14,
  MB = 22,
  H = 200;

// Dealer gamma exposure (GEX) positioning panel for the Options tab — net dealer gamma, the gamma-flip
// (zero-gamma) level, put/call OI ratio, OI walls, and gamma-by-strike bars. Reads /api/gamma; hides
// silently on names with no liquid chain.
export default function GammaExposure({ symbol }: { symbol: string }) {
  const [d, setD] = useState<GammaData | "loading" | "error">("loading");
  useEffect(() => {
    let alive = true;
    setD("loading");
    fetch(`/api/gamma/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((j) => { if (alive) setD(j && !j.error && Array.isArray(j.strikes) && j.strikes.length ? j : "error"); })
      .catch(() => alive && setD("error"));
    return () => { alive = false; };
  }, [symbol]);

  if (d === "loading") return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-4)]">Computing dealer gamma…</div>;
  if (d === "error") return null;

  const S = d.spot;
  const longG = d.totalGex >= 0;
  const strikes = d.strikes;
  const xs = strikes.map((s) => s.strike);
  const xmin = Math.min(...xs, S),
    xmax = Math.max(...xs, S);
  const maxAbs = Math.max(1, ...strikes.map((s) => Math.abs(s.gex)));
  const x = (p: number) => ML + ((p - xmin) / (xmax - xmin || 1)) * (W - ML - MR);
  const zeroY = MT + (H - MT - MB) / 2;
  const y = (g: number) => zeroY - (g / maxAbs) * ((H - MT - MB) / 2);
  const barW = Math.max(2, ((W - ML - MR) / Math.max(1, strikes.length)) * 0.66);
  const flipPct = d.flip != null && S > 0 ? ((d.flip - S) / S) * 100 : null;

  const vline = (px: number, color: string, dash: string, op: number) =>
    px >= xmin && px <= xmax ? <line x1={x(px)} x2={x(px)} y1={MT} y2={H - MB} stroke={color} strokeDasharray={dash} strokeOpacity={op} strokeWidth={1} /> : null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          Dealer gamma<InfoDot term="Gamma exposure" /> <span className="font-normal text-[var(--text-4)]">· positioning by strike{d.expiries.length ? ` · next ${d.expiries.length} expiries` : ""}</span>
        </h3>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: longG ? "#22c55e22" : "#ef444422", color: longG ? "#22c55e" : "#ef4444" }} title={longG ? "Dealers are net LONG gamma: they buy dips and sell rips, damping and pinning realized vol." : "Dealers are net SHORT gamma: they sell dips and buy rips, amplifying moves — expect trendier, choppier action."}>
          {longG ? "long gamma · vol dampened" : "short gamma · vol amplified"}
        </span>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Net GEX / 1%<InfoDot text="Net dollars of delta dealers must trade to stay hedged for a 1% move. Positive = long gamma (stabilizing)." /></div>
          <div className="font-mono font-semibold tabular-nums" style={{ color: longG ? "#22c55e" : "#ef4444" }}>{money(d.totalGex)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Gamma flip<InfoDot term="Gamma flip" /></div>
          <div className="font-mono font-semibold tabular-nums text-[var(--text-2)]">
            {d.flip != null ? `$${d.flip.toFixed(2)}` : "—"}
            {flipPct != null && <span className="ml-1 text-[10px] font-normal text-[var(--text-4)]">{flipPct >= 0 ? "+" : ""}{flipPct.toFixed(1)}%</span>}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Put/call OI<InfoDot term="Put/call ratio" /></div>
          <div className="font-mono font-semibold tabular-nums text-[var(--text-2)]">{d.pcRatio != null ? d.pcRatio.toFixed(2) : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">Walls (OI)<InfoDot text="Largest call-OI strike (upside pin / resistance) and largest put-OI strike (downside pin / support)." /></div>
          <div className="font-mono text-[11px] tabular-nums">
            {d.callWall && <span style={{ color: "#22c55e" }}>C ${d.callWall.strike}</span>}
            {d.callWall && d.putWall ? " · " : ""}
            {d.putWall && <span style={{ color: "#ef4444" }}>P ${d.putWall.strike}</span>}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" style={{ height: "auto" }}>
          <line x1={ML} x2={W - MR} y1={zeroY} y2={zeroY} stroke="var(--border)" />
          {strikes.map((s) => {
            const gx = x(s.strike),
              gy = y(s.gex);
            return <rect key={s.strike} x={gx - barW / 2} y={Math.min(zeroY, gy)} width={barW} height={Math.abs(gy - zeroY)} fill={s.gex >= 0 ? "#22c55e" : "#ef4444"} fillOpacity={0.72} />;
          })}
          {vline(S, "var(--text)", "4 2", 0.7)}
          {d.flip != null && vline(d.flip, "#f59e0b", "0", 0.9)}
          {/* axis labels */}
          {d.callWall && d.callWall.strike >= xmin && d.callWall.strike <= xmax && <text x={x(d.callWall.strike)} y={H - 6} fontSize={8.5} textAnchor="middle" fill="#22c55e" className="tabular-nums">{d.callWall.strike}</text>}
          {d.putWall && d.putWall.strike >= xmin && d.putWall.strike <= xmax && <text x={x(d.putWall.strike)} y={H - 6} fontSize={8.5} textAnchor="middle" fill="#ef4444" className="tabular-nums">{d.putWall.strike}</text>}
          {S >= xmin && S <= xmax && <text x={x(S)} y={MT - 3} fontSize={8.5} textAnchor="middle" fill="var(--text-2)" className="tabular-nums">spot {S.toFixed(0)}</text>}
          {d.flip != null && d.flip >= xmin && d.flip <= xmax && <text x={x(d.flip)} y={H - 6} fontSize={8.5} textAnchor="middle" fill="#f59e0b" className="tabular-nums">flip</text>}
        </svg>
      </div>

      <p className="mt-1 text-[10px] text-[var(--text-4)]">
        <span className="font-semibold text-[#22c55e]">green</span> = dealer long gamma at that strike (a pin), <span className="font-semibold text-[#ef4444]">red</span> = short. Dashed = spot, amber = gamma flip. Naive model (dealers assumed long calls / short puts), end-of-day OI, next {d.expiries.length} expiries — a positioning read, not a signal.
      </p>
    </div>
  );
}
