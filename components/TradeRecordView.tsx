"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { TradeRec } from "@/lib/tradeLog";
import { summarize, markToIntrinsic, dollarPnl, contractsFor, PLAY_NOTIONAL, driftBreach, costCurve, spreadCostPct } from "@/lib/tradeLog";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const money = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(d)}`);
// Notional-dollar amounts (P&L per $100k position) — always signed, whole dollars, thousands-separated.
const bigMoney = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const NOTIONAL_K = `$${PLAY_NOTIONAL / 1000}k`;
const signPct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const GREEN = "#22c55e", RED = "#ef4444";

type StatusF = "all" | "preprint" | "settled";
type VerdictF = "all" | "rich" | "cheap";
type SortKey = "recent" | "play" | "pnl" | "implied" | "realized";

export default function TradeRecordView({
  universe, recs: allRecs, prices, generatedAt, intl,
}: {
  universe: string;
  recs: TradeRec[];
  prices: Record<string, number>;
  generatedAt: string;
  intl: boolean;
}) {
  const [statusF, setStatusF] = useState<StatusF>("all");
  const [verdictF, setVerdictF] = useState<VerdictF>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [q, setQ] = useState("");

  // fullStats drives the always-on sell/buy comparison; viewStats retitles the headline to the
  // active verdict filter, so clicking "Sell" shows the sell-only book (the scalable strategy).
  const stats = useMemo(() => summarize(allRecs), [allRecs]);
  const viewStats = useMemo(
    () => (verdictF === "all" ? stats : summarize(allRecs.filter((r) => r.verdict === verdictF))),
    [allRecs, verdictF, stats],
  );
  // The scaling curve: sell-book P&L as the assumed spread-crossing worsens. The mid-price record is
  // the ceiling — the first-night capture measured ~45% credit crossing, where the edge shrinks ~6×.
  const curve = useMemo(() => costCurve(allRecs), [allRecs]);

  const recs = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const get: Record<Exclude<SortKey, "play">, (r: TradeRec) => number> = {
      recent: (r) => Date.parse(r.earningsDate) || 0,
      // Sort on the same dollar-notional basis the column displays, not raw per-share
      pnl: (r) => (r.pnl != null ? dollarPnl(r.pnl, r.spotAtRec) ?? -Infinity : -Infinity),
      implied: (r) => r.impliedMovePct,
      realized: (r) => (r.realizedMovePct != null ? Math.abs(r.realizedMovePct) : -1),
    };
    return allRecs
      .filter((r) => {
        if (statusF === "preprint" && r.status !== "awaiting_print") return false;
        if (statusF === "settled" && r.status !== "settled") return false;
        if (verdictF !== "all" && r.verdict !== verdictF) return false;
        if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      // "play" groups by structure (strangles with strangles, condors with condors), newest print
      // first inside each group — how the P&L attribution by structure actually gets eyeballed.
      .sort((a, b) => (sort === "play" ? a.structure.localeCompare(b.structure) || (Date.parse(b.earningsDate) || 0) - (Date.parse(a.earningsDate) || 0) : get[sort](b) - get[sort](a)));
  }, [allRecs, statusF, verdictF, sort, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const SortTh = ({ k, children, cls = "" }: { k: SortKey; children: React.ReactNode; cls?: string }) => (
    <th className={"px-2 py-2 font-medium " + cls}>
      <button onClick={() => setSort(k)} className={"inline-flex items-center gap-0.5 hover:text-[var(--text)] " + (sort === k ? "text-[var(--text)]" : "")}>
        {children}{sort === k && <span className="text-[9px]">▼</span>}
      </button>
    </th>
  );

  const Stat = ({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) => (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-4)]">{sub}</div>}
    </div>
  );

  const wr = stats.winRate;
  const rich = stats.byVerdict.rich, cheap = stats.byVerdict.cheap;
  // Return on the capital actually tied up (Reg-T floor), where the margin annotation exists —
  // the number a sizing decision needs; notional-basis P&L flatters premium selling.
  const onMargin = useMemo(() => {
    const xs = allRecs.filter((r) => r.status === "settled" && r.retOnMarginPct != null).map((r) => r.retOnMarginPct!);
    return xs.length >= 10 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }, [allRecs]);

  return (
    <main className="mx-auto max-w-[92rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings Play — Track Record</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every night we log the exact option structure the Earnings-prep card would suggest for names about to report — with its expiry and entry premiums — then <b>grade it at the print</b>: the structure is repriced the morning after with the event vol removed, because an earnings play is a bet on the print, not on where the stock drifts weeks later. Every play is sized to <b>{NOTIONAL_K} of underlying</b> so P&amp;Ls compare across a $600 stock and a $50 stock. The honest scorecard of those suggestions. {allRecs.length} plays tracked · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* aggregate scorecard — headline retitles to the active verdict filter */}
      {stats.settledN > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label={verdictF === "all" ? "Graded" : verdictF === "rich" ? "Graded (sell only)" : "Graded (buy only)"} value={`${viewStats.settledN}`} sub={`${viewStats.preprintN} pre-print queued`} />
          <Stat label="Win rate" value={viewStats.winRate == null ? "—" : `${(viewStats.winRate * 100).toFixed(0)}%`} color={viewStats.winRate == null ? undefined : viewStats.winRate >= 0.5 ? GREEN : RED} sub={`${viewStats.wins}W · ${viewStats.losses}L · ${viewStats.scratches} scratch`} />
          <Stat label="Avg P&L" value={bigMoney(viewStats.avgPnl)} color={viewStats.avgPnl == null ? undefined : viewStats.avgPnl >= 0 ? GREEN : RED} sub={`per play, ${NOTIONAL_K} notional`} />
          <Stat label="Total P&L" value={bigMoney(viewStats.totalPnl)} color={viewStats.totalPnl >= 0 ? GREEN : RED} sub={`${NOTIONAL_K} notional each`} />
          <Stat label="Sell-premium" value={rich.n ? `${rich.wins}/${rich.n}` : "—"} color={rich.avgPnl == null ? undefined : rich.avgPnl >= 0 ? GREEN : RED} sub={rich.avgPnl == null ? "rich → short" : `avg ${bigMoney(rich.avgPnl)}`} />
          <Stat label="Buy-premium" value={cheap.n ? `${cheap.wins}/${cheap.n}` : "—"} color={cheap.avgPnl == null ? undefined : cheap.avgPnl >= 0 ? GREEN : RED} sub={cheap.avgPnl == null ? "cheap → long" : `avg ${bigMoney(cheap.avgPnl)}`} />
          {onMargin != null && (
            <Stat
              label="On margin"
              value={`${onMargin >= 0 ? "+" : ""}${onMargin.toFixed(1)}%`}
              color={onMargin >= 0 ? GREEN : RED}
              sub="avg per play on Reg-T capital"
            />
          )}
        </div>
      )}

      {/* scaling curve — the sell book's P&L as fills worsen. The single most important number for
          "can we scale this": the mid record is the ceiling, not the expectation. */}
      {curve[0]?.n >= 20 && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Does it survive real fills? — sell book, {curve[0].n} graded</span>
            <span className="text-[11px] text-[var(--text-4)]">crossing the spread forfeits a slice of every credit; the mid-price record is the ceiling</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {curve.map((p, i) => (
              <div key={p.crossPct} className={"rounded-lg border px-3 py-2 " + (p.total >= 0 ? "border-[var(--border)]" : "border-[#ef4444]/50")}>
                <div className="text-[11px] text-[var(--text-4)]">
                  {p.crossPct === 0 ? "Mid price" : `Cross ${p.crossPct}%`}
                  {p.crossPct === 45 && <span className="ml-1 text-[#f59e0b]" title="The gap the first-night leg bid/ask capture actually measured">◂ measured</span>}
                </div>
                <div className="font-mono text-lg font-semibold tabular-nums" style={{ color: p.total >= 0 ? GREEN : RED }}>{bigMoney(p.total)}</div>
                <div className="text-[11px] text-[var(--text-4)]">{bigMoney(p.avgPnl)}/play · {(p.winRate * 100).toFixed(0)}% up</div>
                {i > 0 && curve[0].total > 0 && (
                  <div className="text-[10px] text-[var(--text-4)]">{(100 * p.total / curve[0].total).toFixed(0)}% of mid</div>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-4)]">
            Modeled: the crossing % is forfeited off each play&apos;s entry credit (a short fills below mid). The edge is real but lives largely inside the bid-ask — scaling it profitably is an execution problem (patient limit orders, liquid chains), not a matter of finding more plays.
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span><b className="text-[var(--text-2)]">Entry</b> = net premium at the logged mid, per share · <span style={{ color: GREEN }}>+ credit</span> (sell) · <span style={{ color: RED }}>− debit</span> (buy)</span>
        <span><b className="text-[var(--text-2)]">P&L</b> = graded at the post-print (repriced the morning after, event vol stripped out), <b className="text-[var(--text-2)]">normalized to a {NOTIONAL_K} position</b> in each underlying — so a $600 stock and a $50 stock weigh the same (per-contract dollars don&apos;t compare across prices)</span>
        <span><b className="text-[var(--text-2)]">Cleared ✓</b> = the realized move exceeded what options priced (a premium-buyer&apos;s win)</span>
        <span><b className="text-[#f59e0b]">⚠ Catalyst</b> = a disclosed strategic-alternatives / spin-off event was live when logged — elevated IV may be pricing the KNOWN event, not a vol mispricing; judge a sell-premium read accordingly</span>
        <span><b className="text-[var(--text-2)]">Pre-print</b> plays are logged &amp; awaiting their report — the live queue, shown with entry premiums.</span>
        <span><b className="text-[#ef4444]">spread −N%</b> = crossing this chain&apos;s bid-ask would forfeit N% of the mid credit (captured after hours = worst-case). Flagged at ≥50%: the mid credit that grades the play won&apos;t survive real fills — where the modeled ~45% cost leak actually lives, name by name. The <b className="text-[var(--text-2)]">crossed</b> figure under Entry is that worse fill.</span>
      </div>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setStatusF("all")} className={TB(statusF === "all")}>All</button>
          <button onClick={() => setStatusF("preprint")} className={TB(statusF === "preprint")} title="Logged and awaiting the print — the live pre-print queue">Pre-print</button>
          <button onClick={() => setStatusF("settled")} className={TB(statusF === "settled")} title="Graded at the post-print">Graded</button>
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setVerdictF("all")} className={TB(verdictF === "all")}>Both</button>
          <button onClick={() => setVerdictF("rich")} className={TB(verdictF === "rich")} title="Options priced the move rich → sell premium">Sell</button>
          <button onClick={() => setVerdictF("cheap")} className={TB(verdictF === "cheap")} title="Options priced the move cheap → buy premium">Buy</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or name…" className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{recs.length} of {allRecs.length}</span>
      </div>

      {intl ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          The earnings track record covers U.S. optionable equities. Switch to a U.S. universe to see it.
        </div>
      ) : allRecs.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          <div className="text-[var(--text-2)]">No plays logged yet.</div>
          <div className="mt-1 text-[13px]">The track record accrues going forward: each night the logger captures the card&apos;s suggested play for names reporting within ~2 weeks — with its expiry and entry premiums — then settles it after the print. Check back once a reporting cycle or two has passed.</div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[1100px] text-left text-[13px]">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
              <tr>
                <th className="px-2 py-2 font-medium">Ticker</th>
                <SortTh k="recent">Report</SortTh>
                <SortTh k="play">Play</SortTh>
                <th className="px-2 py-2 font-medium">Expiry</th>
                <th className="px-2 py-2 text-right font-medium">Entry</th>
                <SortTh k="implied" cls="text-right">Implied ±</SortTh>
                <SortTh k="realized" cls="text-right">Realized</SortTh>
                <SortTh k="pnl" cls="text-right">P&amp;L</SortTh>
                <th className="px-2 py-2 text-center font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recs.map((r) => {
                const isCredit = r.entryCredit >= 0;
                const prov = r.status !== "settled" && r.realizedMovePct != null && prices[r.symbol] != null ? markToIntrinsic(r, prices[r.symbol]) : null;
                const pnl = r.status === "settled" ? r.pnl ?? null : prov; // per-share (canonical)
                const pnlDollar = pnl != null ? dollarPnl(pnl, r.spotAtRec) : null; // per $100k of underlying
                const ctrs = contractsFor(r.spotAtRec);
                const pnlColor = pnl == null ? "var(--text-4)" : pnl >= 0 ? GREEN : RED;
                return (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                    <td className="px-2 py-2">
                      <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                      <div className="max-w-[140px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-[var(--text-2)]">{dateLabel(r.earningsDate)}</td>
                    <td className="px-2 py-2">
                      <span className="font-medium" style={{ color: r.verdict === "rich" ? RED : GREEN }}>{r.structure}</span>
                      {r.catalystFlag && (
                        <span
                          className="ml-1.5 cursor-help rounded bg-[color-mix(in_oklab,#f59e0b_18%,transparent)] px-1 py-0.5 align-middle text-[10px] font-semibold text-[#f59e0b]"
                          title={`${r.catalystFlag.kind === "strategic-alt" ? "Strategic alternatives" : "Spin-off"} disclosed ${r.catalystFlag.date}: ${r.catalystFlag.headline} — elevated IV may be pricing this known event, not a vol mispricing`}
                        >
                          ⚠ CATALYST
                        </span>
                      )}
                      {r.riskFlags?.includes("thin-credit") && (
                        <span
                          className="ml-1.5 cursor-help rounded bg-[color-mix(in_oklab,#f59e0b_14%,transparent)] px-1 py-0.5 align-middle text-[10px] font-semibold text-[#d97706]"
                          title="Thin credit: the premium collected is under 1.5% of the share price. Measured on this book's first 206 settled sells: such plays averaged $185 vs the $1,468 book average while carrying 3 of the 12 worst losses — risk without pay."
                        >
                          thin credit
                        </span>
                      )}
                      {r.riskFlags?.includes("wide-spread") && (() => {
                        const sc = spreadCostPct(r);
                        return (
                          <span
                            className="ml-1.5 cursor-help rounded bg-[color-mix(in_oklab,#ef4444_14%,transparent)] px-1 py-0.5 align-middle text-[10px] font-semibold text-[#ef4444]"
                            title={`Wide chain: crossing the bid-ask would forfeit ${sc != null ? Math.round(sc * 100) + "%" : "over half"} of the mid credit (captured after hours, so a worst-case/relative read). The mid credit that grades this play won't survive real fills — the edge lives inside this spread.`}
                          >
                            {sc != null ? `spread −${Math.round(sc * 100)}%` : "wide spread"}
                          </span>
                        );
                      })()}
                      {r.riskFlags?.includes("implied<hist-max") && (
                        <span
                          className="ml-1.5 cursor-help rounded bg-[var(--surface-2)] px-1 py-0.5 align-middle text-[10px] font-medium text-[var(--text-4)]"
                          title={`Selling an implied move below this name's own largest historical earnings move${r.histMaxPct != null ? ` (±${r.histMaxPct.toFixed(1)}%)` : ""} — the stock has already demonstrated it can clear these strikes. Logged as context; not yet a measured predictor.`}
                        >
                          &lt;hist max
                        </span>
                      )}
                      <div className="max-w-[280px] truncate text-[11px] text-[var(--text-4)]" title={r.legsText}>{r.legsText}</div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono text-[12px] text-[var(--text-3)]">{r.expiry}<span className="text-[var(--text-4)]"> · {r.dte}d</span></td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: isCredit ? GREEN : RED }} title={isCredit ? "credit received (mid)" : "debit paid (mid)"}>
                      {isCredit ? "+" : "−"}${Math.abs(r.entryCredit).toFixed(2)}
                      {r.entryCreditCrossed != null && (
                        <div
                          className="cursor-help text-[10px] text-[var(--text-4)]"
                          title="What the position fills for if you cross the bid-ask (shorts sell the bid, longs pay the ask) — captured after hours, so a worst-case read. The gap to the mid above is the strategy's first, guaranteed cost."
                        >
                          {r.entryCreditCrossed >= 0 ? "+" : "−"}${Math.abs(r.entryCreditCrossed).toFixed(2)} crossed
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">±{r.impliedMovePct.toFixed(1)}%</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {r.realizedMovePct == null ? <span className="text-[var(--text-4)]">—</span> : (
                        <span style={{ color: r.realizedMovePct >= 0 ? GREEN : RED }}>
                          {signPct(r.realizedMovePct)}{r.moveCleared ? <span title="cleared the implied move" className="ml-0.5 text-[var(--text-3)]">✓</span> : null}
                        </span>
                      )}
                      {(() => {
                        const db = driftBreach(r);
                        if (r.driftMovePct == null || Math.abs(r.driftMovePct) < r.impliedMovePct / 2) return null;
                        const breached = !!db?.breached;
                        return (
                          <div
                            className="cursor-help text-[10px]"
                            style={{ color: breached ? "#f59e0b" : "var(--text-4)" }}
                            title={`The stock drifted ${signPct(r.driftMovePct)} between logging and the print — the strikes were set ${r.gapDays != null ? r.gapDays + " day(s) " : ""}before the event, so this move hit the position before earnings did (the realized figure above is the print alone).${breached ? ` That's ${db!.ratio}× the implied move — the short strikes were breached going in. Context, not a filter: a walk-forward test showed drift breaches don't reliably predict P&L (the in-sample loss is almost entirely one name).` : ""}`}
                          >
                            drift {signPct(r.driftMovePct)}{breached ? ` · ${db!.ratio}× breach` : ""}
                          </div>
                        );
                      })()}
                    </td>
                    <td
                      className="px-2 py-2 text-right font-mono tabular-nums"
                      style={{ color: pnlColor, opacity: r.status === "settled" ? 1 : 0.6 }}
                      title={(r.status === "settled"
                        ? `${r.settleBasis === "post-print" ? "graded at the post-print" : "graded at expiry"}${r.pnlToExpiry != null && r.settleBasis === "post-print" ? ` · held to expiry: ${r.pnlToExpiry != null ? bigMoney(dollarPnl(r.pnlToExpiry, r.spotAtRec)) : "—"} (${money(r.pnlToExpiry)}/sh)` : ""}`
                        : prov != null ? "provisional mark at the current price (intrinsic only)" : "logged — awaiting the print")
                        + (pnl != null ? ` · ${money(pnl)}/share × ≈${ctrs != null ? Math.round(ctrs * 100).toLocaleString("en-US") : "—"} shares (≈${ctrs != null ? ctrs.toFixed(1) : "—"} contracts — ${NOTIONAL_K} of stock at $${r.spotAtRec.toFixed(0)})` : "")}
                    >
                      {pnlDollar == null ? "—" : bigMoney(pnlDollar)}
                    </td>
                    <td className="px-2 py-2 text-center whitespace-nowrap">
                      {r.status === "settled" && r.outcome ? (
                        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: r.outcome === "win" ? "color-mix(in oklab, #22c55e 20%, transparent)" : r.outcome === "loss" ? "color-mix(in oklab, #ef4444 20%, transparent)" : "var(--surface-2)", color: r.outcome === "win" ? GREEN : r.outcome === "loss" ? RED : "var(--text-3)" }} title={r.settleBasis === "post-print" ? "graded at the post-print" : "graded at expiry (legacy)"}>
                          {r.outcome.toUpperCase()}
                        </span>
                      ) : (
                        <span className="rounded bg-[color-mix(in_oklab,#f59e0b_18%,transparent)] px-1.5 py-0.5 text-[11px] font-medium text-[#f59e0b]">{r.status === "awaiting_print" ? "PRE-PRINT" : "awaiting"}</span>
                      )}
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
