"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { RevisionsData } from "@/lib/revisions";

const pct = (v: number | null, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const col = (v: number | null) => (v == null ? "var(--text-3)" : v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "var(--text-3)");

export default function RevisionsView({ data, universe }: { data: RevisionsData; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [sector, setSector] = useState<string | null>(null);
  const [raisedOnly, setRaisedOnly] = useState(false);

  const sectors = useMemo(() => Array.from(new Set(data.rows.map((r) => r.sector).filter(Boolean))).sort(), [data.rows]);
  const rows = useMemo(
    () => data.rows.filter((r) => (!sector || r.sector === sector) && (!raisedOnly || (r.drift90 != null && r.drift90 > 0) || r.netUp > 0)).slice(0, 150),
    [data.rows, sector, raisedOnly],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Revisions Momentum"
        desc="Where the Street is quietly moving numbers. Ranks every name by estimate drift — how much consensus EPS has changed over the last 90/30 days — and revision breadth (analysts revising up vs down). Rising estimates ahead of a print is one of the most durable public-market signals (the PEAD factor). Decision-support, not advice."
      />

      {/* Sector revision-breadth strip */}
      {data.sectors.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Sector revision breadth — avg 90-day EPS drift · % of names net-upgraded</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.sectors.map((s) => (
              <button
                key={s.sector}
                onClick={() => setSector(sector === s.sector ? null : s.sector)}
                className={"rounded-lg border p-2 text-left transition-colors " + (sector === s.sector ? "border-[var(--border-strong)] bg-[var(--surface-hover)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]")}
              >
                <div className="truncate text-[11px] text-[var(--text-2)]">{s.sector}</div>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-sm font-bold tabular-nums" style={{ color: col(s.avgDrift90) }}>{pct(s.avgDrift90)}</span>
                  <span className="text-[10px] text-[var(--text-4)]">{s.netUpPct}% up</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setRaisedOnly((v) => !v)}
          className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (raisedOnly ? "bg-[var(--accent-strong)] text-white" : "border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]")}
        >
          ↑ Estimates rising
        </button>
        <select value={sector ?? ""} onChange={(e) => setSector(e.target.value || null)} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-2)]">
          <option value="">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(sector || raisedOnly) && <button onClick={() => { setSector(null); setRaisedOnly(false); }} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {data.coverage} covered · {uname}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-2 py-2 text-right font-medium" title="Composite of estimate drift + revision breadth">Momentum</th>
              <th className="px-2 py-2 text-right font-medium" title="Change in current-year consensus EPS over 90 days">EPS Δ 90d</th>
              <th className="px-2 py-2 text-right font-medium">EPS Δ 30d</th>
              <th className="px-2 py-2 text-center font-medium" title="Analysts revising up vs down, last 30 days">Revisions</th>
              <th className="px-2 py-2 text-right font-medium" title="Change in NEXT-year consensus EPS over 90 days">Next-yr Δ</th>
              <th className="px-3 py-2 text-right font-medium" title="Mean price target vs current price">Upside</th>
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
                <td className="px-2 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-12 overflow-hidden rounded bg-[var(--bg)]">
                      <div className="h-1.5 rounded" style={{ width: `${r.score}%`, background: r.score >= 70 ? "#22c55e" : r.score >= 40 ? "#f59e0b" : "#ef4444" }} />
                    </div>
                    <span className="w-6 text-right font-mono tabular-nums text-[var(--text-2)]">{r.score}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: col(r.drift90) }}>{pct(r.drift90)}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: col(r.drift30) }}>{pct(r.drift30)}</td>
                <td className="px-2 py-2 text-center tabular-nums whitespace-nowrap">
                  <span className="text-[#22c55e]">↑{r.up30d}</span> <span className="text-[#ef4444]">↓{r.down30d}</span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: col(r.nyDrift90) }}>{pct(r.nyDrift90)}</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: col(r.upsidePct) }}>{pct(r.upsidePct, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Momentum = blended percentile of 90-day EPS drift (60%) and net analyst revisions (40%). Snapshot of consensus from data/estimates.json{data.asOf ? ` · as of ${data.asOf}` : ""}. Not investment advice.</p>
    </main>
  );
}
