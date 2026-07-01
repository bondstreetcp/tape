"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { TradeRec } from "@/lib/tradeLog";
import { summarize, markToIntrinsic } from "@/lib/tradeLog";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const money = (v: number | null | undefined, d = 2) => (v == null ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(d)}`);
const signPct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}%`);
const GREEN = "#22c55e", RED = "#ef4444";

type StatusF = "all" | "open" | "settled";
type VerdictF = "all" | "rich" | "cheap";
type SortKey = "recent" | "pnl" | "implied" | "realized";

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

  const stats = useMemo(() => summarize(allRecs), [allRecs]);

  const recs = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const get: Record<SortKey, (r: TradeRec) => number> = {
      recent: (r) => Date.parse(r.earningsDate) || 0,
      pnl: (r) => r.pnl ?? -Infinity,
      implied: (r) => r.impliedMovePct,
      realized: (r) => (r.realizedMovePct != null ? Math.abs(r.realizedMovePct) : -1),
    };
    return allRecs
      .filter((r) => {
        if (statusF === "open" && r.status === "settled") return false;
        if (statusF === "settled" && r.status !== "settled") return false;
        if (verdictF !== "all" && r.verdict !== verdictF) return false;
        if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => get[sort](b) - get[sort](a));
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

  return (
    <main className="mx-auto max-w-[92rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings Play — Track Record</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every night we log the exact option structure the Earnings-prep card would suggest for names about to report — with its expiry and entry premiums — then settle it after the print and again at expiry. This is the honest scorecard of those suggestions. {allRecs.length} plays tracked · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* aggregate scorecard */}
      {stats.settledN > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Settled" value={`${stats.settledN}`} sub={`${stats.openN} still open`} />
          <Stat label="Win rate" value={wr == null ? "—" : `${(wr * 100).toFixed(0)}%`} color={wr == null ? undefined : wr >= 0.5 ? GREEN : RED} sub={`${stats.wins}W · ${stats.losses}L · ${stats.scratches} scratch`} />
          <Stat label="Avg P&L" value={money(stats.avgPnl)} color={stats.avgPnl == null ? undefined : stats.avgPnl >= 0 ? GREEN : RED} sub="per share (×100 / contract)" />
          <Stat label="Total P&L" value={money(stats.totalPnl)} color={stats.totalPnl >= 0 ? GREEN : RED} sub="1 lot each, per share" />
          <Stat label="Sell-premium" value={rich.n ? `${rich.wins}/${rich.n}` : "—"} color={rich.avgPnl == null ? undefined : rich.avgPnl >= 0 ? GREEN : RED} sub={rich.avgPnl == null ? "rich → short" : `avg ${money(rich.avgPnl)}`} />
          <Stat label="Buy-premium" value={cheap.n ? `${cheap.wins}/${cheap.n}` : "—"} color={cheap.avgPnl == null ? undefined : cheap.avgPnl >= 0 ? GREEN : RED} sub={cheap.avgPnl == null ? "cheap → long" : `avg ${money(cheap.avgPnl)}`} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span><b className="text-[var(--text-2)]">Entry</b> = net premium at the logged mid · <span style={{ color: GREEN }}>+ credit</span> (sell) · <span style={{ color: RED }}>− debit</span> (buy)</span>
        <span><b className="text-[var(--text-2)]">P&L</b> = per share held to expiry (options settle to intrinsic) · ×100 per contract</span>
        <span><b className="text-[var(--text-2)]">Cleared ✓</b> = the realized move exceeded what options priced (a premium-buyer&apos;s win)</span>
        <span>Provisional marks (open plays past the print) are dimmed.</span>
      </div>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setStatusF("all")} className={TB(statusF === "all")}>All</button>
          <button onClick={() => setStatusF("open")} className={TB(statusF === "open")} title="Logged but not yet settled at expiry">Open</button>
          <button onClick={() => setStatusF("settled")} className={TB(statusF === "settled")} title="Held to expiry and scored">Settled</button>
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
                <th className="px-2 py-2 font-medium">Play</th>
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
                const pnl = r.status === "settled" ? r.pnl ?? null : prov;
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
                      <div className="max-w-[280px] truncate text-[11px] text-[var(--text-4)]" title={r.legsText}>{r.legsText}</div>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono text-[12px] text-[var(--text-3)]">{r.expiry}<span className="text-[var(--text-4)]"> · {r.dte}d</span></td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: isCredit ? GREEN : RED }} title={isCredit ? "credit received" : "debit paid"}>{isCredit ? "+" : "−"}${Math.abs(r.entryCredit).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">±{r.impliedMovePct.toFixed(1)}%</td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {r.realizedMovePct == null ? <span className="text-[var(--text-4)]">—</span> : (
                        <span style={{ color: r.realizedMovePct >= 0 ? GREEN : RED }}>
                          {signPct(r.realizedMovePct)}{r.moveCleared ? <span title="cleared the implied move" className="ml-0.5 text-[var(--text-3)]">✓</span> : null}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: pnlColor, opacity: r.status === "settled" ? 1 : 0.6 }} title={r.status === "settled" ? "P&L held to expiry" : prov != null ? "provisional mark at the current price (intrinsic only)" : ""}>
                      {pnl == null ? "—" : `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`}
                    </td>
                    <td className="px-2 py-2 text-center whitespace-nowrap">
                      {r.status === "settled" && r.outcome ? (
                        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: r.outcome === "win" ? "color-mix(in oklab, #22c55e 20%, transparent)" : r.outcome === "loss" ? "color-mix(in oklab, #ef4444 20%, transparent)" : "var(--surface-2)", color: r.outcome === "win" ? GREEN : r.outcome === "loss" ? RED : "var(--text-3)" }}>
                          {r.outcome.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--text-4)]">{r.status === "awaiting_print" ? "awaiting print" : "awaiting expiry"}</span>
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
