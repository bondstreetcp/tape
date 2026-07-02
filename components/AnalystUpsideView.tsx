"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { isBuyRated, type RecTone, type UpsideData } from "@/lib/analystUpside";

const TONE: Record<RecTone, string> = { up: "#22c55e", neutral: "#f59e0b", down: "#ef4444" };
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const upColor = (v: number) => (v >= 0 ? "#22c55e" : "#ef4444");

export default function AnalystUpsideView({ data, universe }: { data: UpsideData; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [sector, setSector] = useState<string | null>(null);
  const [buyOnly, setBuyOnly] = useState(false);

  const sectors = useMemo(() => Array.from(new Set(data.rows.map((r) => r.sector).filter(Boolean))).sort(), [data.rows]);
  const rows = useMemo(
    () => data.rows.filter((r) => (!sector || r.sector === sector) && (!buyOnly || isBuyRated(r.recTone, r.recLabel))).slice(0, 150),
    [data.rows, sector, buyOnly],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Analyst Upside"
        desc="Where the Street sees the most room — every name ranked by mean price-target upside (consensus target ÷ price), with the Buy/Hold/Sell rating and the high–low target spread alongside. Read it WITH the rating: a big upside on a Hold-rated name usually means stale targets or a falling price, not conviction. Decision-support, not advice."
      />

      {/* Sector strip — avg target upside by sector */}
      {data.sectors.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Average target upside by sector</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {data.sectors.map((s) => (
              <button
                key={s.sector}
                onClick={() => setSector(sector === s.sector ? null : s.sector)}
                className={"rounded-lg border p-2 text-left transition-colors " + (sector === s.sector ? "border-[var(--border-strong)] bg-[var(--surface-hover)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]")}
              >
                <div className="truncate text-[11px] text-[var(--text-2)]">{s.sector}</div>
                <div className="flex items-baseline justify-between gap-1">
                  <span className="text-sm font-bold tabular-nums" style={{ color: upColor(s.avgUpside) }}>{pct(s.avgUpside)}</span>
                  <span className="text-[10px] text-[var(--text-4)]">{s.total}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setBuyOnly((v) => !v)}
          className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (buyOnly ? "bg-[var(--accent-strong)] text-white" : "border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]")}
        >
          ✓ Buy-rated only
        </button>
        <select value={sector ?? ""} onChange={(e) => setSector(e.target.value || null)} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-2)]">
          <option value="">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(sector || buyOnly) && <button onClick={() => { setSector(null); setBuyOnly(false); }} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {data.coverage} covered · {uname}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[680px] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-2 py-2 text-right font-medium">Upside</th>
              <th className="px-2 py-2 text-right font-medium">Price</th>
              <th className="px-2 py-2 text-right font-medium" title="Mean price target (high–low range)">Target</th>
              <th className="px-2 py-2 font-medium">Rating</th>
              <th className="px-3 py-2 text-right font-medium" title="Number of covering analysts"># An.</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={99} className="p-10 text-center text-sm text-[var(--text-3)]">No coverage for this universe — this dataset covers US names (S&P 500 first). Use the universe switcher above.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className="px-3 py-2 tabular-nums text-[var(--text-4)]">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                  <span className="ml-2 hidden text-[var(--text-4)] sm:inline">{r.name.length > 24 ? r.name.slice(0, 24) + "…" : r.name}</span>
                  <span className="ml-2 text-[10px] text-[var(--text-4)]">{r.sector}</span>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: upColor(r.upsidePct) }}>{pct(r.upsidePct)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-3)]">{r.price.toFixed(2)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">
                  {r.target.toFixed(0)}
                  {r.targetHigh != null && r.targetLow != null && <span className="ml-1 text-[10px] text-[var(--text-4)]">({r.targetLow.toFixed(0)}–{r.targetHigh.toFixed(0)})</span>}
                </td>
                <td className="px-2 py-2">
                  <span className="whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ color: TONE[r.recTone], background: TONE[r.recTone] + "1a" }}>{r.recLabel}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-3)]">{r.analysts ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Ranked by mean-target upside; only names with ≥3 covering analysts. Consensus from data/estimates.json{data.asOf ? ` · as of ${data.asOf}` : ""}. Price targets are sell-side opinion and often lag price — not investment advice.</p>
    </main>
  );
}
