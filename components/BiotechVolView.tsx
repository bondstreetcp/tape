"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { BiotechVolData, BioVolRow } from "@/lib/biotechVol";
import { volTag, volTagColor, volTagLabel } from "@/lib/biotechVol";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import HowToRead from "./HowToRead";

const dateLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
type KindF = "all" | "pdufa" | "readout";
type SortK = "soonest" | "light" | "loaded" | "implied";

export default function BiotechVolView({ universe, data }: { universe: string; data: BiotechVolData }) {
  const [kindF, setKindF] = useState<KindF>("all");
  const [sort, setSort] = useState<SortK>("soonest");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let r = data.rows.filter((x) => {
      if (kindF !== "all" && x.eventKind !== kindF) return false;
      if (ql && !x.ticker.toLowerCase().includes(ql) && !x.company.toLowerCase().includes(ql) && !x.drug.toLowerCase().includes(ql) && !x.condition.toLowerCase().includes(ql)) return false;
      return true;
    });
    const by: Record<SortK, (a: BioVolRow, b: BioVolRow) => number> = {
      soonest: (a, b) => a.daysToEvent - b.daysToEvent,
      light: (a, b) => (a.premiumPctile ?? 999) - (b.premiumPctile ?? 999),
      loaded: (a, b) => (b.premiumPctile ?? -1) - (a.premiumPctile ?? -1),
      implied: (a, b) => (b.impliedMovePct ?? 0) - (a.impliedMovePct ?? 0),
    };
    return r.slice().sort(by[sort]);
  }, [data.rows, kindF, sort, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[76rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Biotech Event Vol</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every dated clinical binary — an FDA <b>PDUFA</b> decision or a Phase 2/3 <b>readout</b> — priced against the options chain: the straddle over the expiry bracketing the event vs the stock&apos;s own realized-vol baseline. {data.rows.length} priced · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>What this is:</b> the binary-event calendar from Biotech Catalysts, but priced. For each upcoming FDA decision or trial readout, we price the at-the-money straddle to the expiry that brackets the event.</p>
        <p><b>Implied move</b> = that straddle ÷ the stock price — how big a move the options market is pricing for the binary. <b>Baseline</b> = the stock&apos;s own realized-vol move over the same window (what it&apos;d do on ordinary vol, no event).</p>
        <p><b>Event premium</b> = implied ÷ baseline. Unlike an investor day, a real biotech binary is <i>expected</i> to move big — so the read is <b>relative</b>: we rank each event&apos;s premium against the whole biotech cohort. <b style={{ color: "#14b8a6" }}>Options light</b> = the market is loading the binary the least (cheap optionality if you believe it&apos;s make-or-break); <b style={{ color: "#f59e0b" }}>fully loaded</b> = richly priced.</p>
        <p><b>Caveat:</b> mega-cap pharma (a single trial isn&apos;t material) will always look "light"; the signal is sharpest on single-asset small-caps. Dates are estimates from public filings; not advice.</p>
      </HowToRead>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setKindF("all")} className={TB(kindF === "all")}>All</button>
          <button onClick={() => setKindF("pdufa")} className={TB(kindF === "pdufa")}>PDUFA</button>
          <button onClick={() => setKindF("readout")} className={TB(kindF === "readout")}>Readouts</button>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setSort("soonest")} className={TB(sort === "soonest")}>Soonest</button>
          <button onClick={() => setSort("light")} className={TB(sort === "light")} title="Options loading the binary the least, cohort-relative">Options light</button>
          <button onClick={() => setSort("loaded")} className={TB(sort === "loaded")}>Most loaded</button>
          <button onClick={() => setSort("implied")} className={TB(sort === "implied")}>Biggest move</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker, drug, indication…" className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {data.rows.length}</span>
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No dated biotech binaries with priceable options right now — fills on the nightly run (needs a PDUFA/readout date with listed options reaching it).</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 font-medium">Event</th>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 text-right font-medium" title="Options-implied move to the bracketing expiry">Implied ±</th>
                <th className="px-2 py-2 text-right font-medium" title="The stock's realized-vol move over the same window">Baseline ±</th>
                <th className="px-2 py-2 text-right font-medium" title="Implied ÷ baseline — the event premium">Premium</th>
                <th className="px-2 py-2 text-center font-medium">Read</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const t = volTag(r.premiumPctile);
                const soon = r.daysToEvent <= 30;
                return (
                  <tr key={`${r.ticker}-${r.eventDate}-${i}`} className="border-b border-[var(--border)] last:border-0 align-top hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-2">
                      <Link href={`/u/${universe}/stock/${r.ticker}`} className="font-semibold text-[var(--accent)] hover:underline">{r.ticker}</Link>
                      <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.company}</div>
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: r.eventKind === "pdufa" ? "#a78bfa" : "#f59e0b", background: `color-mix(in oklab, ${r.eventKind === "pdufa" ? "#a78bfa" : "#f59e0b"} 15%, transparent)` }}>{r.eventKind === "pdufa" ? "PDUFA" : r.phase || "Readout"}</span>
                      <div className="mt-0.5 max-w-[240px] truncate text-[12px] text-[var(--text-2)]" title={`${r.drug}${r.condition ? " · " + r.condition : ""}`}>{r.drug}{r.condition ? <span className="text-[var(--text-4)]"> · {r.condition}</span> : null}</div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-[var(--text-2)]">{dateLabel(r.eventDate)}<div className="text-[11px]" style={{ color: soon ? "#f59e0b" : "var(--text-4)" }}>in {r.daysToEvent}d</div></td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold text-[var(--text)]">±{r.impliedMovePct?.toFixed(0)}%</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">±{r.baselineMovePct?.toFixed(0)}%</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{r.ratio?.toFixed(2)}×</td>
                    <td className="px-2 py-2 text-center whitespace-nowrap">
                      {t && <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: volTagColor(t), background: `color-mix(in oklab, ${volTagColor(t)} 16%, transparent)` }}>{volTagLabel(t)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
