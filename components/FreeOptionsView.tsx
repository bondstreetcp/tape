"use client";
import { useState } from "react";
import Link from "next/link";
import type { FreeOptionsData, FreeOptionRow } from "@/lib/freeOptions";

const fmtCap = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : `$${(v / 1e6).toFixed(0)}M`);
const pctColor = (v: number | null) => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");
const sp = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const n1 = (v: number | null, d = 1) => (v == null ? "—" : v.toFixed(d));

type Col = { key: keyof FreeOptionRow; label: string; hint: string; num: boolean; render: (r: FreeOptionRow) => React.ReactNode };
const COLS: Col[] = [
  { key: "score", label: "Score", hint: "Composite: growth priced cheap × a real, inflecting trajectory × quality", num: true, render: (r) => (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${r.score}%` }} /></div>
      <span className="tabular-nums font-semibold text-[var(--text)]">{r.score}</span>
    </div>
  ) },
  { key: "fwdPE", label: "Fwd P/E", hint: "Price ÷ next-fiscal-year consensus EPS", num: true, render: (r) => <span className="tabular-nums">{n1(r.fwdPE, 0)}</span> },
  { key: "epsGrowthPct", label: "EPS gr.", hint: "Forward EPS growth (this fiscal year → next)", num: true, render: (r) => <span className="tabular-nums font-medium" style={{ color: pctColor(r.epsGrowthPct) }}>{sp(r.epsGrowthPct)}</span> },
  { key: "peg", label: "PEG", hint: "Fwd P/E ÷ growth% — <1 = growth for a cheap multiple", num: true, render: (r) => <span className="tabular-nums font-medium" style={{ color: r.peg != null && r.peg < 1 ? "#22c55e" : "var(--text-2)" }}>{n1(r.peg, 2)}</span> },
  { key: "fwd3PE", label: "3yr P/E", hint: "The multiple 3 years out if growth holds — the 'free' part", num: true, render: (r) => <span className="tabular-nums">{n1(r.fwd3PE, 0)}</span> },
  { key: "revCagr3yPct", label: "Rev 3y", hint: "3-year revenue CAGR (top-line runway)", num: true, render: (r) => <span className="tabular-nums" style={{ color: pctColor(r.revCagr3yPct) }}>{sp(r.revCagr3yPct)}</span> },
  { key: "cyDriftPct", label: "Rev↑90d", hint: "Estimate drift — current-year EPS revised over 90 days", num: true, render: (r) => <span className="tabular-nums" style={{ color: pctColor(r.cyDriftPct) }}>{sp(r.cyDriftPct, 1)}{r.netUp ? <span className="ml-1 text-[10px] text-[var(--text-4)]">net {r.netUp >= 0 ? "+" : ""}{r.netUp}</span> : null}</span> },
  { key: "ptUpsidePct", label: "to PT", hint: "Upside to the mean analyst price target", num: true, render: (r) => <span className="tabular-nums" style={{ color: pctColor(r.ptUpsidePct) }}>{sp(r.ptUpsidePct)}</span> },
  { key: "marketCap", label: "Mkt cap", hint: "Market capitalization", num: true, render: (r) => <span className="tabular-nums text-[var(--text-3)]">{fmtCap(r.marketCap)}</span> },
];

export default function FreeOptionsView({ data, universe }: { data: FreeOptionsData; universe: string }) {
  const [sortKey, setSortKey] = useState<keyof FreeOptionRow>("score");
  const [dir, setDir] = useState<1 | -1>(-1);
  const sorted = [...data.rows].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
  });
  const click = (k: keyof FreeOptionRow) => { if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(-1); } };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Free options</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--text-3)]">
          Profitable, growing companies trading at a modest multiple — where the market is handing you the future earnings cheaply. Ranked by growth priced cheap (PEG / 3-yr-out P/E) × a real, inflecting trajectory (revenue CAGR, rising estimates) × quality. {data.count} names pass the filters; top {data.rows.length} shown.
        </p>
      </header>

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-3)]">No names pass the screen right now (needs the estimates feed + trend fundamentals). Check back after the nightly refresh.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[820px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                <th className="py-2 pl-3 pr-2 text-left font-medium">Name</th>
                {COLS.map((c) => (
                  <th key={String(c.key)} onClick={() => click(c.key)} title={c.hint} className={"cursor-pointer select-none px-2 py-2 font-medium hover:text-[var(--text-2)] " + (c.num ? "text-right" : "text-left")}>
                    {c.label}{sortKey === c.key ? <span className="ml-0.5 text-[var(--accent)]">{dir === -1 ? "▾" : "▴"}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.symbol} className="border-b border-[var(--divider)] align-top last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="py-2 pl-3 pr-2">
                    <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                    <div className="max-w-[240px] truncate text-[11px] text-[var(--text-4)]" title={r.name}>{r.name} · {r.sector}</div>
                    <div className="mt-0.5 max-w-[320px] text-[11px] leading-snug text-[var(--text-3)]">{r.why}</div>
                  </td>
                  {COLS.map((c) => <td key={String(c.key)} className="px-2 py-2 text-right">{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">
        Filters: profitable base (positive current-year EPS), forward EPS growth 8–80%, Fwd P/E 4–45, market cap ≥ $1B, ≥3 analysts, estimates not being cut &gt;3% (90d). Growth &amp; multiples from consensus estimates + the snapshot&apos;s trend fundamentals. A screen, not a recommendation — the &ldquo;free option&rdquo; framing assumes growth roughly holds; do the work on each name. Decision-support, not investment advice.
      </p>
    </main>
  );
}
