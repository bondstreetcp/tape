"use client";
import { useMemo, useState } from "react";
import type { Financials, FinPeriod } from "@/lib/financials";
import type { CompanyStats } from "@/lib/companyStats";

const fld = (p: FinPeriod, ks: string[]): number | null => {
  for (const k of ks) { const v = p[k]; if (typeof v === "number") return v; }
  return null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const big = (v: number) =>
  Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toFixed(0)}`;

const YEARS = 5;

export default function DcfPanel({ financials, stats, price }: { financials: Financials; stats: CompanyStats | null; price: number | null }) {
  const base = useMemo(() => {
    const annual = financials.annual ?? [];
    const latest = annual[annual.length - 1];
    if (!latest) return null;
    let fcf = fld(latest, ["freeCashFlow"]);
    if (fcf == null) {
      const ocf = fld(latest, ["operatingCashFlow"]);
      const capex = fld(latest, ["capitalExpenditure"]); // negative in Yahoo
      if (ocf != null && capex != null) fcf = ocf + capex;
    }
    const shares = stats?.sharesOutstanding ?? fld(latest, ["dilutedAverageShares"]);
    const debt = fld(latest, ["totalDebt"]) ?? 0;
    const cash = fld(latest, ["cashAndCashEquivalents", "cashEquivalents", "cashCashEquivalentsAndShortTermInvestments"]) ?? stats?.totalCash ?? 0;
    return { fcf, shares, netDebt: debt - cash, fy: latest.date.slice(0, 4) };
  }, [financials, stats]);

  const defGrowth = Math.round(clamp(stats?.earningsGrowth ?? 0.08, 0.02, 0.18) * 100);
  const defDisc = Math.round(clamp(0.045 + (stats?.beta ?? 1) * 0.05, 0.07, 0.15) * 100);
  const [growthPct, setGrowth] = useState(defGrowth);
  const [discPct, setDisc] = useState(defDisc);
  const [termPct, setTerm] = useState(2.5);

  const dcfPerShare = (gPct: number, dPct: number, tgPct: number): number | null => {
    if (!base?.fcf || !base.shares || base.fcf <= 0) return null;
    const g = gPct / 100, d = dPct / 100, tg = tgPct / 100;
    if (d <= tg) return null;
    let pv = 0, fcf = base.fcf;
    for (let y = 1; y <= YEARS; y++) { fcf *= 1 + g; pv += fcf / Math.pow(1 + d, y); }
    const tv = (fcf * (1 + tg)) / (d - tg);
    pv += tv / Math.pow(1 + d, YEARS);
    return (pv - base.netDebt) / base.shares;
  };

  const intrinsic = dcfPerShare(growthPct, discPct, termPct);
  const upside = intrinsic != null && price ? intrinsic / price - 1 : null;

  // Reverse DCF: the FCF growth the current price implies (binary search).
  const impliedGrowth = useMemo(() => {
    if (!price || !base?.fcf || base.fcf <= 0) return null;
    let lo = -25, hi = 60;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const v = dcfPerShare(mid, discPct, termPct);
      if (v == null) return null;
      if (v < price) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }, [price, base, discPct, termPct]);

  if (!base || !base.fcf || !base.shares) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Discounted cash flow (DCF)</h3>
        <p className="mt-1 text-xs text-[var(--text-3)]">Not enough cash-flow data to model this company.</p>
      </section>
    );
  }
  if (base.fcf <= 0) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Discounted cash flow (DCF)</h3>
        <p className="mt-1 text-xs text-[var(--text-3)]">Latest free cash flow is negative ({big(base.fcf)}, FY{base.fy}) — a DCF isn&apos;t meaningful here.</p>
      </section>
    );
  }

  const growths = [growthPct - 4, growthPct - 2, growthPct, growthPct + 2, growthPct + 4];
  const discs = [discPct - 2, discPct, discPct + 2];
  const cellColor = (u: number | null) => (u == null ? "var(--text-4)" : u > 0.15 ? "#22c55e" : u > -0.15 ? "var(--text-2)" : "#ef4444");

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Discounted cash flow (DCF)</h3>
        <span className="text-[11px] text-[var(--text-4)]">5-yr 2-stage · base FCF {big(base.fcf)} (FY{base.fy})</span>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-[11px] text-[var(--text-4)]">Intrinsic value / share</div>
          <div className="font-mono text-2xl font-bold tabular-nums text-[var(--text)]">{intrinsic == null ? "—" : `$${intrinsic.toFixed(2)}`}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--text-4)]">vs price {price ? `$${price.toFixed(2)}` : "—"}</div>
          <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: upside == null ? "var(--text-3)" : upside >= 0 ? "#22c55e" : "#ef4444" }}>
            {upside == null ? "—" : `${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(0)}%`}
          </div>
        </div>
        {impliedGrowth != null && (
          <div className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5">
            <div className="text-[11px] text-[var(--text-4)]">Reverse DCF — price implies</div>
            <div className="font-mono text-sm font-semibold tabular-nums text-[#60a5fa]">{impliedGrowth.toFixed(1)}% FCF growth / yr</div>
          </div>
        )}
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Slider label="FCF growth (5yr)" value={growthPct} min={-5} max={30} onChange={setGrowth} suffix="%" />
        <Slider label="Discount rate (WACC)" value={discPct} min={6} max={18} onChange={setDisc} suffix="%" />
        <Slider label="Terminal growth" value={termPct} min={0} max={4} step={0.5} onChange={setTerm} suffix="%" />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-center text-xs">
          <thead>
            <tr className="text-[var(--text-4)]">
              <th className="py-1 text-left font-medium">Upside · disc ╲ growth</th>
              {growths.map((g) => <th key={g} className="py-1 font-medium tabular-nums">{g}%</th>)}
            </tr>
          </thead>
          <tbody>
            {discs.map((d) => (
              <tr key={d} className="border-t border-[var(--divider)]">
                <td className="py-1 text-left tabular-nums text-[var(--text-3)]">{d}%</td>
                {growths.map((g) => {
                  const v = dcfPerShare(g, d, termPct);
                  const u = v != null && price ? v / price - 1 : null;
                  const here = g === growthPct && d === discPct;
                  return (
                    <td key={g} className={"py-1 tabular-nums " + (here ? "rounded bg-[#2563eb]/15 font-semibold" : "")} style={{ color: cellColor(u) }}>
                      {u == null ? "—" : `${u >= 0 ? "+" : ""}${(u * 100).toFixed(0)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-4)]">
        2-stage model: free cash flow grown {growthPct}%/yr for 5 years, then a Gordon terminal value at {termPct}% growth, all discounted at {discPct}%; equity = enterprise value − net debt ({big(base.netDebt)}), ÷ {base.shares ? (base.shares / 1e6).toFixed(0) + "M" : "—"} shares. A rough model — sensitive to assumptions; not advice.
      </p>
    </section>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, suffix }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[11px] text-[var(--text-3)]">{label}</span>
        <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text)]">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#2563eb]" />
    </div>
  );
}
