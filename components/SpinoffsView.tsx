"use client";
/** Spinoff turnover tracker — cumulative volume since the spin (incl. when-issued) as a % of shares
 *  outstanding. Forced sellers (index funds, parent holders who never chose the spinco) exhaust as
 *  the register turns; our 2020-24 backtest calibrates the zone at ~100-150% turned (the classic
 *  "50%" fires too early in the modern churn regime — see scripts/backtest-spinoff-turnover.ts). */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { SpinoffsData, SpinoffRow } from "@/lib/spinoffs";
import { turnoverColor } from "@/lib/spinoffs";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate, fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

type SortKey = "setup" | "turnover" | "recent" | "since";

const shs = (v: number | null) => (v == null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : `${(v / 1e6).toFixed(0)}M`);
const pct = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

function TurnoverBar({ r }: { r: SpinoffRow }) {
  const p = r.turnoverPct;
  if (p == null) return <span className="text-[var(--text-4)]">—</span>;
  const w = Math.min(100, p / 2); // bar spans 0-200% — the backtested signal zone is 100-150%
  return (
    <div className="w-36">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="font-mono text-[13px] font-bold tabular-nums" style={{ color: turnoverColor(p) }}>{p.toFixed(0)}%</span>
        {r.floatTurned && <span className="rounded bg-[#22c55e]/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#22c55e]">register turned</span>}
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--bg)]" title="Bar spans 0-200% turnover. Ticks at 100% and 150% — the zone where forward returns turned positive in our 2020-24 backtest.">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: turnoverColor(p) }} />
        <div className="absolute top-0 h-full w-px bg-[var(--text-4)]" style={{ left: "50%" }} />
        <div className="absolute top-0 h-full w-px bg-[var(--text-4)] opacity-60" style={{ left: "75%" }} />
      </div>
    </div>
  );
}

export default function SpinoffsView({ universe, data }: { universe: string; data: SpinoffsData }) {
  const [sort, setSort] = useState<SortKey>("setup");
  const rows = useMemo(() => {
    const r = [...data.rows];
    if (sort === "setup") r.sort((a, b) => Math.abs(125 - (a.turnoverPct ?? 9999)) - Math.abs(125 - (b.turnoverPct ?? 9999))); // closest to the backtested 100-150% zone first
    else if (sort === "turnover") r.sort((a, b) => (b.turnoverPct ?? -1) - (a.turnoverPct ?? -1));
    else if (sort === "recent") r.sort((a, b) => Date.parse(b.spinDate) - Date.parse(a.spinDate));
    else r.sort((a, b) => (a.sincePct ?? 0) - (b.sincePct ?? 0));
    return r;
  }, [data.rows, sort]);

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Spinoff Turnover</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Completed spinoffs with the <b>share-register turnover clock</b> — cumulative volume since the spin (incl. when-issued trading) as a % of shares outstanding.
            Index funds and parent holders dump shares they never chose to own; the classic rule said ~50% turned = the bottom, but our backtest of 28 spins (2020-24) shows modern churn fires that too early — the zone that worked is <b className="text-[#22c55e]">~100-150% turned</b> (+12% median next 6 months, 71-74% positive; at 50% a median −21% still lay ahead). {data.rows.length} spincos · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          {([["setup", "Near the turn zone"], ["turnover", "Most turned"], ["recent", "Newest spins"], ["since", "Worst since spin"]] as [SortKey, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (sort === k ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{l}</button>
          ))}
        </div>
        <Link href={`/u/${universe}/corp-events`} className="ml-auto text-xs text-[var(--accent)] hover:underline">Announced (not yet completed) spinoffs → Corp Events</Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">Nothing here yet — this fills in on the nightly data refresh.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[880px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Spinco</th>
                <th className="px-2 py-2 font-medium">Parent</th>
                <th className="px-2 py-2 font-medium">Spun</th>
                <th className="px-2 py-2 text-right font-medium">Since spin</th>
                <th className="px-2 py-2 font-medium" title="Cumulative volume since the spin (+ when-issued) ÷ shares outstanding. Bar spans 0-200%; ticks at 100% and 150% — the backtested signal zone.">Register turned</th>
                <th className="px-2 py-2 text-right font-medium">Shares out</th>
                <th className="px-2 py-2 text-right font-medium" title="When-issued volume captured pre-spin (0 = Yahoo carries no WI line)">WI vol</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2.5">
                    <Link href={`/u/${universe}/stock/${encodeURIComponent(r.ticker)}`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{r.ticker}</Link>
                    <div className="max-w-[200px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                  </td>
                  <td className="px-2 py-2.5 text-[12px] text-[var(--text-3)]">{r.parent} <span className="font-mono text-[var(--text-4)]">({r.parentTicker})</span></td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-[12px] text-[var(--text-3)]">{fmtDate(r.spinDate)} <span className="text-[var(--text-4)]">· {r.daysSince}d</span></td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums font-semibold" style={{ color: (r.sincePct ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>{pct(r.sincePct)}</td>
                  <td className="px-2 py-2.5"><TurnoverBar r={r} /></td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--text-3)]">{shs(r.sharesOut)}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--text-4)]">{r.wiVol > 0 ? `${(r.wiVol / 1e6).toFixed(1)}M` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Turnover counts every share traded, so the same share changing hands twice counts twice, which is why the classic 50% rule fires too early today — our 2020-24 backtest calibrates the exhaustion zone at ~100-150% (see scripts/backtest-spinoff-turnover.ts). When-issued volume included where Yahoo carries the WI line. Research, not advice.</p>
    </main>
  );
}
