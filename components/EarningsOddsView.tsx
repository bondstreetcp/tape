"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate } from "@/lib/format";
import { daysUntil } from "@/lib/calendar";
import type { EarningsOddsFile, EarningsOddsRow } from "@/lib/earningsOdds";

// /earnings-odds — three independent reads on the same print, disagreeing in public: Polymarket's
// real-money P(beat), the options market's implied ±move, and the desk's own predicted print. The
// load-bearing column is DRIFT: the market froze its EPS bar in the slug at creation while street
// consensus kept moving, so bar-vs-consensus is mechanical, code-computed staleness.

type Sort = "date" | "drift" | "pbeat" | "volume";

const money = (v: number | null) => (v == null ? "—" : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}k` : `$${v}`);
const eps = (v: number | null) => (v == null ? "—" : `$${v.toFixed(2)}`);
const cents = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}¢`);

export default function EarningsOddsView({ universe, data }: { universe: string; data: EarningsOddsFile }) {
  const [sort, setSort] = useState<Sort>("date");
  const [hideThin, setHideThin] = useState(false);

  const rows = useMemo(() => {
    let r = data.rows;
    if (hideThin) r = r.filter((x) => !x.thin);
    const by: Record<Sort, (a: EarningsOddsRow, b: EarningsOddsRow) => number> = {
      date: (a, b) => a.reportDate.localeCompare(b.reportDate) || (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0),
      drift: (a, b) => Math.abs(b.driftEps ?? 0) - Math.abs(a.driftEps ?? 0),
      pbeat: (a, b) => (b.pBeat ?? -1) - (a.pBeat ?? -1),
      volume: (a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0),
    };
    return [...r].sort(by[sort]);
  }, [data.rows, sort, hideThin]);

  const SortBtn = ({ k, label }: { k: Sort; label: string }) => (
    <button
      onClick={() => setSort(k)}
      className={`rounded-full border px-2.5 py-1 text-[11px] ${sort === k ? "border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]"}`}
    >
      {label}
    </button>
  );

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Earnings Odds"
        desc="Every open Polymarket 'will X beat earnings?' market, crossed with what the options market and the desk's own model expect for the same print. The key column is drift: Polymarket freezes its EPS bar when the market is created, while street consensus keeps moving — so bar-vs-consensus staleness is computed by code, not judged. Books are thin; volume and spread are printed so you can weigh the odds accordingly. Decision-support, not advice."
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-3)]">
        <SortBtn k="date" label="By report date" />
        <SortBtn k="drift" label="By |drift|" />
        <SortBtn k="pbeat" label="By P(beat)" />
        <SortBtn k="volume" label="By volume" />
        <label className="ml-2 flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={hideThin} onChange={(e) => setHideThin(e.target.checked)} />
          hide thin books
        </label>
        <span className="ml-auto text-[11px] text-[var(--text-4)]">
          {rows.length} markets · venue listed {data.scanned} ({data.offUniverse} off-universe, {data.pastDated} awaiting resolution) · {fmtDate(data.generatedAt)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[1080px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Report</th>
              <th className="px-3 py-2">
                Bar <InfoDot text="The EPS strike frozen into the Polymarket question at creation — 'will EPS beat this number?'. GAAP or non-GAAP as the market itself declares." />
              </th>
              <th className="px-3 py-2">Consensus now</th>
              <th className="px-3 py-2">
                Drift <InfoDot text="Today's street consensus minus the frozen bar (non-GAAP markets only — a GAAP bar vs the street's adjusted number would be apples-to-oranges, so those rows show —). Positive = consensus has RISEN above the bar: the market's question got easier than it sounds, and its YES should be expensive. Negative = the bar is now above consensus: a harder beat than the headline suggests." />
              </th>
              <th className="px-3 py-2">
                P(beat) <InfoDot text="Polymarket's YES price — mid of best bid/ask where both sides are quoted. Suppressed ('wide') when the spread exceeds 10c: on a book that wide the price is decoration, not information." />
              </th>
              <th className="px-3 py-2">Volume</th>
              <th className="px-3 py-2">
                Implied ± <InfoDot text="The options market's straddle-priced earnings move, from the Expected-Move screener (joins for reporters inside its scan window; blank otherwise)." />
              </th>
              <th className="px-3 py-2">
                Desk call <InfoDot text="The desk model's own predicted print for THIS report (from the Preview Accuracy Record, logged before earnings). Only a subset of reporters gets a forecast each night." />
              </th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = daysUntil(r.reportDate);
              return (
                <tr key={r.polymarketSlug} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface)]">
                  <td className="px-3 py-2">
                    <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                    <span className="ml-2 hidden text-[12px] text-[var(--text-4)] lg:inline">{r.name}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-2)]">
                    {fmtDate(r.reportDate)}
                    {d != null && d >= 0 && <span className="ml-1.5 text-[11px] text-[var(--text-4)]">{d === 0 ? "today" : `in ${d}d`}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="font-medium text-[var(--text-2)]">{eps(r.strikeEps)}</span>
                    <span className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${r.basis === "nongaap" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--text-4)]"}`}>{r.basis === "nongaap" ? "adj" : "GAAP"}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-2)]">
                    {eps(r.epsAvg)}
                    {r.epsAnalysts != null && <span className="ml-1 text-[11px] text-[var(--text-4)]">({r.epsAnalysts})</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.driftEps == null ? (
                      <span className="text-[var(--text-4)]" title={r.basis === "gaap" ? "GAAP bar — street consensus is the adjusted number, so no honest comparison exists" : "no consensus available"}>—</span>
                    ) : (
                      <span className={`font-medium ${r.driftEps > 0 ? "text-[#22c55e]" : r.driftEps < 0 ? "text-[#ef4444]" : "text-[var(--text-3)]"}`} title={r.epsAvg30dAgo != null ? `consensus 30d ago: $${r.epsAvg30dAgo.toFixed(2)}` : undefined}>
                        {cents(r.driftEps)} {r.driftEps > 0 ? "· easier beat" : r.driftEps < 0 ? "· harder beat" : ""}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.thin || r.pBeat == null ? (
                      <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-4)]" title={r.spread != null ? `bid/ask spread ${Math.round(r.spread * 100)}c — too wide to quote as a probability` : "no two-sided quote"}>wide</span>
                    ) : (
                      <span className="font-semibold text-[var(--text)]">{Math.round(r.pBeat * 100)}%</span>
                    )}
                    {r.spread != null && !r.thin && <span className="ml-1 text-[11px] text-[var(--text-4)]">±{Math.round((r.spread * 100) / 2)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-3)]">{money(r.volumeUsd)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--text-2)]">{r.impliedMovePct == null ? <span className="text-[var(--text-4)]">—</span> : `±${r.impliedMovePct.toFixed(1)}%`}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.predCall ? (
                      <span className={`text-[12px] font-medium ${r.predCall === "beat" ? "text-[#22c55e]" : r.predCall === "miss" ? "text-[#ef4444]" : "text-[var(--text-3)]"}`}>
                        {r.predCall}
                        {r.predEps != null && <span className="ml-1 text-[11px] font-normal text-[var(--text-4)]">{eps(r.predEps)}</span>}
                      </span>
                    ) : (
                      <span className="text-[var(--text-4)]">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <a href={`https://polymarket.com/event/${r.polymarketSlug}`} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">market ↗</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Odds are real-money but books are small (median a few $k) — treat P(beat) as a noisy crowd read, not a price you could trade at size. Drift compares like with like only (adjusted bar vs adjusted consensus). Not investment advice.
      </p>
    </main>
  );
}
