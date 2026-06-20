import type { CompanyStats } from "@/lib/companyStats";
import type { StockRow } from "@/lib/types";
import { fmtMarketCap } from "@/lib/format";

// Compact always-visible key-statistics bar for a ticker (the data already exists
// in getCompanyStats — this surfaces the essentials without a tab switch).
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const mult = (v: number | null | undefined, d = 1) => (v == null || v <= 0 ? "—" : `${v.toFixed(d)}×`);
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

export default function KeyStatsStrip({ stats, row }: { stats: CompanyStats | null; row: StockRow }) {
  const s = stats;
  const shortPctFloat =
    s?.sharesShort != null && s?.floatShares != null && s.floatShares > 0 ? s.sharesShort / s.floatShares : null;

  const items: { label: string; value: string; title?: string }[] = [
    { label: "Mkt Cap", value: fmtMarketCap(s?.marketCap ?? row.marketCap) },
    { label: "P/E", value: mult(s?.trailingPE ?? row.trailingPE), title: "Trailing P/E" },
    { label: "Fwd P/E", value: mult(s?.forwardPE ?? row.forwardPE) },
    { label: "PEG", value: num(s?.pegRatio) },
    { label: "P/B", value: mult(s?.priceToBook ?? row.priceToBook) },
    { label: "P/S", value: mult(s?.priceToSales) },
    { label: "EV/EBITDA", value: mult(s?.evToEbitda) },
    { label: "Beta", value: num(s?.beta) },
    { label: "Div Yield", value: pct(s?.dividendYield ?? row.dividendYield) },
    { label: "Payout", value: pct(s?.payoutRatio) },
    { label: "ROE", value: pct(s?.returnOnEquity) },
    { label: "Net Margin", value: pct(s?.profitMargins) },
    { label: "Short % Flt", value: shortPctFloat == null ? "—" : pct(shortPctFloat), title: s?.shortRatio != null ? `${s.shortRatio.toFixed(1)} days to cover` : undefined },
    { label: "Inst. Own", value: pct(s?.heldPercentInstitutions) },
  ];

  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:grid-cols-5 lg:grid-cols-7">
      {items.map((it) => (
        <div key={it.label} className="min-w-0" title={it.title}>
          <div className="truncate text-[10px] uppercase tracking-wide text-[var(--text-4)]">{it.label}</div>
          <div className="font-mono text-sm font-semibold tabular-nums text-[var(--text)]">{it.value}</div>
        </div>
      ))}
    </div>
  );
}
