"use client";
import { useState } from "react";
import type { Financials, FinPeriod } from "@/lib/financials";
import type { CompanyStats } from "@/lib/companyStats";
import { fmtMoney, fmtMarketCap } from "@/lib/format";

const fld = (p: FinPeriod, ks: string[]): number | null => {
  for (const k of ks) { const v = p[k]; if (typeof v === "number") return v; }
  return null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** "What-if" implied price: toggle revenue growth + gross margin (holding the cost
 *  structure & tax rate from the latest year) → forward EPS → × a P/E multiple. */
export default function ScenarioPanel({ financials, stats, price, currency = "USD" }: { financials: Financials; stats: CompanyStats | null; price: number | null; currency?: string }) {
  const annual = financials.annual ?? [];
  const latest = annual[annual.length - 1];
  const base = (() => {
    if (!latest) return null;
    const rev = fld(latest, ["totalRevenue"]);
    const gp = fld(latest, ["grossProfit"]);
    const oi = fld(latest, ["operatingIncome"]);
    const pretax = fld(latest, ["pretaxIncome"]);
    const tax = fld(latest, ["taxProvision"]);
    const shares = stats?.sharesOutstanding ?? fld(latest, ["dilutedAverageShares"]);
    if (!rev || rev <= 0 || gp == null || oi == null || !shares) return null;
    return {
      rev,
      gm: gp / rev,
      opexPct: (gp - oi) / rev, // operating costs below gross profit, as % of revenue (held constant)
      taxRate: pretax && tax != null && pretax > 0 ? clamp(tax / pretax, 0, 0.45) : 0.21,
      shares,
      fy: latest.date.slice(0, 4),
    };
  })();

  const defG = Math.round(clamp(stats?.revenueGrowth ?? 0.06, -0.05, 0.3) * 100);
  const defGM = base ? Math.round(base.gm * 100) : 40;
  // Forward multiple — the model applies the P/E to forward (next-year) EPS, so the
  // forward P/E is the consistent default.
  const defPE = Math.round(clamp(stats?.forwardPE ?? stats?.trailingPE ?? 20, 5, 60));
  const [g, setG] = useState(defG);
  const [gm, setGm] = useState(defGM);
  const [pe, setPe] = useState(defPE);

  const impliedPrice = (gPct: number, gmPct: number, peX: number): number | null => {
    if (!base) return null;
    const fwdRev = base.rev * (1 + gPct / 100);
    const ni = (fwdRev * (gmPct / 100) - fwdRev * base.opexPct) * (1 - base.taxRate);
    return (ni / base.shares) * peX;
  };

  if (!base) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Scenario — implied price</h3>
        <p className="mt-1 text-xs text-[var(--text-3)]">Not enough income-statement detail to model this company.</p>
      </section>
    );
  }

  const ip = impliedPrice(g, gm, pe);
  const upside = ip != null && price ? ip / price - 1 : null;
  // Reverse the model: the revenue growth that makes the implied price equal today's
  // market price (holding the chosen margin & P/E) — i.e. what the market is pricing in.
  const impliedG = (() => {
    if (!price) return null;
    const epsAtGm = (base.rev * (gm / 100 - base.opexPct) * (1 - base.taxRate)) / base.shares;
    const p0 = epsAtGm * pe; // implied price at 0% growth
    if (!(p0 > 0)) return null;
    return (price / p0 - 1) * 100;
  })();
  // The modeled forward income statement at the current sliders — the absolute lines behind the
  // implied price, so you watch revenue / EBIT / net income move as you drag the assumptions.
  const fwdRev = base.rev * (1 + g / 100);
  const gpAbs = fwdRev * (gm / 100);
  const oiAbs = fwdRev * (gm / 100 - base.opexPct); // EBIT — model holds opex flat as % of revenue
  const niAbs = oiAbs * (1 - base.taxRate);
  const epsAbs = niAbs / base.shares;
  const pl = [
    { label: "Revenue", val: fmtMarketCap(fwdRev, currency), note: `${g >= 0 ? "+" : ""}${g}% vs FY${base.fy}`, strong: false },
    { label: "Gross profit", val: fmtMarketCap(gpAbs, currency), note: `${gm}% margin`, strong: false },
    { label: "Operating income (EBIT)", val: fmtMarketCap(oiAbs, currency), note: `${((gm / 100 - base.opexPct) * 100).toFixed(0)}% margin`, strong: true },
    { label: "Net income", val: fmtMarketCap(niAbs, currency), note: fwdRev ? `${((niAbs / fwdRev) * 100).toFixed(0)}% margin` : "", strong: false },
    { label: "EPS", val: fmtMoney(epsAbs, currency), note: `× ${pe} P/E → ${ip == null ? "—" : fmtMoney(ip, currency)}`, strong: true },
  ];
  const gms = [gm - 4, gm - 2, gm, gm + 2, gm + 4];
  const gs = [g - 4, g - 2, g, g + 2, g + 4];
  const cellColor = (u: number | null) => (u == null ? "var(--text-4)" : u > 0.15 ? "#22c55e" : u > -0.15 ? "var(--text-2)" : "#ef4444");

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Scenario — implied price</h3>
        <span className="text-[11px] text-[var(--text-4)]">FY{base.fy} base · current GM {(base.gm * 100).toFixed(0)}% · opex {(base.opexPct * 100).toFixed(0)}% of rev · tax {(base.taxRate * 100).toFixed(0)}%</span>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-[11px] text-[var(--text-4)]">Implied price</div>
          <div className="font-mono text-2xl font-bold tabular-nums text-[var(--text)]">{ip == null ? "—" : fmtMoney(ip, currency)}</div>
        </div>
        <div>
          <div className="text-[11px] text-[var(--text-4)]">vs price {price ? fmtMoney(price, currency) : "—"}</div>
          <div className="font-mono text-2xl font-bold tabular-nums" style={{ color: upside == null ? "var(--text-3)" : upside >= 0 ? "#22c55e" : "#ef4444" }}>
            {upside == null ? "—" : `${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(0)}%`}
          </div>
        </div>
        <div className="rounded-lg border border-[#a855f7]/40 bg-[#a855f7]/10 px-3 py-1.5">
          <div className="text-[11px] text-[#c4b5fd]">Market is pricing in</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold tabular-nums text-[var(--text)]">{impliedG == null ? "—" : `${impliedG >= 0 ? "+" : ""}${impliedG.toFixed(0)}%`}</span>
            <span className="text-[11px] text-[var(--text-3)]">rev growth/yr</span>
            {impliedG != null && (
              <button onClick={() => setG(Math.round(clamp(impliedG, -10, 40)))} title="Set the growth slider to the market-implied rate" className="ml-0.5 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)] hover:border-[var(--border-strong)] hover:text-[var(--text)]">set ↩</button>
            )}
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Slider label="Revenue growth" value={g} min={-10} max={40} onChange={setG} suffix="%" />
        <Slider label="Gross margin" value={gm} min={5} max={95} onChange={setGm} suffix="%" />
        <Slider label="Forward P/E" value={pe} min={5} max={60} onChange={setPe} suffix="×" />
      </div>

      {/* Modeled forward income statement — absolute lines, live with the sliders */}
      <div className="mb-3 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--bg)]/40 px-3 py-2">
        <div className="mb-1 text-[11px] font-medium text-[var(--text-4)]">Forward income statement <span className="font-normal">· at the sliders above</span></div>
        <table className="w-full min-w-[340px] text-xs tabular-nums">
          <tbody>
            {pl.map((r) => (
              <tr key={r.label} className="border-t border-[var(--divider)] first:border-t-0">
                <td className={"py-1 text-left " + (r.strong ? "font-semibold text-[var(--text)]" : "text-[var(--text-3)]")}>{r.label}</td>
                <td className={"py-1 text-right " + (r.strong ? "font-semibold text-[var(--text)]" : "text-[var(--text-2)]")}>{r.val}</td>
                <td className="py-1 pl-3 text-right text-[10px] text-[var(--text-4)]">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-center text-xs">
          <thead>
            <tr className="text-[var(--text-4)]">
              <th className="py-1 text-left font-medium">Upside · margin ╲ growth</th>
              {gs.map((x) => <th key={x} className="py-1 font-medium tabular-nums">{x}%</th>)}
            </tr>
          </thead>
          <tbody>
            {gms.map((m) => (
              <tr key={m} className="border-t border-[var(--divider)]">
                <td className="py-1 text-left tabular-nums text-[var(--text-3)]">{m}%</td>
                {gs.map((x) => {
                  const v = impliedPrice(x, m, pe);
                  const u = v != null && price ? v / price - 1 : null;
                  const here = x === g && m === gm;
                  return (
                    <td key={x} className={"py-1 tabular-nums " + (here ? "rounded bg-[var(--accent-soft)] font-semibold" : "")} style={{ color: cellColor(u) }}>
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
        Forward revenue = FY{base.fy} revenue × (1 + growth); apply your gross margin, hold operating costs at {(base.opexPct * 100).toFixed(0)}% of revenue and the {(base.taxRate * 100).toFixed(0)}% tax rate → net income ÷ {(base.shares / 1e6).toFixed(0)}M shares → EPS × the P/E. A driver-based what-if, not a forecast. <span className="text-[#c4b5fd]">&ldquo;Market is pricing in&rdquo;</span> reverses it — the revenue growth that makes the model&apos;s price equal today&apos;s, at the margin &amp; P/E set above; lower the P/E to a conservative multiple to see the growth baked into the price.
      </p>
    </section>
  );
}

function Slider({ label, value, min, max, onChange, suffix }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="text-[11px] text-[var(--text-3)]">{label}</span>
        <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text)]">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
    </div>
  );
}
