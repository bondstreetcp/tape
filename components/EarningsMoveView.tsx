"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { EarningsMoveRow } from "@/lib/earningsMove";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtMarketCap, fmtDateTime } from "@/lib/format";
import { useWatchlist } from "@/lib/watchlist";
import UniverseSwitcher from "./UniverseSwitcher";

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// amber = options pricing MORE than history (rich → seller's edge); teal = LESS (cheap → buyer's edge)
function richColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-4)";
  if (v >= 1.25) return "#f59e0b";
  if (v >= 1.1) return "#fbbf24";
  if (v <= 0.8) return "#2dd4bf";
  if (v <= 0.9) return "#5eead4";
  return "var(--text-2)";
}

type SortKey = "soon" | "rich" | "implied" | "hist" | "iv" | "mktcap" | "price";
type Regime = "all" | "rich" | "cheap";

export default function EarningsMoveView({
  universe, rows: allRows, generatedAt, source, windowDays, intl,
}: {
  universe: string;
  rows: EarningsMoveRow[];
  generatedAt: string;
  source: string;
  windowDays: number;
  intl: boolean;
}) {
  const { has, toggle } = useWatchlist();
  const [sort, setSort] = useState<SortKey>("soon");
  const [regime, setRegime] = useState<Regime>("all");
  const [histOnly, setHistOnly] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const get: Record<SortKey, (r: EarningsMoveRow) => number> = {
      soon: (r) => -r.daysToEarnings, // soonest first
      rich: (r) => r.richness ?? -1,
      implied: (r) => r.impliedMovePct,
      hist: (r) => r.histAvgMovePct ?? -1,
      iv: (r) => r.impliedIV ?? -1,
      mktcap: (r) => r.marketCap,
      price: (r) => r.price,
    };
    return allRows
      .filter((r) => {
        if (regime === "rich" && !(r.richness != null && r.richness >= 1.15)) return false;
        if (regime === "cheap" && !(r.richness != null && r.richness <= 0.9)) return false;
        if (histOnly && r.histAvgMovePct == null) return false;
        if (watchOnly && !has(r.symbol)) return false;
        if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => get[sort](b) - get[sort](a));
  }, [allRows, regime, histOnly, watchOnly, q, sort, has]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const SortTh = ({ k, children, cls = "" }: { k: SortKey; children: React.ReactNode; cls?: string }) => (
    <th className={"px-2 py-2 font-medium " + cls}>
      <button onClick={() => setSort(k)} className={"inline-flex items-center gap-0.5 hover:text-[var(--text)] " + (sort === k ? "text-[var(--text)]" : "")}>
        {children}{sort === k && <span className="text-[9px]">▼</span>}
      </button>
    </th>
  );

  return (
    <main className="mx-auto max-w-[92rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings Expected-Move Screener</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
            Names reporting within ~{windowDays} days: the ATM straddle priced through the report is the market&apos;s <b>implied move</b>; the average of recent post-earnings reactions is the <b>historical move</b>. Their ratio (richness) flags where options are pricing the event richer or cheaper than the stock has actually moved. {allRows.length} names · {source} · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span><b className="text-[var(--text-2)]">Implied move</b> = ATM straddle ÷ price (the priced ± move)</span>
        <span><b className="text-[var(--text-2)]">Hist</b> = avg of the last several 1-day post-earnings reactions</span>
        <span><b className="text-[var(--text-2)]">Richness</b> = implied ÷ historical · <span className="text-[#f59e0b]">&gt;1 rich</span> (sell premium) · <span className="text-[#2dd4bf]">&lt;1 cheap</span> (buy)</span>
      </div>

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setRegime("all")} className={TB(regime === "all")}>All</button>
          <button onClick={() => setRegime("rich")} className={TB(regime === "rich")} title="Implied ≥ 1.15× historical — options pricing the move richer than it's tended to be">Rich ≥1.15×</button>
          <button onClick={() => setRegime("cheap")} className={TB(regime === "cheap")} title="Implied ≤ 0.9× historical — options pricing the move cheaper than it's tended to be">Cheap ≤0.9×</button>
        </div>
        <button onClick={() => setHistOnly((v) => !v)} className={"rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " + (histOnly ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Only names with enough earnings history to compute a richness ratio">Has history</button>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-3)]"><input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} className="accent-[#fbbf24]" /> ★ Watchlist</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or name…" className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {allRows.length}</span>
      </div>

      {intl ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          The expected-move screen covers U.S. optionable equities. Switch to a U.S. universe to see candidates.
        </div>
      ) : allRows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          No names in this universe report within the next {windowDays} days. Check back closer to earnings season, or switch universes.
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[1040px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-3)]">
                  <th className="w-7 px-2 py-2"></th>
                  <th className="px-2 py-2 font-medium">Ticker</th>
                  <th className="px-2 py-2 font-medium">Company</th>
                  <SortTh k="price" cls="text-right">Price</SortTh>
                  <SortTh k="soon" cls="text-right">Reports</SortTh>
                  <th className="px-2 py-2 text-right font-medium">Exp</th>
                  <SortTh k="implied" cls="text-right">Implied move</SortTh>
                  <SortTh k="iv" cls="text-right">Implied IV</SortTh>
                  <SortTh k="hist" cls="text-right">Hist avg</SortTh>
                  <th className="px-2 py-2 text-right font-medium">Hist max</th>
                  <SortTh k="rich" cls="text-right">Richness</SortTh>
                  <th className="px-2 py-2 text-right font-medium">Implied range</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const lo = r.price * (1 - r.impliedMovePct / 100), hi = r.price * (1 + r.impliedMovePct / 100);
                  return (
                    <tr key={r.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                      <td className="px-2 py-1.5 text-center"><button onClick={() => toggle(r.symbol)} title="Watch" style={{ color: has(r.symbol) ? "#fbbf24" : "var(--border-strong)" }}>★</button></td>
                      <td className="px-2 py-1.5"><Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=options`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                      <td className="max-w-[14rem] truncate px-2 py-1.5"><span className="text-[var(--text-2)]">{r.name}</span><span className="ml-1.5 text-[10px] text-[var(--text-4)]">{r.sector}</span></td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums text-[var(--text)]">${r.price.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums" title={r.earningsEstimate ? "Estimated date" : "Confirmed date"}>
                        <span className={r.earningsEstimate ? "underline decoration-dotted decoration-[var(--text-4)] underline-offset-2 text-[var(--text-2)]" : "text-[var(--text-2)]"}>{dateLabel(r.earningsDate)}</span>
                        <span className="ml-1 text-[10px] text-[var(--text-4)]">{r.daysToEarnings === 0 ? "today" : `${r.daysToEarnings}d`}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{dateLabel(r.expiry + "T00:00:00Z")}<span className="ml-1 text-[10px] text-[var(--text-4)]">{r.dte}d</span></td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-[var(--text)]">±{pct(r.impliedMovePct)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{r.impliedIV != null ? `${(r.impliedIV * 100).toFixed(0)}%` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]" title={r.histN ? `mean of ${r.histN} reactions` : ""}>{r.histAvgMovePct != null ? `±${pct(r.histAvgMovePct)}` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{r.histMaxMovePct != null ? `±${pct(r.histMaxMovePct)}` : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: richColor(r.richness) }} title={r.richness != null ? (r.richness >= 1 ? "Options pricing more than the historical move — premium-selling edge" : "Options pricing less than the historical move — long-premium edge") : "Not enough history"}>{r.richness != null ? `${r.richness.toFixed(2)}×` : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">${lo.toFixed(0)}–${hi.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No names match these filters.</div>}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-4)]">
            Implied move = the ATM straddle (call + put) at the first expiry after the report, ÷ price — the market&apos;s priced ± move. Implied IV is backed out of the straddle (≈ straddle ÷ 0.798·S·√T). Historical = the mean absolute one-day close-to-close reaction over the last {`≤8`} earnings dates (SEC 8-K + price). Richness &gt; 1 means options are pricing the event richer than it has historically moved (a premium-selling edge, e.g. iron condor); &lt; 1 the reverse (a long-straddle edge). Straddle prices are end-of-day/indicative; reactions are realized, not predictive. Research screen, not investment advice.
          </p>
        </>
      )}
    </main>
  );
}
