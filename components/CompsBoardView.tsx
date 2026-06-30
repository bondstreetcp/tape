"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { CompRow } from "@/lib/sameStoreSales";

const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const col = (v: number | null) => (v == null ? "var(--text-4)" : v >= 0 ? "#22c55e" : "#ef4444");
type Sort = "comp" | "accel" | "stack";
const SORTS: { key: Sort; label: string; hint: string }[] = [
  { key: "comp", label: "Latest comp", hint: "highest same-store sales %" },
  { key: "accel", label: "Accelerating", hint: "biggest sequential improvement vs the prior quarter" },
  { key: "stack", label: "2-yr stack", hint: "this comp + the comp a year ago — rewards durable strength" },
];

export default function CompsBoardView({ rows, universe, asOf }: { rows: CompRow[]; universe: string; asOf: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [sort, setSort] = useState<Sort>("comp");
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    const f = q.trim().toUpperCase();
    let r = f ? rows.filter((x) => x.ticker.includes(f) || x.name.toUpperCase().includes(f) || x.industry.toUpperCase().includes(f)) : rows;
    r = [...r].sort((a, b) =>
      sort === "accel" ? (b.seqDelta ?? -99) - (a.seqDelta ?? -99)
        : sort === "stack" ? (b.twoYrStack ?? -99) - (a.twoYrStack ?? -99)
          : b.comp - a.comp);
    return r;
  }, [rows, sort, q]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}/holdco-nav`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader title="Same-Store Sales (Comps) Board" desc="Every restaurant & retailer ranked by its latest comparable-/same-store-sales %. Watch sequential acceleration (vs the prior quarter) and the 2-year stack (this comp + last year's) for durable vs flattering strength. Comps are company-defined and not perfectly comparable across names — decision-support, not advice." />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {SORTS.map((s) => <button key={s.key} title={s.hint} onClick={() => setSort(s.key)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (sort === s.key ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{s.label}</button>)}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter name / ticker / industry…" className="w-56 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2 text-left font-medium">Company</th>
              <th className="px-3 py-2 text-right font-medium" title="Latest quarterly comparable-sales %">Comp</th>
              <th className="px-3 py-2 text-right font-medium" title="Change vs the prior quarter's comp">Δ seq</th>
              <th className="px-3 py-2 text-right font-medium" title="Latest comp + the comp ~1 year ago">2-yr stack</th>
              <th className="px-3 py-2 text-right font-medium" title="Transactions/traffic · average ticket/check">Traffic · Ticket</th>
              <th className="px-3 py-2 text-right font-medium">Quarter</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.ticker} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${r.ticker}?tab=statements`} className="font-medium text-[var(--text)] hover:text-[var(--accent)]">{r.name}</Link>
                  <div className="text-[10px] text-[var(--text-4)]"><span className="font-mono">{r.ticker}</span> · {r.industry}</div>
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: col(r.comp) }}>{pct(r.comp)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: col(r.seqDelta) }}>
                  {r.seqDelta == null ? "—" : <span title={r.seqDelta >= 0 ? "accelerating" : "decelerating"}>{r.seqDelta >= 0 ? "▲" : "▼"} {pct(r.seqDelta)}</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-2)]">{r.twoYrStack == null ? "—" : pct(r.twoYrStack)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-3)]">
                  {r.traffic == null && r.ticket == null ? "—" : <><span style={{ color: col(r.traffic) }}>{r.traffic == null ? "·" : pct(r.traffic)}</span> · <span style={{ color: col(r.ticket) }}>{r.ticket == null ? "·" : pct(r.ticket)}</span></>}
                </td>
                <td className="px-3 py-2 text-right text-[11px] text-[var(--text-4)]">
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)]" title={`${r.metricLabel} — source filing`}>{r.fiscalLabel || r.fpEnd} ↗</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!view.length && <div className="py-12 text-center text-sm text-[var(--text-3)]">No comps match — the dataset is still backfilling.</div>}
      <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-4)]">{rows.length} names with a disclosed comp. Each name&apos;s metric is its OWN company-defined comparable-/same-store-/identical-/like-for-like measure (different store-age bases, fuel/FX treatment) — compare trends and acceleration, not absolute levels across names. Extracted from the latest earnings release. As of {asOf}.</p>
    </main>
  );
}
