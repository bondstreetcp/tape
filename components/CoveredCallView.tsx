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

// next-earnings helpers — for a covered call, a report before expiry can gap the stock THROUGH the
// strike (you'd be called away, capping a winner) or down (your premium cushion is thin).
const earnLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
function earnInfo(iso: string | null | undefined): { t: number; days: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return { t, days: Math.round((t - Date.now()) / 86_400_000) };
}
function earnsBeforeExpiry(c: PutWriteCandidate, expiry: string | undefined): boolean {
  const ei = earnInfo(c.nextEarnings);
  if (!ei || !expiry || ei.days < 0) return false;
  return ei.t <= Date.parse(expiry + "T23:59:59Z");
}
function renderEarn(c: PutWriteCandidate, expiry: string | undefined) {
  const ei = earnInfo(c.nextEarnings);
  if (!ei || ei.days < -7) return <span className="text-[var(--text-4)]">—</span>;
  const reported = ei.days < 0;
  const before = !reported && earnsBeforeExpiry(c, expiry);
  const color = before ? "#f59e0b" : reported ? "var(--text-4)" : "var(--text-3)";
  const title =
    (c.earningsEstimate ? "Estimated date. " : "Confirmed date. ") +
    (reported
      ? `Reported ${-ei.days}d ago — no earnings event before this call expires.`
      : before
        ? `⚠ Reports in ${ei.days}d, before this call expires — an earnings gap could call away a winner or eat the premium cushion.`
        : `Reports in ${ei.days}d, after this call expires — the trade clears the event.`);
  return (
    <span style={{ color }} className={c.earningsEstimate ? "underline decoration-dotted decoration-[var(--text-4)] underline-offset-2" : ""} title={title}>
      {before && <span className="mr-0.5">⚠</span>}{earnLabel(c.nextEarnings!)}
      <span className="ml-1 text-[10px] text-[var(--text-4)]">{reported ? `${-ei.days}d ago` : `${ei.days}d`}</span>
    </span>
  );
}

// green ramp for the headline static (income) yield
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

type SortKey = "static" | "ifcalled" | "cap" | "iv" | "vol" | "roe" | "pe" | "mktcap" | "price" | "earn";

const TENOR_TABS: { id: TenorId; deltaLabel: string; note: string }[] = [
  { id: "m1", deltaLabel: "30Δ", note: "≈30-delta · 30–45 DTE · the standard buy-write" },
  { id: "m3", deltaLabel: "20Δ", note: "≈20-delta · ~3-month · further OTM, more upside room" },
];

export default function CoveredCallView({
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
  const [minStatic, setMinStatic] = useState(0);
  const [minCap, setMinCap] = useState(0);
  const [elevatedOnly, setElevatedOnly] = useState(false);
  const [clearEarnings, setClearEarnings] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("static");
  const [tenor, setTenor] = useState<TenorId>("m1");

  const call = (c: PutWriteCandidate) => c.calls?.[tenor] ?? null; // the call for the selected tenor (guard older snapshots)
  const tab = TENOR_TABS.find((t) => t.id === tenor)!;
  const volRank = (c: PutWriteCandidate) => (c.ivRank ?? c.rvolRank);

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const get: Record<SortKey, (c: PutWriteCandidate) => number> = {
      static: (c) => call(c)?.annPct ?? -1,
      ifcalled: (c) => call(c)?.ifCalledPct ?? -1,
      cap: (c) => call(c)?.capPct ?? -1,
      iv: (c) => c.atmIV ?? -1,
      vol: (c) => volRank(c) ?? -1,
      roe: (c) => c.roe ?? -1,
      pe: (c) => -(c.pe ?? 1e9),
      mktcap: (c) => c.marketCap,
      price: (c) => c.price ?? -1,
      earn: (c) => {
        const ei = earnInfo(c.nextEarnings);
        if (!ei || ei.days < -7) return -1e9;
        return ei.days >= 0 ? 1e9 - ei.days : ei.days;
      },
    };
    return candidates
      .filter((c) => {
        if (minStatic && (call(c)?.annPct ?? 0) < minStatic) return false;
        if (minCap && (call(c)?.capPct ?? 0) < minCap) return false;
        if (elevatedOnly && (volRank(c) ?? 0) < 50) return false;
        if (clearEarnings && earnsBeforeExpiry(c, call(c)?.expiry)) return false;
        if (watchOnly && !has(c.symbol)) return false;
        if (ql && !c.symbol.toLowerCase().includes(ql) && !c.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => get[sort](b) - get[sort](a));
  }, [candidates, minStatic, minCap, elevatedOnly, clearEarnings, watchOnly, q, sort, tenor, has]);

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
          <h1 className="mt-1 text-2xl font-bold">Covered-Call Screener</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
            Quality names you&apos;d be content to hold, where selling an out-of-the-money call pays you to cap some upside. Screened for market cap &gt; {fmtMarketCap(minMktCap)}, ROE &gt; 15%, 0 &lt; P/E &lt; 25; each row shows the call for the selected tenor, its income (static) yield and the total return if the shares get called away. {candidates.length} names · {source} · as of {fmtDateTime(generatedAt)}
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

      {/* strategy primer */}
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span><b className="text-[var(--text-2)]">Strike</b> {tab.deltaLabel} OTM call {tenor === "m3" ? "(~more room)" : "(~30% chance called)"}</span>
        <span><b className="text-[var(--text-2)]">Static yield</b> = premium income if the stock stays below the strike</span>
        <span><b className="text-[var(--text-2)]">If-called</b> = total return if assigned (premium + gain to the strike)</span>
        <span><b className="text-[var(--text-2)]">Cap</b> = upside room before your shares are called away</span>
        <span><b className="text-[var(--text-2)]">Earnings</b> <span className="text-[#f59e0b]">⚠</span> = report lands before the call expires</span>
      </div>

      {intl ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          Covered-call screens U.S. optionable equities. Switch to a U.S. universe — S&amp;P 500, Nasdaq 100, Russell 1000/3000 — to see candidates.
        </div>
      ) : (
        <>
          {/* filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-4)]">Min income yield</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
              {[0, 8, 12, 18].map((v) => (
                <button key={v} onClick={() => setMinStatic(v)} className={TB(minStatic === v)}>{v === 0 ? "All" : `${v}%`}</button>
              ))}
            </div>
            <span className="text-xs text-[var(--text-4)]">Min upside cap</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5" title="Keep only calls leaving at least this much room before the shares are capped">
              {[0, 5, 10, 15].map((v) => (
                <button key={v} onClick={() => setMinCap(v)} className={TB(minCap === v)}>{v === 0 ? "Any" : `${v}%`}</button>
              ))}
            </div>
            <button onClick={() => setElevatedOnly((v) => !v)} className={"rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " + (elevatedOnly ? "border-[#f59e0b] bg-[#f59e0b]/15 text-[#fbbf24]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Keep only names whose volatility rank is in the top half of its 1-year range">
              ⚡ Elevated vol
            </button>
            <button onClick={() => setClearEarnings((v) => !v)} className={"rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " + (clearEarnings ? "border-[#16a34a] bg-[#16a34a]/15 text-[#4ade80]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Hide names whose next earnings report falls before the selected call expires">
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
                  <th className="px-2 py-2 text-right font-medium">{tab.deltaLabel} call</th>
                  <th className="px-2 py-2 text-right font-medium">Exp</th>
                  <SortTh k="earn" cls="text-right">Earnings</SortTh>
                  <th className="px-2 py-2 text-right font-medium">Premium</th>
                  <SortTh k="static" cls="text-right">Income yield</SortTh>
                  <SortTh k="ifcalled" cls="text-right">If-called</SortTh>
                  <SortTh k="cap" cls="text-right">Upside cap</SortTh>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const vr = volRank(c);
                  const k = call(c);
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
                        {k ? <Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}?tab=options`} title="Open the live chain & strategy lab" className="text-[var(--text)] underline decoration-dotted decoration-[var(--text-4)] underline-offset-2 hover:text-[var(--accent)]">${k.strike}<span className="ml-1 text-[10px] text-[var(--text-4)]">Δ{k.delta.toFixed(2)}</span></Link> : "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{k ? <>{expLabel(k.expiry)}<span className="ml-1 text-[10px] text-[var(--text-4)]">{k.dte}d</span></> : "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{renderEarn(c, k?.expiry)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]" title={k?.premiumSrc === "last" ? "last trade (market closed)" : "bid/ask mid"}>{k ? `$${k.premium.toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: annColor(k?.annPct) }} title={k ? `${k.yieldPct}% over ${k.dte} days, annualized` : ""}>{k ? pct(k.annPct) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]" title={k ? `Total return to expiry (premium + capital gain to the $${k.strike} strike) if the shares are called away — a one-time, ${k.dte}-day return, not annualized` : ""}>{k ? pct(k.ifCalledPct) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{k ? pct(k.capPct) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No names match these filters.</div>}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-4)]">
            Assumes you hold (or buy) 100 shares per contract. Income yield = premium ÷ share price, annualized (a repeatable premium you collect each cycle if the stock stays below the strike); if-called = (premium + capital gain to the strike) ÷ share price, the one-time total return to expiry if assigned; cap = room to the strike. Premiums are end-of-day last (or bid/ask mid during market hours) — indicative, not a live fill. Strike/delta/IV are Black-Scholes estimates (implied vol solved from the premium). Next-earnings dates may be estimates; ⚠ flags a report before the selected call expires. Research screen, not investment advice.
          </p>
        </>
      )}
    </main>
  );
}
