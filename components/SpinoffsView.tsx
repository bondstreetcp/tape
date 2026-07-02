"use client";
/** Spinoff turnover tracker — cumulative volume since the spin (incl. when-issued) as a % of shares
 *  outstanding. The special-situations read: forced sellers (index funds, parent holders who never
 *  chose the spinco) are usually exhausted once ~50% of the register has turned — the bottom zone. */
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
  const w = Math.min(100, p);
  return (
    <div className="w-36">
      <div className="mb-0.5 flex items-baseline justify-between">
        <span className="font-mono text-[13px] font-bold tabular-nums" style={{ color: turnoverColor(p) }}>{p.toFixed(0)}%</span>
        {r.floatTurned && <span className="rounded bg-[#22c55e]/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-[#22c55e]">float turned</span>}
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: turnoverColor(p) }} />
        {/* the 50% seller-exhaustion marker */}
        <div className="absolute top-0 h-full w-px bg-[var(--text-4)]" style={{ left: "50%" }} />
      </div>
    </div>
  );
}

export default function SpinoffsView({ universe, data }: { universe: string; data: SpinoffsData }) {
  const [sort, setSort] = useState<SortKey>("setup");
  const rows = useMemo(() => {
    const r = [...data.rows];
    if (sort === "setup") r.sort((a, b) => Math.abs(50 - (a.turnoverPct ?? 999)) - Math.abs(50 - (b.turnoverPct ?? 999))); // closest to the 50% zone first
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
            Index funds and parent holders dump shares they never chose to own; once <b className="text-[#22c55e]">~50% of the register has turned</b>, the forced selling is usually spent — historically the bottom zone. {data.rows.length} spincos · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          {([["setup", "Near the 50% zone"], ["turnover", "Most turned"], ["recent", "Newest spins"], ["since", "Worst since spin"]] as [SortKey, string][]).map(([k, l]) => (
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
                <th className="px-2 py-2 font-medium" title="Cumulative volume since the spin (+ when-issued) ÷ shares outstanding. The vertical tick marks 50%.">Register turned</th>
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
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Turnover counts every share traded, so the same share changing hands twice counts twice — the 50% rule is a heuristic for forced-seller exhaustion, not a guarantee. When-issued volume included where Yahoo carries the WI line. Research, not advice.</p>
    </main>
  );
}
