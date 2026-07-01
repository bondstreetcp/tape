"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CatalystVolData, CatalystRow } from "@/lib/catalystVol";
import { ratioColor, ratioVerdict } from "@/lib/catalystVol";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
type F = "all" | "cheap";

export default function CatalystVolView({ universe, data }: { universe: string; data: CatalystVolData }) {
  const [f, setF] = useState<F>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (f === "cheap" && r.ratio > 1.1) return false;
      if (ql && !r.ticker.toLowerCase().includes(ql) && !r.company.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.rows, f, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Catalyst Vol — cheap options into an event</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Names with a scheduled <b>investor / analyst / capital-markets day</b> where the options market isn&apos;t pricing the event: the ATM straddle over the event window vs the stock&apos;s own realized-vol baseline. <b style={{ color: ratioColor(0.9) }}>Ratio &lt; 1</b> = options priced <i>below</i> normal vol — no catalyst premium. {data.rows.length} events · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("all")} className={TB(f === "all")}>All</button>
          <button onClick={() => setF("cheap")} className={TB(f === "cheap")} title="implied ≤ 1.1× the realized-vol baseline">Cheap (≤1.1×)</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {data.rows.length}</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Implied = ATM straddle ÷ spot over the expiry bracketing the event. Baseline = the stock&apos;s realized vol projected over the same window. A cheap ratio means the market isn&apos;t adding event premium — but a catalyst calendar is genuinely hard to source, so this covers investor days announced via SEC 8-K and grows as more are filed. Decision support, not advice.
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          <div className="text-[var(--text-2)]">No scheduled investor-day catalysts priced yet.</div>
          <div className="mx-auto mt-1 max-w-md text-[13px]">This scans SEC 8-Ks for announced investor/analyst days and prices the options over each — it fills as companies file them.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[800px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 font-medium">Event</th>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 text-right font-medium">Implied ±</th>
                <th className="px-2 py-2 text-right font-medium">Baseline ±</th>
                <th className="px-2 py-2 text-right font-medium" title="implied ÷ baseline — below 1 = options underpricing the event">Ratio</th>
                <th className="px-2 py-2 text-right font-medium">Expiry</th>
                <th className="px-2 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.ticker}-${r.eventDate}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2">
                    <Link href={`/u/${universe}/stock/${r.ticker}`} className="font-semibold text-[var(--accent)] hover:underline">{r.ticker}</Link>
                    <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.company}</div>
                  </td>
                  <td className="px-2 py-2 text-[var(--text-2)]">{r.eventType}</td>
                  <td className="px-2 py-2 whitespace-nowrap text-[var(--text-3)]">{dateLabel(r.eventDate)}<span className="text-[var(--text-4)]"> · {r.daysToEvent}d</span></td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">±{r.impliedMovePct.toFixed(1)}%</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">±{r.baselineMovePct.toFixed(1)}%</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: ratioColor(r.ratio) }} title={ratioVerdict(r.ratio)}>{r.ratio.toFixed(2)}×</td>
                  <td className="px-2 py-2 text-right font-mono text-[12px] text-[var(--text-4)]">{r.expiry ? r.expiry.slice(5) : "—"} · {r.dte}d</td>
                  <td className="px-2 py-2">{r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">8-K ↗</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
