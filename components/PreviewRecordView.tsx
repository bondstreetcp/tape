"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { PreviewRec } from "@/lib/earningsPreviewLog";
import { summarizePreviews, actualDirection } from "@/lib/earningsPreviewLog";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

// earningsDate is an instant (the report datetime) — pin zone + locale so SSR and every viewer agree.
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const GREEN = "#22c55e", RED = "#ef4444";
const hitMark = (h: boolean | null | undefined) =>
  h == null ? <span className="text-[var(--text-4)]">—</span> : h ? <span style={{ color: GREEN }}>✓</span> : <span style={{ color: RED }}>✗</span>;

type StatusF = "all" | "awaiting" | "graded";

export default function PreviewRecordView({
  universe, recs: allRecs, generatedAt, intl,
}: {
  universe: string;
  recs: PreviewRec[];
  generatedAt: string;
  intl: boolean;
}) {
  const [statusF, setStatusF] = useState<StatusF>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null); // expanded rec (qualitative calls)

  const stats = useMemo(() => summarizePreviews(allRecs), [allRecs]);

  const recs = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return allRecs
      .filter((r) => {
        if (statusF === "awaiting" && r.status !== "awaiting_print") return false;
        if (statusF === "graded" && r.status !== "settled") return false;
        if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => Date.parse(b.earningsDate) - Date.parse(a.earningsDate));
  }, [allRecs, statusF, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const Stat = ({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) => (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-4)]">{sub}</div>}
    </div>
  );
  const rate = (hits: number, n: number) => (n ? `${Math.round((hits / n) * 100)}%` : "—");
  const rateColor = (hits: number, n: number) => (n ? (hits / n >= 0.5 ? GREEN : RED) : undefined);

  return (
    <main className="mx-auto max-w-[92rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings Preview — Accuracy Record</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every night the desk commits to its OWN forecast for names about to report — predicted EPS, a beat/miss call vs consensus, and the 1-day reaction direction — logged <b>before the print</b>, then graded by code against the actuals. If the forecasts prove accurate, they have value; this page is the receipt either way. Qualitative calls are recorded for human judgment, never self-graded. {allRecs.length} forecasts tracked · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* accuracy scorecard */}
      {stats.settledN > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Graded" value={`${stats.settledN}`} sub={`${stats.preprintN} awaiting their print`} />
          <Stat label="Beat/miss call" value={rate(stats.dirHits, stats.dirGraded)} color={rateColor(stats.dirHits, stats.dirGraded)} sub={`${stats.dirHits}/${stats.dirGraded} vs consensus`} />
          <Stat label="Reaction call" value={rate(stats.reactionHits, stats.reactionGraded)} color={rateColor(stats.reactionHits, stats.reactionGraded)} sub={`${stats.reactionHits}/${stats.reactionGraded} · flat prints ungraded`} />
          <Stat label="EPS within band" value={rate(stats.epsHits, stats.epsGraded)} color={rateColor(stats.epsHits, stats.epsGraded)} sub="±2c or ±5% of actual" />
          <Stat label="Avg EPS error" value={stats.avgAbsEpsErrPct == null ? "—" : `${stats.avgAbsEpsErrPct.toFixed(1)}%`} sub="|predicted − actual| / |actual|" />
          <Stat label="High-conviction" value={rate(stats.byConfidence.high.dirHits, stats.byConfidence.high.dirGraded)} color={rateColor(stats.byConfidence.high.dirHits, stats.byConfidence.high.dirGraded)} sub={`beat/miss when confidence high (${stats.byConfidence.high.dirGraded})`} />
        </div>
      )}

      <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          <span><b className="text-[var(--text-2)]">Left block</b> = committed the night before the print · <b className="text-[var(--text-2)]">right block</b> = what actually happened, graded by code</span>
          <span><b className="text-[var(--text-2)]">Call</b> = predicted <b>B</b>eat / <b>M</b>iss / <b>I</b>nline vs consensus · <b className="text-[var(--text-2)]">Result</b> = how the print actually landed vs consensus (|surprise| ≤ 0.5% = inline) · <b className="text-[var(--text-2)]">Call ✓</b> grades Call against Result</span>
          <span><b className="text-[var(--text-2)]">EPS ✓</b> = predicted EPS within ±2¢ or ±5% of actual · <b className="text-[var(--text-2)]">Rx ✓</b> = predicted reaction direction vs the realized move (|move| &lt; 0.5% = flat, ungraded)</span>
          <span>Click a row for the qualitative calls — recorded, not auto-graded.</span>
        </div>
        <details className="mt-1.5">
          <summary className="cursor-pointer font-medium text-[var(--text-2)] hover:text-[var(--text)]">How Pred EPS is made</summary>
          <p className="mt-1 max-w-5xl leading-relaxed">
            Pred EPS / the Call are the desk model&apos;s own forecast (a fast LLM pass, not a human and not the Street), generated the night before from one assembled dossier per name: the consensus and its range + analyst count, 30-day estimate revisions, recent rating changes and price targets, valuation and short interest, recent headlines, the company&apos;s <i>own standing guidance quoted verbatim</i>, the desk&apos;s recomputed options/reaction quant signals (implied vs historical print move, IV term structure, skew, post-earnings drift and sell-the-news patterns, guide-beating history, momentum into the print), the prior quarter&apos;s 8-K release excerpt, and the latest earnings-call transcript. Consensus is explicitly an input — the model is instructed to deviate from it only where it can name a reason (recorded as a qualitative call). Forecasts are logged <b>before</b> the print and graded only by code; two guards delete any forecast that could have seen the answer (a print inside the last 10 days at log time, or a filing dated before the forecast at settle time).
          </p>
        </details>
      </div>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setStatusF("all")} className={TB(statusF === "all")}>All</button>
          <button onClick={() => setStatusF("awaiting")} className={TB(statusF === "awaiting")} title="Forecast logged, report not in yet">Awaiting</button>
          <button onClick={() => setStatusF("graded")} className={TB(statusF === "graded")} title="Graded against the actual print">Graded</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or name…" className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{recs.length} of {allRecs.length}</span>
      </div>

      {intl ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          The preview accuracy record covers U.S. names. Switch to a U.S. universe to see it.
        </div>
      ) : allRecs.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          <div className="text-[var(--text-2)]">No forecasts logged yet.</div>
          <div className="mt-1 text-[13px]">The record accrues forward only: each night the desk forecasts the names reporting within a week, then grades itself once they report. Check back after a reporting cycle.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[1120px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              {/* Sam (Jul 24): ex-ante and ex-post were interleaved and two cells fused a call with its
                  grade — unreadable. Two blocks now: what we committed, then what actually happened. */}
              <tr className="border-b border-[var(--border)]/60">
                <th colSpan={7} className="px-2 pb-1 pt-2 text-left font-semibold normal-case text-[var(--text-3)]">Committed before the print</th>
                <th colSpan={7} className="border-l border-[var(--border)] px-2 pb-1 pt-2 text-left font-semibold normal-case text-[var(--text-3)]">Graded against the actuals</th>
              </tr>
              <tr className="border-b border-[var(--border)]">
                <th className="px-2 py-2 font-medium">Ticker</th>
                <th className="px-2 py-2 font-medium">Report</th>
                <th className="px-2 py-2 text-right font-medium" title="the desk model's own EPS forecast — see 'How Pred EPS is made' above">Pred EPS</th>
                <th className="px-2 py-2 text-right font-medium" title="the consensus bar when the forecast was logged">Cons</th>
                <th className="px-2 py-2 text-center font-medium" title="predicted Beat / Miss / Inline vs consensus">Call</th>
                <th className="px-2 py-2 text-center font-medium" title="predicted 1-day reaction direction">Rx</th>
                <th className="px-2 py-2 text-center font-medium">Conf</th>
                <th className="border-l border-[var(--border)] px-2 py-2 text-right font-medium">Actual</th>
                <th className="px-2 py-2 text-center font-medium" title="predicted EPS within ±2c or ±5% of actual">EPS ✓</th>
                <th className="px-2 py-2 text-center font-medium" title="how the print actually landed vs consensus (|surprise| ≤ 0.5% = inline)">Result</th>
                <th className="px-2 py-2 text-center font-medium" title="did the predicted B/M/I call match the result">Call ✓</th>
                <th className="px-2 py-2 text-right font-medium" title="realized 1-day reaction">Move</th>
                <th className="px-2 py-2 text-center font-medium" title="did the predicted direction match the move (flat prints ungraded)">Rx ✓</th>
                <th className="px-2 py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => {
                const expanded = open === r.id;
                const expandable = r.calls.length > 0; // a row with no qualitative calls has nothing to open
                return (
                  <Fragment key={r.id}>
                    <tr className={"border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]" + (expandable ? " cursor-pointer" : "")} onClick={expandable ? () => setOpen(expanded ? null : r.id) : undefined}>
                      <td className="px-2 py-2">
                        <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline" onClick={(e) => e.stopPropagation()}>{r.symbol}</Link>
                        <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-[var(--text-2)]">{dateLabel(r.earningsDate)}</td>
                      {/* ── ex-ante: committed before the print ── */}
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text)]">{r.predEps ?? "—"}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{r.consEps ?? "—"}</td>
                      <td className="px-2 py-2 text-center font-mono text-[12px] uppercase text-[var(--text-2)]">{r.vsConsensus.slice(0, 1)}</td>
                      <td className="px-2 py-2 text-center font-mono text-[12px] text-[var(--text-2)]">{r.reactionDir === "up" ? "↑" : "↓"}</td>
                      <td className="px-2 py-2 text-center text-[11px] text-[var(--text-3)]">{r.confidence}</td>
                      {/* ── ex-post: graded against the actuals ── */}
                      <td className="border-l border-[var(--border)] px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{r.actualEps ?? "—"}</td>
                      <td className="px-2 py-2 text-center" title={r.epsErrPct != null ? `error ${r.epsErrPct}% of actual` : undefined}>{hitMark(r.epsHit)}</td>
                      <td className="px-2 py-2 text-center font-mono text-[12px] uppercase text-[var(--text-2)]">
                        {(() => { const d = actualDirection(r.actualSurprise ?? null); return d ? d.slice(0, 1) : "—"; })()}
                      </td>
                      <td className="px-2 py-2 text-center">{hitMark(r.dirHit)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.actualMovePct == null ? "var(--text-4)" : r.actualMovePct >= 0 ? GREEN : RED }}>
                        {r.actualMovePct == null ? "—" : `${r.actualMovePct >= 0 ? "+" : "−"}${Math.abs(r.actualMovePct).toFixed(1)}%`}
                      </td>
                      <td className="px-2 py-2 text-center">{hitMark(r.reactionHit)}</td>
                      <td className="px-2 py-2 text-center whitespace-nowrap">
                        {r.status === "settled" ? (
                          <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-3)]">GRADED</span>
                        ) : (
                          <span className="rounded bg-[color-mix(in_oklab,#f59e0b_18%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-[#f59e0b]">AWAITING</span>
                        )}
                      </td>
                    </tr>
                    {expanded && r.calls.length > 0 && (
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/60 last:border-0">
                        <td colSpan={14} className="px-4 py-2.5">
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Qualitative calls (recorded, not auto-graded — judge against the report)</div>
                          <ul className="space-y-1 text-[12.5px]">
                            {r.calls.map((c, i) => (
                              <li key={i}><span className="text-[var(--text)]">{c.claim}</span>{c.rationale && <span className="text-[var(--text-4)]"> — {c.rationale}</span>}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
