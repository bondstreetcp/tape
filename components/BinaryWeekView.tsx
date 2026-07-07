"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { BINARY_META, type BinaryEvent, type BinaryKind } from "@/lib/binaryWeek";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import HowToRead from "./HowToRead";

const dateLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const clock = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`);
type Horizon = 7 | 14 | 30;
type Filter = "all" | "binary" | "earnings";

export default function BinaryWeekView({ universe, events, generatedAt }: { universe: string; events: BinaryEvent[]; generatedAt: string }) {
  const [horizon, setHorizon] = useState<Horizon>(7);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return events.filter((e) => {
      if (e.daysTo > horizon) return false;
      if (filter === "binary" && !e.hardBinary) return false;
      if (filter === "earnings" && e.kind !== "earnings") return false;
      if (ql && !e.ticker.toLowerCase().includes(ql) && !e.company.toLowerCase().includes(ql) && !(e.detail ?? "").toLowerCase().includes(ql) && !e.label.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [events, horizon, filter, q]);

  const hardN = useMemo(() => events.filter((e) => e.hardBinary && e.daysTo <= horizon).length, [events, horizon]);
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[76rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Binary Events This Week</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The near-term dated catalysts that can move a stock hard — FDA decisions, clinical readouts, earnings prints, investor days, lockup expiries — ranked by the options-implied move (biggest potential mover first). {hardN} hard binaries in the next {horizon}d · {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>What&apos;s here:</b> a single ranked list of every dated event in the window that can produce an outsized move, pulled from the app&apos;s forward feeds (earnings, biotech PDUFA/readouts, investor days, IPO lockups) — no double-checking six boards.</p>
        <p><b>How it&apos;s ranked:</b> by the <b>options-implied move</b> where the market prices one (earnings, biotech binaries with listed options, investor days). Where there&apos;s no priced move (many small-cap readouts), the event is ranked on a type prior — a Phase 2/3 readout and a PDUFA are treated as high-impact by nature. So the biggest potential movers float to the top.</p>
        <p><b>Hard binaries</b> (FDA decisions &amp; clinical readouts) — discrete, potentially make-or-break outcomes — are flagged with a ◆ and can be isolated with the Binaries filter. Click any implied move to open that name&apos;s options read on the biotech-vol / earnings board.</p>
        <p>Dates are estimates from public filings; not advice.</p>
      </HowToRead>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {([7, 14, 30] as Horizon[]).map((h) => <button key={h} onClick={() => setHorizon(h)} className={TB(horizon === h)}>{h}d</button>)}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setFilter("all")} className={TB(filter === "all")}>All</button>
          <button onClick={() => setFilter("binary")} className={TB(filter === "binary")} title="FDA decisions + clinical readouts only">◆ Binaries</button>
          <button onClick={() => setFilter("earnings")} className={TB(filter === "earnings")}>Earnings</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker, company, drug…" className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} events</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No dated binary events in the next {horizon} days{filter !== "all" ? " for this filter" : ""}. Widen the window or the nightly feeds will fill it.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-2 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 font-medium">Event</th>
                <th className="px-2 py-2 text-right font-medium" title="Options-implied move (or a type estimate where no options price the event)">Implied ±</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const m = BINARY_META[e.kind];
                const soon = e.daysTo <= 2;
                return (
                  <tr key={`${e.ticker}-${e.date}-${e.kind}-${i}`} className="border-b border-[var(--border)] last:border-0 align-top hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-[var(--text-2)]">{dateLabel(e.date)}</div>
                      <div className="text-[11px]" style={{ color: soon ? "#f59e0b" : "var(--text-4)" }}>{clock(e.daysTo)}</div>
                    </td>
                    <td className="px-2 py-2">
                      <Link href={`/u/${universe}/stock/${e.ticker}`} className="font-semibold text-[var(--accent)] hover:underline">{e.ticker}</Link>
                      <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{e.company}</div>
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1">
                        {e.hardBinary && <span title="hard binary — discrete, potentially large outcome" style={{ color: m.color }}>◆</span>}
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: m.color, background: `color-mix(in oklab, ${m.color} 15%, transparent)` }}>{m.label}</span>
                      </span>
                      {e.detail && (
                        <div className="mt-0.5 max-w-[300px] truncate text-[12px] text-[var(--text-2)]" title={e.detail}>
                          {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)] hover:underline">{e.detail}</a> : e.detail}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {e.impliedMovePct != null
                        ? <span className="font-semibold text-[var(--text)]">±{e.impliedMovePct.toFixed(0)}%</span>
                        : <span className="text-[var(--text-4)]" title="No options price this event — ranked on the event type">—</span>}
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
