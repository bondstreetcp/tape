"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { PutWriteCandidate, TenorId } from "@/lib/putwrite";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtMarketCap, fmtDateTime } from "@/lib/format";
import { useWatchlist } from "@/lib/watchlist";
import UniverseSwitcher from "./UniverseSwitcher";

const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const pctFrac = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const expLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });
// next-earnings helpers — the snapshot carries an ISO datetime (frequently Yahoo's estimate)
const earnLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
function earnInfo(iso: string | null | undefined): { t: number; days: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return { t, days: Math.round((t - Date.now()) / 86_400_000) };
}
// true when the next report lands on/before the put's expiry — i.e. you'd hold through the event
function earnsBeforeExpiry(c: PutWriteCandidate, expiry: string | undefined): boolean {
  const ei = earnInfo(c.nextEarnings);
  if (!ei || !expiry || ei.days < 0) return false;
  return ei.t <= Date.parse(expiry + "T23:59:59Z");
}
// table cell: date + days-until, amber ⚠ when it precedes expiry, dotted when the date is estimated
function renderEarn(c: PutWriteCandidate, expiry: string | undefined) {
  const ei = earnInfo(c.nextEarnings);
  if (!ei || ei.days < -7) return <span className="text-[var(--text-4)]">—</span>;
  const reported = ei.days < 0;
  const before = !reported && earnsBeforeExpiry(c, expiry);
  const color = before ? "#f59e0b" : reported ? "var(--text-4)" : "var(--text-3)";
  const title =
    (c.earningsEstimate ? "Estimated date. " : "Confirmed date. ") +
    (reported
      ? `Reported ${-ei.days}d ago — no earnings event before this put expires.`
      : before
        ? `⚠ Reports in ${ei.days}d, before this put expires — you'd hold the position through earnings (gap risk).`
        : `Reports in ${ei.days}d, after this put expires — the trade clears the event.`);
  return (
    <span style={{ color }} className={c.earningsEstimate ? "underline decoration-dotted decoration-[var(--text-4)] underline-offset-2" : ""} title={title}>
      {before && <span className="mr-0.5">⚠</span>}{earnLabel(c.nextEarnings!)}
      <span className="ml-1 text-[10px] text-[var(--text-4)]">{reported ? `${-ei.days}d ago` : `${ei.days}d`}</span>
    </span>
  );
}

// green ramp for the headline annualized yield
function annColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-3)";
  if (v >= 18) return "#16a34a";
  if (v >= 12) return "#22c55e";
  if (v >= 8) return "#4ade80";
  return "var(--text-2)";
}
function rankColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-4)";
  if (v >= 75) return "#f59e0b";
  if (v >= 50) return "#fbbf24";
  return "var(--text-3)";
}

type SortKey = "ann" | "cushion" | "iv" | "vol" | "roe" | "pe" | "yield" | "mktcap" | "price" | "earn";

// Tenor tabs (kept in sync with PUT_TENORS in lib/putwrite; inlined to avoid pulling the fs
// loader into the client bundle). "1M" = the standard ~16Δ CSP; "3M" = lower-delta, further OTM.
const TENOR_TABS: { id: TenorId; label: string; deltaLabel: string; note: string }[] = [
  { id: "m1", label: "1 month", deltaLabel: "16Δ", note: "≈16-delta · 30–45 DTE" },
  { id: "m3", label: "3 month", deltaLabel: "10Δ", note: "≈10-delta · ~3-month · ~15%+ OTM (less beta risk)" },
];

export default function PutWriteView({
  universe, candidates, generatedAt, source, intl, minMktCap,
}: {
  universe: string;
  candidates: PutWriteCandidate[];
  generatedAt: string;
  source: string;
  intl: boolean;
  minMktCap: number;
}) {
  const { has, toggle } = useWatchlist();
  const [minAnn, setMinAnn] = useState(0);
  const [minCushion, setMinCushion] = useState(0);
  const [elevatedOnly, setElevatedOnly] = useState(false);
  const [clearEarnings, setClearEarnings] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("ann");
  const [tenor, setTenor] = useState<TenorId>("m1");

  const put = (c: PutWriteCandidate) => c.puts[tenor]; // the suggestion for the selected tenor
  const tab = TENOR_TABS.find((t) => t.id === tenor)!;
  // current "vol rank" = IV rank once enough history is banked, else realized-vol rank
  const volRank = (c: PutWriteCandidate) => (c.ivRank ?? c.rvolRank);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const get: Record<SortKey, (c: PutWriteCandidate) => number> = {
      ann: (c) => put(c)?.annPct ?? -1,
      yield: (c) => put(c)?.yieldPct ?? -1,
      cushion: (c) => put(c)?.cushionPct ?? -1,
      iv: (c) => c.atmIV ?? -1,
      vol: (c) => volRank(c) ?? -1,
      roe: (c) => c.roe ?? -1,
      pe: (c) => -(c.pe ?? 1e9), // lower P/E first
      mktcap: (c) => c.marketCap,
      price: (c) => c.price ?? -1,
      earn: (c) => {
        const ei = earnInfo(c.nextEarnings);
        if (!ei || ei.days < -7) return -1e9; // null / stale → bottom
        return ei.days >= 0 ? 1e9 - ei.days : ei.days; // upcoming soonest-first, then recently-reported
      },
    };
    return candidates
      .filter((c) => {
        if (minAnn && (put(c)?.annPct ?? 0) < minAnn) return false;
        if (minCushion && (put(c)?.cushionPct ?? 0) < minCushion) return false;
        if (elevatedOnly && (volRank(c) ?? 0) < 50) return false;
        if (clearEarnings && earnsBeforeExpiry(c, put(c)?.expiry)) return false;
        if (watchOnly && !has(c.symbol)) return false;
        if (ql && !c.symbol.toLowerCase().includes(ql) && !c.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => get[sort](b) - get[sort](a));
  }, [candidates, minAnn, minCushion, elevatedOnly, clearEarnings, watchOnly, q, sort, tenor, has]);

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
          <h1 className="mt-1 text-2xl font-bold">Put-Writing Screener</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
            Quality large caps you&apos;d be content to own, where options pay you well to sell the downside. Screened for market cap &gt; {fmtMarketCap(minMktCap)}, ROE &gt; 15%, 0 &lt; P/E &lt; 25; each row shows the put for the selected tenor and its cash-secured return. {candidates.length} names · {source} · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1">
            <span className="text-[11px] text-[var(--text-4)]">Tenor</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
              {TENOR_TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTenor(t.id)}
                  title={t.note}
                  className={"rounded-md px-2.5 py-1 " + (tenor === t.id ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
                >
                  {t.id === "m1" ? "1M" : "3M"} <span className="opacity-60">{t.deltaLabel}</span>
                </button>
              ))}
            </div>
          </div>
          <UniverseSwitcher current={universe} />
        </div>
      </div>

      {/* strategy primer — reflects the selected tenor */}
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span><b className="text-[var(--text-2)]">Strike</b> {tab.deltaLabel} {tenor === "m3" ? "(~15%+ OTM)" : "(~16% chance assigned)"}</span>
        <span><b className="text-[var(--text-2)]">Tenor</b> {tenor === "m1" ? "30–45 DTE" : "~3 months"}</span>
        <span><b className="text-[var(--text-2)]">Style</b> {tenor === "m1" ? "standard cash-secured put" : "lower-delta, longer-dated — less market-beta risk"}</span>
        <span><b className="text-[var(--text-2)]">Vol rank</b> = where current vol sits in its 1-yr range; ≥50 = rich</span>
        <span><b className="text-[var(--text-2)]">Cushion</b> = how far it can fall before assignment</span>
        <span><b className="text-[var(--text-2)]">Earnings</b> <span className="text-[#f59e0b]">⚠</span> = next report lands before the put expires (you&apos;d hold through the event)</span>
      </div>

      {intl ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          Put-writing screens U.S. optionable equities. Switch to a U.S. universe — S&amp;P 500, Nasdaq 100, Russell 1000/3000 — to see candidates.
        </div>
      ) : (
        <>
          {/* filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-4)]">Min ann. yield</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
              {[0, 8, 12, 18].map((v) => (
                <button key={v} onClick={() => setMinAnn(v)} className={TB(minAnn === v)}>{v === 0 ? "All" : `${v}%`}</button>
              ))}
            </div>
            <span className="text-xs text-[var(--text-4)]">Min cushion</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5" title="Keep only puts at least this far out of the money">
              {[0, 10, 15, 20].map((v) => (
                <button key={v} onClick={() => setMinCushion(v)} className={TB(minCushion === v)}>{v === 0 ? "Any" : `${v}%`}</button>
              ))}
            </div>
            <button onClick={() => setElevatedOnly((v) => !v)} className={"rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " + (elevatedOnly ? "border-[#f59e0b] bg-[#f59e0b]/15 text-[#fbbf24]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Keep only names whose volatility rank is in the top half of its 1-year range">
              ⚡ Elevated vol
            </button>
            <button onClick={() => setClearEarnings((v) => !v)} className={"rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " + (clearEarnings ? "border-[#16a34a] bg-[#16a34a]/15 text-[#4ade80]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Hide names whose next earnings report falls before the selected put expires — avoid holding a cash-secured put through an earnings event">
              🛡 Clear of earnings
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-3)]">
              <input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} className="accent-[#fbbf24]" /> ★ Watchlist
            </label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or name…" className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
            {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
            <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {candidates.length}</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-3)]">
                  <th className="w-7 px-2 py-2"></th>
                  <th className="px-2 py-2 font-medium">Ticker</th>
                  <th className="px-2 py-2 font-medium">Company</th>
                  <SortTh k="price" cls="text-right">Price</SortTh>
                  <SortTh k="mktcap" cls="text-right">Mkt cap</SortTh>
                  <SortTh k="roe" cls="text-right">ROE</SortTh>
                  <SortTh k="pe" cls="text-right">P/E</SortTh>
                  <SortTh k="vol" cls="text-right">Vol rank</SortTh>
                  <SortTh k="iv" cls="text-right">ATM IV</SortTh>
                  <th className="px-2 py-2 text-right font-medium">{tab.deltaLabel} put</th>
                  <th className="px-2 py-2 text-right font-medium">Exp</th>
                  <SortTh k="earn" cls="text-right">Earnings</SortTh>
                  <th className="px-2 py-2 text-right font-medium">Premium</th>
                  <SortTh k="ann" cls="text-right">Ann. yield</SortTh>
                  <SortTh k="cushion" cls="text-right">Cushion</SortTh>
                  <th className="px-2 py-2 text-right font-medium">Breakeven</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const vr = volRank(c);
                  const p = put(c);
                  return (
                    <tr key={c.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => toggle(c.symbol)} title="Watch" style={{ color: has(c.symbol) ? "#fbbf24" : "var(--border-strong)" }}>★</button>
                      </td>
                      <td className="px-2 py-1.5">
                        <Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{c.symbol}</Link>
                      </td>
                      <td className="max-w-[15rem] truncate px-2 py-1.5">
                        <span className="text-[var(--text-2)]">{c.name}</span>
                        <span className="ml-1.5 text-[10px] text-[var(--text-4)]">{c.sector}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums text-[var(--text)]">{c.price != null ? `$${c.price.toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{fmtMarketCap(c.marketCap)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{pctFrac(c.roe)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{c.pe != null ? c.pe.toFixed(1) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: rankColor(vr) }} title={c.ivRank != null ? "IV percentile (1y)" : "Realized-vol percentile (1y) — IV rank accrues over time"}>
                        {vr != null ? vr + (c.ivRank != null ? "" : "ʳ") : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{pctFrac(c.atmIV)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {p ? <Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}?tab=options`} title="Open the live chain & strategy lab" className="text-[var(--text)] underline decoration-dotted decoration-[var(--text-4)] underline-offset-2 hover:text-[var(--accent)]">${p.strike}<span className="ml-1 text-[10px] text-[var(--text-4)]">Δ{p.delta.toFixed(2)}</span></Link> : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{p ? <>{expLabel(p.expiry)}<span className="ml-1 text-[10px] text-[var(--text-4)]">{p.dte}d</span></> : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{renderEarn(c, p?.expiry)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]" title={p?.premiumSrc === "last" ? "last trade (market closed)" : "bid/ask mid"}>{p ? `$${p.premium.toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: annColor(p?.annPct) }} title={p ? `${p.yieldPct}% over ${p.dte} days` : ""}>{p ? pct(p.annPct) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{p ? pct(p.cushionPct) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{p ? `$${p.breakeven.toFixed(2)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No names match these filters.</div>}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-4)]">
            Premiums are end-of-day last (or bid/ask mid during market hours) — indicative, not a live fill; confirm on the chain before trading. Strike/delta/IV are Black-Scholes estimates (implied vol solved from the premium, since vendor IV fields are unreliable; dividends approximated). &quot;Vol rank&quot; superscript ʳ = realized-volatility percentile (the proxy shown until ~30 days of IV history accrue, after which it switches to IV percentile). Next-earnings dates are from the data vendor and may be estimates (dotted underline) until confirmed; ⚠ flags a report due before the selected put expires. This is a research screen, not investment advice.
          </p>
        </>
      )}
    </main>
  );
}
