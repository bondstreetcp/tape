"use client";
import { useEffect, useMemo, useState } from "react";
import type { FinPeriod } from "@/lib/financials";
import type { SharesHistory } from "@/lib/sharesHistory";

const fmtSh = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : `${v.toFixed(0)}`);
const RANGES: [string, number][] = [["3Y", 3], ["5Y", 5], ["10Y", 10], ["Max", 0]];
const plabel = (date: string, gran: "annual" | "quarterly") => {
  const [y, m] = date.split("-").map(Number);
  const yy = String(y).slice(2);
  if (gran === "annual") return `FY${yy}`;
  return `Q${Math.floor(((m || 1) - 1) / 3) + 1} '${yy}`;
};

/** Diluted shares outstanding over time (buybacks vs. dilution). Pulls a 10+ year history
 *  from SEC EDGAR (Yahoo only has ~5yr), with Annual/Quarterly and time-range toggles.
 *  Shown at the bottom of the Statements tab. */
export default function SharesChart({ symbol, financials }: { symbol: string; financials: { annual: FinPeriod[]; quarterly: FinPeriod[] } }) {
  const [edgar, setEdgar] = useState<SharesHistory | null>(null);
  const [gran, setGran] = useState<"annual" | "quarterly">("annual");
  const [years, setYears] = useState(10);

  useEffect(() => {
    let on = true;
    setEdgar(null);
    fetch(`/api/shares/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (on) setEdgar(d && Array.isArray(d.annual) ? d : { annual: [], quarterly: [] }); })
      .catch(() => { if (on) setEdgar({ annual: [], quarterly: [] }); });
    return () => { on = false; };
  }, [symbol]);

  // Yahoo fallback (shorter history) for non-US filers EDGAR can't cover; also shown
  // instantly while the EDGAR call is in flight, then upgraded to the 10yr+ series.
  const yahoo = useMemo<SharesHistory>(() => {
    const sh = (p: FinPeriod) => { for (const k of ["dilutedAverageShares", "basicAverageShares", "ordinarySharesNumber"]) { const v = p[k]; if (typeof v === "number" && v > 0) return v; } return null; };
    const conv = (ps: FinPeriod[]) => ps.map((p) => [p.date, sh(p)] as [string, number | null]).filter((x): x is [string, number] => x[1] != null).sort((a, b) => a[0].localeCompare(b[0]));
    return { annual: conv(financials.annual), quarterly: conv(financials.quarterly) };
  }, [financials]);

  const source: SharesHistory = edgar && (edgar.annual.length >= 2 || edgar.quarterly.length >= 2) ? edgar : yahoo;

  // If the chosen granularity has no data but the other does, switch to it.
  useEffect(() => {
    if (source.annual.length < 2 && source.quarterly.length >= 2) setGran("quarterly");
    else if (source.quarterly.length < 2 && source.annual.length >= 2) setGran("annual");
  }, [source.annual.length, source.quarterly.length]);

  const full = source[gran];
  const series = useMemo(() => {
    if (full.length < 2 || years === 0) return full;
    const cutoff = Date.parse(full[full.length - 1][0]) - years * 365 * 86_400_000;
    const w = full.filter((p) => Date.parse(p[0]) >= cutoff);
    return w.length >= 2 ? w : full;
  }, [full, years]);

  if (full.length < 2) return null;

  const first = series[0][1], last = series[series.length - 1][1];
  const chgPct = (last / first - 1) * 100;
  const shrinking = chgPct < -0.5, growing = chgPct > 0.5;
  const accent = shrinking ? "#22c55e" : growing ? "#ef4444" : "#60a5fa";
  const trendWord = shrinking ? "net buybacks" : growing ? "net dilution" : "roughly flat";
  const usingEdgar = source === edgar;

  const W = 720, H = 220, ML = 54, MR = 16, MT = 16, MB = 30;
  const n = series.length;
  const vals = series.map((p) => p[1]);
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  const pad = (vMax - vMin) * 0.18 || vMax * 0.05;
  vMin = Math.max(0, vMin - pad); vMax += pad;
  const x = (i: number) => ML + (n === 1 ? 0.5 : i / (n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - vMin) / (vMax - vMin || 1)) * (H - MT - MB);
  const line = series.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${(H - MB).toFixed(1)}L${x(0).toFixed(1)} ${(H - MB).toFixed(1)}Z`;
  const yTicks = [vMin, (vMin + vMax) / 2, vMax];
  const every = Math.max(1, Math.ceil(n / 9));
  const TB = (active: boolean) => "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors " + (active ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Shares outstanding <span className="font-normal text-[var(--text-4)]">· diluted weighted-avg</span></h3>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            {(["annual", "quarterly"] as const).map((g) => (
              <button key={g} onClick={() => setGran(g)} className={TB(gran === g)}>{g === "annual" ? "Annual" : "Quarterly"}</button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
            {RANGES.map(([lab, yr]) => (
              <button key={lab} onClick={() => setYears(yr)} className={TB(years === yr)}>{lab}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="mb-1 text-xs font-medium tabular-nums" style={{ color: accent }}>
        {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(1)}% over {n} {gran === "annual" ? "yrs" : "qtrs"} shown · {trendWord}
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
        {n <= 24 && series.map((p, i) => <circle key={i} cx={x(i)} cy={y(p[1])} r={2.2} fill={accent} />)}
        {series.map((p, i) => (i % every === 0 || i === n - 1 ? <text key={"l" + i} x={x(i)} y={H - 9} textAnchor="middle" fontSize={9} fill="var(--text-4)">{plabel(p[0], gran)}</text> : null))}
      </svg>
      <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-4)]">
        Falling share count = buybacks returning capital; rising = dilution (stock comp, raises, M&amp;A). {usingEdgar ? "Diluted weighted-average shares from SEC EDGAR filings (10+ yr history)." : "Diluted weighted-average shares (Yahoo, ~4–5 yr)."}
      </p>
    </section>
  );
}
