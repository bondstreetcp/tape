"use client";
import type { Financials, FinPeriod } from "@/lib/financials";
import type { CompanyStats } from "@/lib/companyStats";

const fld = (p: FinPeriod, ks: string[]): number | null => {
  for (const k of ks) { const v = p[k]; if (typeof v === "number") return v; }
  return null;
};
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function DividendPanel({ financials, stats }: { financials: Financials; stats: CompanyStats | null }) {
  // Dividend per share per year = |dividends paid| / diluted shares (from the cash-flow statement).
  const dps = (financials.annual ?? [])
    .map((p) => {
      const paid = fld(p, ["cashDividendsPaid"]);
      const sh = fld(p, ["dilutedAverageShares"]);
      if (paid == null || sh == null || sh === 0) return null;
      return { year: p.date.slice(0, 4), dps: Math.abs(paid) / sh };
    })
    .filter((d): d is { year: string; dps: number } => !!d);

  const paysDividend = (stats?.dividendRate ?? 0) > 0 || dps.some((d) => d.dps > 0);
  if (!paysDividend) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Dividend</h3>
        <p className="mt-1 text-xs text-[var(--text-3)]">This company doesn&apos;t currently pay a dividend.</p>
      </section>
    );
  }

  const paying = dps.filter((d) => d.dps > 0);
  const cagr = paying.length >= 2 ? Math.pow(paying[paying.length - 1].dps / paying[0].dps, 1 / (paying.length - 1)) - 1 : null;
  const max = Math.max(...dps.map((d) => d.dps), 0.0001);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Dividend</h3>
        {cagr != null && <span className="text-[11px] text-[var(--text-4)]">{paying.length}-yr DPS CAGR <span className="font-mono font-semibold" style={{ color: cagr >= 0 ? "#22c55e" : "#ef4444" }}>{cagr >= 0 ? "+" : ""}{(cagr * 100).toFixed(1)}%</span></span>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label="Yield" value={pct(stats?.dividendYield)} />
        <Stat label="Annual rate" value={stats?.dividendRate != null ? `$${stats.dividendRate.toFixed(2)}` : "—"} />
        <Stat label="Payout ratio" value={pct(stats?.payoutRatio)} hint={stats?.payoutRatio != null && stats.payoutRatio > 0.8 ? "high" : undefined} />
        <Stat label="Latest DPS" value={paying.length ? `$${paying[paying.length - 1].dps.toFixed(2)}` : "—"} />
      </div>

      {dps.length >= 2 && (
        <div>
          <div className="mb-1 text-[11px] text-[var(--text-4)]">Dividend per share · annual</div>
          <div className="flex h-20 items-end gap-1.5">
            {dps.map((d) => (
              <div key={d.year} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.year}: $${d.dps.toFixed(2)}`}>
                <div className="w-full rounded-t bg-[#22c55e]" style={{ height: `${Math.max(2, (d.dps / max) * 100)}%`, minHeight: 2 }} />
                <span className="text-[9px] tabular-nums text-[var(--text-4)]">{d.year.slice(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] text-[var(--text-4)]">DPS computed from dividends paid ÷ diluted shares (cash-flow statement). Payout ratio &gt; 80% can signal limited room for growth or coverage risk.</p>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-base font-semibold tabular-nums text-[var(--text)]">
        {value}
        {hint && <span className="ml-1 text-[10px] font-normal text-[#f59e0b]">{hint}</span>}
      </div>
    </div>
  );
}
