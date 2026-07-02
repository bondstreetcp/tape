"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ExpectationsData, ExpSort } from "@/lib/expectations";

const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const pctNoSign = (v: number | null, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

export default function ExpectationsView({ data, universe }: { data: ExpectationsData; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [sort, setSort] = useState<ExpSort>("cheap");
  const [sector, setSector] = useState<string | null>(null);

  const sectors = useMemo(() => Array.from(new Set(data.rows.map((r) => r.sector).filter(Boolean))).sort(), [data.rows]);
  const rows = useMemo(() => {
    const f = data.rows.filter((r) => !sector || r.sector === sector);
    const s = [...f];
    if (sort === "perfection") s.sort((a, b) => (b.impliedGrowth ?? -9) - (a.impliedGrowth ?? -9));
    else s.sort((a, b) => (a.gap ?? 9) - (b.gap ?? 9));
    return s.slice(0, 150);
  }, [data.rows, sort, sector]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Expectations (Reverse-DCF)"
        desc="What growth is baked into the price. For every name we solve the free-cash-flow growth rate the current price implies (a 2-stage reverse-DCF) and compare it to the growth the business has actually delivered. Priced for far LESS than it delivers = cheap expectations; far MORE = priced for perfection. Equity-basis, uniform 9% discount — decision-support, not advice."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--border)]">
          <button onClick={() => setSort("cheap")} className={"px-2.5 py-1 text-xs font-medium transition-colors " + (sort === "cheap" ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-2)] hover:bg-[var(--surface-hover)]")}>Cheap expectations</button>
          <button onClick={() => setSort("perfection")} className={"px-2.5 py-1 text-xs font-medium transition-colors " + (sort === "perfection" ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-2)] hover:bg-[var(--surface-hover)]")}>Priced for perfection</button>
        </div>
        <select value={sector ?? ""} onChange={(e) => setSector(e.target.value || null)} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-2)]">
          <option value="">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {sector && <button onClick={() => setSector(null)} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {data.coverage} · {uname}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[700px] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-2 py-2 text-right font-medium" title="Free cash flow ÷ market cap">FCF yld</th>
              <th className="px-2 py-2 text-right font-medium" title="FCF growth/yr the current price implies">Implied gr.</th>
              <th className="px-2 py-2 text-right font-medium" title="Growth the business has delivered (3yr revenue CAGR)">Delivered</th>
              <th className="px-2 py-2 text-right font-medium" title="Implied − delivered. Negative = priced below what it delivers (cheap expectations)">Gap</th>
              <th className="px-3 py-2 text-right font-medium" title="DCF fair value at the delivered growth vs price">DCF upside</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className="px-3 py-2 tabular-nums text-[var(--text-4)]">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                  <span className="ml-2 hidden text-[var(--text-4)] sm:inline">{r.name.length > 24 ? r.name.slice(0, 24) + "…" : r.name}</span>
                  <span className="ml-2 text-[10px] text-[var(--text-4)]">{r.sector}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-3)]">{pctNoSign(r.fcfYield)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{pctNoSign(r.impliedGrowth)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-3)]">{pctNoSign(r.histGrowth)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: r.gap == null ? "var(--text-3)" : r.gap < 0 ? "#22c55e" : "#ef4444" }}>{pct(r.gap)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.upside == null ? "var(--text-3)" : r.upside >= 0 ? "#22c55e" : "#ef4444" }}>{pct(r.upside, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Reverse-DCF on free cash flow (FCF = FCF-yield × market cap), 5yr stage-1 + Gordon terminal at {`${(0.025 * 100).toFixed(1)}%`}, uniform 9% discount; only positive-FCF non-financials. "Delivered" is the 3yr revenue CAGR (a proxy for sustainable FCF growth). Approximate by design — a screen, not a target. Not investment advice.</p>
    </main>
  );
}
