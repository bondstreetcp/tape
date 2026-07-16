"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  HORIZONS, SIGNAL_META, eventReturn, edgeOf,
  type HorizonKey, type SignalEvent, type SignalKey, type SignalSummary, type TagSummary,
} from "@/lib/signalLog";
import { SIGNAL_META as CONFLUENCE_KIND_META } from "@/lib/confluence";
import { WARNING_META } from "@/lib/warnings";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDate, fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import HowToRead from "./HowToRead";
import SignalBacktest from "./SignalBacktest";
import type { BacktestFile } from "@/lib/signalBacktest";

const UP = "#22c55e", DOWN = "#ef4444";
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`);
const edgeColor = (v: number | null | undefined) => (v == null ? "var(--text-4)" : v > 0.002 ? UP : v < -0.002 ? DOWN : "var(--text-3)");
const dirLabel = { bullish: "Bullish", bearish: "Bearish", move: "Big move" } as const;

export default function SignalRecordView({
  universe, summariesAll, summariesFresh, events, totalEvents, since, generatedAt, backtest,
  confluenceMix = [], confluenceMixSince = null, warningsMix = [], warningsMixSince = null,
}: {
  universe: string;
  summariesAll: SignalSummary[]; // every event, seed entries included
  summariesFresh: SignalSummary[]; // fresh appearances only (seed nights excluded)
  events: SignalEvent[]; // latest slice for the table (the summary covers ALL events)
  totalEvents: number;
  since: string;
  generatedAt: string;
  backtest: BacktestFile | null; // ~5y replay of the price-reconstructible signals (null until first run)
  confluenceMix?: TagSummary[]; // per-kind attribution within Confluence (tags logged from 2026-07-12)
  confluenceMixSince?: string | null; // date of the first kind-tagged Confluence entry
  warningsMix?: TagSummary[]; // per-kind attribution within Warning Signs (bearish grading)
  warningsMixSince?: string | null;
}) {
  const [filter, setFilter] = useState<SignalKey | "all">("all");
  const [q, setQ] = useState("");
  const [includeSeed, setIncludeSeed] = useState(true);
  const [tab, setTab] = useState<"live" | "backtest">("live");
  const summaries = includeSeed ? summariesAll : summariesFresh;

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return events.filter((e) => (filter === "all" || e.signal === filter) && (!ql || e.symbol.toLowerCase().includes(ql) || e.name.toLowerCase().includes(ql)));
  }, [events, filter, q]);

  const TB = (a: boolean) => "rounded-md px-2 py-1 text-[11px] font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Signal Track Record</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every idea board graded on what actually happened next. Each name is logged the day it appears on a board, then scored on its 1-week / 1-month / 3-month return vs the S&amp;P 500. Logged live since {fmtDate(since)} — forward-only, no backfill. {totalEvents} entries · {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {backtest && (
        <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setTab("live")} className={TB(tab === "live")}>Live record (since {fmtDate(since)})</button>
          <button onClick={() => setTab("backtest")} className={TB(tab === "backtest")} title="The price-reconstructible signals replayed monthly over ~5 years of stored series">Backtest (~5y, price signals)</button>
        </div>
      )}

      {tab === "backtest" && backtest ? (
        <SignalBacktest bt={backtest} />
      ) : (
      <>
      <HowToRead>
        <p><b>What&apos;s here:</b> the accountability layer for the idea scanners. The boards (Confluence, Warning Signs, Squeeze, Leaders…) are rebuilt and overwritten every night — so this page keeps the receipts: the day a name first shows up on a board, we log it with its price, then check back at fixed horizons.</p>
        <p><b>Edge</b> is the one number where bigger is always better, whatever the signal&apos;s direction: for <b>bullish</b> boards it&apos;s the return <i>in excess of the S&amp;P 500</i>; for <b>bearish</b> boards (Warning Signs, Distribution, put-positioning) it&apos;s the <i>inverse</i> — a fall or a lag counts as a win; for <b>Coiled Springs</b> (a bet on a big move, either way) it&apos;s how much <i>more</i> the stock moved than the index, direction ignored.</p>
        <p><b>Hit rate</b> = the share of wins: bullish → the stock rose; bearish → it fell; big-move → it out-moved the index. <b>Open</b> entries haven&apos;t reached their final (3-month) check yet. Entries marked <b>seed</b> were logged on a board&apos;s very first tracked night (the whole board at once, rather than a fresh appearance) — the checkbox above the scorecard excludes them.</p>
        <p><b>Honest limits:</b> boards are logged from the broadest US universe (Russell 3000 context), returns are price-only (no dividends — entry prices and marks ARE re-based nightly across splits and spinoffs, so a 10-for-1 mid-window leaves the return intact), marks land on the first weekday on/after each horizon (never more than 2 weeks late — later marks are dropped, not mislabeled), and the record only starts accruing from {fmtDate(since)} — early numbers are small-sample noise, not a verdict. Decision-support, not advice.</p>
      </HowToRead>

      {/* Scorecard */}
      <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-3)]">
        <input type="checkbox" checked={includeSeed} onChange={(e) => setIncludeSeed(e.target.checked)} className="accent-[var(--accent)]" />
        Include seed entries <span className="text-[var(--text-4)]">(each board&apos;s first tracked night)</span>
      </label>
      <div className="mb-6 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[900px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Signal</th>
              <th className="px-2 py-2 font-medium">Direction</th>
              <th className="px-2 py-2 text-right font-medium" title="Entries logged (all time)">Logged</th>
              <th className="px-2 py-2 text-right font-medium" title="Not yet past the 3-month check">Open</th>
              {HORIZONS.map((h) => (
                <th key={h.key} className="px-2 py-2 text-right font-medium" title={`Average direction-adjusted edge (vs S&P) and hit rate over graded ${h.label} windows`}>{h.label} edge · hit</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => {
              const meta = SIGNAL_META[s.signal];
              return (
                <tr key={s.signal} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2">
                    <Link href={`/u/${universe}${meta.path}`} className="font-semibold text-[var(--accent)] hover:underline">{meta.label}</Link>
                    <div className="max-w-[260px] truncate text-[11px] text-[var(--text-4)]" title={meta.desc}>{meta.desc}</div>
                  </td>
                  <td className="px-2 py-2">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: meta.color, background: `color-mix(in oklab, ${meta.color} 15%, transparent)` }}>{dirLabel[meta.direction]}</span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{s.events}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{s.open}</td>
                  {HORIZONS.map((h) => {
                    const hz = s.horizons[h.key];
                    return (
                      <td key={h.key} className="px-2 py-2 text-right font-mono tabular-nums">
                        {hz ? (
                          <span>
                            <b style={{ color: edgeColor(hz.avgEdge) }}>{pct(hz.avgEdge)}</b>
                            <span className="text-[var(--text-4)]"> · {hz.hitRate == null ? "—" : `${Math.round(hz.hitRate * 100)}%`}</span>
                            <span className="text-[10px] text-[var(--text-4)]"> n{hz.n}</span>
                          </span>
                        ) : (
                          <span className="text-[var(--text-4)]" title="No entries have reached this horizon yet">accruing…</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-kind attribution within the two fusion boards (the input to future evidence-based weights) */}
      <MixPanel
        title="Confluence mix — which stacked signals carry the edge?"
        boardLabel="Confluence"
        mix={confluenceMix}
        since={confluenceMixSince}
        kindMeta={CONFLUENCE_KIND_META}
      />
      <MixPanel
        title="Warnings mix — which bear signals carry the edge?"
        boardLabel="Warning Signs"
        mix={warningsMix}
        since={warningsMixSince}
        kindMeta={WARNING_META}
        note="Graded bearish: a fall or a lag vs the S&P counts as a win."
      />

      {/* Event log */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setFilter("all")} className={TB(filter === "all")}>All</button>
          {summaries.map((s) => (
            <button key={s.signal} onClick={() => setFilter(s.signal)} className={TB(filter === s.signal)}>{SIGNAL_META[s.signal].label}</button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        <span className="ml-auto text-xs text-[var(--text-4)]">{shown.length} of the latest {events.length} entries</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Logged</th>
              <th className="px-2 py-2 font-medium">Signal</th>
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 text-right font-medium">Entry</th>
              {HORIZONS.map((h) => <th key={h.key} className="px-2 py-2 text-right font-medium" title={`Raw return, entry → first run on/after ${h.days} calendar days`}>{h.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const meta = SIGNAL_META[e.signal];
              return (
                <tr key={e.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2 whitespace-nowrap text-[var(--text-3)]">
                    {fmtDate(e.date)}
                    {e.seed && <span className="ml-1.5 rounded bg-[var(--surface-2)] px-1 py-0.5 text-[9px] font-semibold uppercase text-[var(--text-4)]" title="Logged on this signal's first tracked night (whole board), not a fresh appearance">seed</span>}
                  </td>
                  <td className="px-2 py-2">
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: meta.color, background: `color-mix(in oklab, ${meta.color} 15%, transparent)` }}>{meta.label}</span>
                  </td>
                  <td className="px-2 py-2">
                    <Link href={`/u/${universe}/stock/${e.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{e.symbol}</Link>
                    <span className="ml-2 text-[11px] text-[var(--text-4)]">{e.note ?? ""}</span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{e.entryPrice.toFixed(2)}</td>
                  {HORIZONS.map((h) => {
                    const r = eventReturn(e, h.key);
                    const edge = r ? edgeOf(meta.direction, r) : null;
                    return (
                      <td key={h.key} className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: edgeColor(edge) }} title={r?.excess != null ? `vs S&P: ${pct(r.excess)}` : undefined}>
                        {r ? pct(r.ret) : <span className="text-[var(--text-4)]">·</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </main>
  );
}

/** Per-kind attribution table for one fusion board (Confluence / Warning Signs): entries logged
 * carrying each signal kind, graded like the scorecard. Shared shape so the two can't drift. */
function MixPanel({
  title, boardLabel, mix, since, kindMeta, note,
}: {
  title: string;
  boardLabel: string;
  mix: TagSummary[];
  since: string | null;
  kindMeta: Record<string, { label: string; color: string; blurb: string }>;
  note?: string;
}) {
  return (
    <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-3 py-2.5">
        <h2 className="text-sm font-semibold text-[var(--text)]">{title}</h2>
        <p className="mt-0.5 text-[11px] text-[var(--text-4)]">
          {boardLabel} entries log WHICH signal kinds they carried{since ? ` (since ${fmtDate(since)})` : ""}. Each row: entries that carried that kind, graded like the scorecard. A name carrying several kinds counts toward each — this reads conditional performance (&ldquo;how did names carrying X do&rdquo;), not an isolated factor return. The engine&apos;s weights are hand-set priors today; this table is the evidence that will eventually re-set them.{note ? ` ${note}` : ""}
        </p>
      </div>
      {mix.length === 0 ? (
        <div className="px-3 py-4 text-[12px] text-[var(--text-4)]">
          No kind-tagged entries yet — {boardLabel} entries carry their signal kinds from the next nightly run onward; per-kind grades appear as those entries reach their 1-week / 1-month / 3-month marks.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-3 py-2 font-medium">Signal kind</th>
                <th className="px-2 py-2 text-right font-medium" title={`Kind-tagged ${boardLabel} entries carrying this signal`}>Entries</th>
                <th className="px-2 py-2 text-right font-medium" title="Not yet past the 3-month check">Open</th>
                {HORIZONS.map((h) => (
                  <th key={h.key} className="px-2 py-2 text-right font-medium" title={`Average direction-adjusted edge (vs S&P) and hit rate over graded ${h.label} windows, for entries carrying this kind`}>{h.label} edge · hit</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mix.map((t) => {
                const km = kindMeta[t.tag];
                return (
                  <tr key={t.tag} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                    <td className="px-3 py-2">
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={km ? { color: km.color, background: `color-mix(in oklab, ${km.color} 15%, transparent)` } : undefined} title={km?.blurb}>
                        {km?.label ?? t.tag}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{t.events}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{t.open}</td>
                    {HORIZONS.map((h) => {
                      const hz = t.horizons[h.key];
                      return (
                        <td key={h.key} className="px-2 py-2 text-right font-mono tabular-nums">
                          {hz ? (
                            <span>
                              <b style={{ color: edgeColor(hz.avgEdge) }}>{pct(hz.avgEdge)}</b>
                              <span className="text-[var(--text-4)]"> · {hz.hitRate == null ? "—" : `${Math.round(hz.hitRate * 100)}%`}</span>
                              <span className="text-[10px] text-[var(--text-4)]"> n{hz.n}</span>
                            </span>
                          ) : (
                            <span className="text-[var(--text-4)]" title="No tagged entries have reached this horizon yet">accruing…</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
