"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { PutWriteCandidate, TenorId } from "@/lib/putwrite";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtMarketCap, fmtDateTime } from "@/lib/format";
import { useWatchlist } from "@/lib/watchlist";
import UniverseSwitcher from "./UniverseSwitcher";

const pctN = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${v.toFixed(d)}%`);
const pctFrac = (v: number | null | undefined, d = 0) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const expLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
    (reported ? `Reported ${-ei.days}d ago.` : before ? `⚠ Reports in ${ei.days}d, before expiry — an earnings gap can blow through a short strike.` : `Reports in ${ei.days}d, after expiry.`);
  return (
    <span style={{ color }} className={c.earningsEstimate ? "underline decoration-dotted decoration-[var(--text-4)] underline-offset-2" : ""} title={title}>
      {before && <span className="mr-0.5">⚠</span>}{earnLabel(c.nextEarnings!)}
      <span className="ml-1 text-[10px] text-[var(--text-4)]">{reported ? `${-ei.days}d ago` : `${ei.days}d`}</span>
    </span>
  );
}

// green ramp for return-on-risk
function rorColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-3)";
  if (v >= 35) return "#16a34a";
  if (v >= 22) return "#22c55e";
  if (v >= 12) return "#4ade80";
  return "var(--text-2)";
}
function rankColor(v: number | null | undefined): string {
  if (v == null) return "var(--text-4)";
  if (v >= 75) return "#f59e0b";
  if (v >= 50) return "#fbbf24";
  return "var(--text-3)";
}

type Structure = "bullPut" | "condor";
type SortKey = "ror" | "credit" | "pop" | "maxloss" | "iv" | "vol" | "mktcap" | "price" | "earn";

const STRUCTURES: { id: Structure; label: string; blurb: string }[] = [
  { id: "bullPut", label: "Bull-Put Spread", blurb: "Sell the ~16Δ put, buy a ~8Δ put below it — defined-risk, neutral-to-bullish." },
  { id: "condor", label: "Iron Condor", blurb: "Bull-put + bear-call (16Δ shorts, ~8Δ wings) — range-bound, sell premium both sides." },
];

export default function CreditSpreadView({
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
  const [minRor, setMinRor] = useState(0);
  const [minPop, setMinPop] = useState(0);
  const [elevatedOnly, setElevatedOnly] = useState(false);
  const [clearEarnings, setClearEarnings] = useState(false);
  const [watchOnly, setWatchOnly] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("ror");
  const [tenor, setTenor] = useState<TenorId>("m1");
  const [structure, setStructure] = useState<Structure>("bullPut");

  // both structures share credit/width/maxLoss/ror/pop/expiry/dte; bull-put adds breakeven, condor adds lo/hi BE.
  const sp = (c: PutWriteCandidate): any => (structure === "bullPut" ? c.bullPuts?.[tenor] : c.condors?.[tenor]);
  const volRank = (c: PutWriteCandidate) => (c.ivRank ?? c.rvolRank);
  const struct = STRUCTURES.find((s) => s.id === structure)!;

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const get: Record<SortKey, (c: PutWriteCandidate) => number> = {
      ror: (c) => (sp(c)?.ror ?? -1),
      credit: (c) => (sp(c)?.credit ?? -1),
      pop: (c) => (sp(c)?.pop ?? -1),
      maxloss: (c) => -(sp(c)?.maxLoss ?? 1e9), // lower max loss first
      iv: (c) => c.atmIV ?? -1,
      vol: (c) => volRank(c) ?? -1,
      mktcap: (c) => c.marketCap,
      price: (c) => c.price ?? -1,
      earn: (c) => { const ei = earnInfo(c.nextEarnings); if (!ei || ei.days < -7) return -1e9; return ei.days >= 0 ? 1e9 - ei.days : ei.days; },
    };
    return candidates
      .filter((c) => {
        const s = sp(c);
        if (!s) return false; // only names with this structure priced
        if (minRor && s.ror * 100 < minRor) return false;
        if (minPop && s.pop * 100 < minPop) return false;
        if (elevatedOnly && (volRank(c) ?? 0) < 50) return false;
        if (clearEarnings && earnsBeforeExpiry(c, s.expiry)) return false;
        if (watchOnly && !has(c.symbol)) return false;
        if (ql && !c.symbol.toLowerCase().includes(ql) && !c.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => get[sort](b) - get[sort](a));
  }, [candidates, structure, tenor, minRor, minPop, elevatedOnly, clearEarnings, watchOnly, q, sort, has]);

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
          <h1 className="mt-1 text-2xl font-bold">Credit-Spread Screener</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
            Defined-risk premium selling on quality names — no large cash lock-up. {struct.blurb} Ranked by return on risk (credit ÷ max loss). {candidates.length} names · {source} · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
            {STRUCTURES.map((s) => (
              <button key={s.id} onClick={() => setStructure(s.id)} title={s.blurb} className={"rounded-md px-2.5 py-1 " + (structure === s.id ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{s.label}</button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
            {(["m1", "m3"] as TenorId[]).map((t) => (
              <button key={t} onClick={() => setTenor(t)} className={"rounded-md px-2.5 py-1 " + (tenor === t ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{t === "m1" ? "~1M" : "~3M"}</button>
            ))}
          </div>
          <UniverseSwitcher current={universe} />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-3)]">
        <span><b className="text-[var(--text-2)]">Credit</b> = net premium collected up front</span>
        <span><b className="text-[var(--text-2)]">Max loss</b> = width − credit (your defined risk)</span>
        <span><b className="text-[var(--text-2)]">RoR</b> = credit ÷ max loss, the return on risk</span>
        <span><b className="text-[var(--text-2)]">POP</b> = prob. the short strike{structure === "condor" ? "s hold" : " holds"} (≈ 1 − short Δ)</span>
        <span><b className="text-[var(--text-2)]">Earnings</b> <span className="text-[#f59e0b]">⚠</span> = report before expiry</span>
      </div>

      {intl ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          Credit spreads screen U.S. optionable equities. Switch to a U.S. universe to see candidates.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-[var(--text-4)]">Min RoR</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
              {[0, 15, 25, 40].map((v) => <button key={v} onClick={() => setMinRor(v)} className={TB(minRor === v)}>{v === 0 ? "All" : `${v}%`}</button>)}
            </div>
            <span className="text-xs text-[var(--text-4)]">Min POP</span>
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
              {[0, 70, 80, 85].map((v) => <button key={v} onClick={() => setMinPop(v)} className={TB(minPop === v)}>{v === 0 ? "Any" : `${v}%`}</button>)}
            </div>
            <button onClick={() => setElevatedOnly((v) => !v)} className={"rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " + (elevatedOnly ? "border-[#f59e0b] bg-[#f59e0b]/15 text-[#fbbf24]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Volatility rank in the top half of its 1-year range — richer premium">⚡ Elevated vol</button>
            <button onClick={() => setClearEarnings((v) => !v)} className={"rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors " + (clearEarnings ? "border-[#16a34a] bg-[#16a34a]/15 text-[#4ade80]" : "border-[var(--border)] text-[var(--text-3)] hover:text-[var(--text)]")} title="Hide names reporting before expiry">🛡 Clear of earnings</button>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-3)]"><input type="checkbox" checked={watchOnly} onChange={(e) => setWatchOnly(e.target.checked)} className="accent-[#fbbf24]" /> ★ Watchlist</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or name…" className="w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
            {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
            <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {candidates.length}</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-3)]">
                  <th className="w-7 px-2 py-2"></th>
                  <th className="px-2 py-2 font-medium">Ticker</th>
                  <th className="px-2 py-2 font-medium">Company</th>
                  <SortTh k="price" cls="text-right">Price</SortTh>
                  <SortTh k="vol" cls="text-right">Vol rank</SortTh>
                  <SortTh k="iv" cls="text-right">ATM IV</SortTh>
                  <th className="px-2 py-2 text-right font-medium">{structure === "bullPut" ? "Short / Long" : "Put · Call wings"}</th>
                  <th className="px-2 py-2 text-right font-medium">Exp</th>
                  <SortTh k="earn" cls="text-right">Earnings</SortTh>
                  <SortTh k="credit" cls="text-right">Credit</SortTh>
                  <SortTh k="maxloss" cls="text-right">Max loss</SortTh>
                  <SortTh k="ror" cls="text-right">RoR</SortTh>
                  <SortTh k="pop" cls="text-right">POP</SortTh>
                  <th className="px-2 py-2 text-right font-medium">Break-even</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const s = sp(c);
                  const vr = volRank(c);
                  return (
                    <tr key={c.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                      <td className="px-2 py-1.5 text-center"><button onClick={() => toggle(c.symbol)} title="Watch" style={{ color: has(c.symbol) ? "#fbbf24" : "var(--border-strong)" }}>★</button></td>
                      <td className="px-2 py-1.5"><Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{c.symbol}</Link></td>
                      <td className="max-w-[14rem] truncate px-2 py-1.5"><span className="text-[var(--text-2)]">{c.name}</span><span className="ml-1.5 text-[10px] text-[var(--text-4)]">{c.sector}</span></td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums text-[var(--text)]">{c.price != null ? `$${c.price.toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: rankColor(vr) }} title={c.ivRank != null ? "IV percentile (1y)" : "Realized-vol percentile (1y)"}>{vr != null ? vr + (c.ivRank != null ? "" : "ʳ") : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{pctFrac(c.atmIV)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-mono text-[11px] tabular-nums">
                        {structure === "bullPut"
                          ? <Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}?tab=options`} className="text-[var(--text-2)] hover:text-[var(--accent)]">${s.shortStrike}<span className="text-[var(--text-4)]"> / ${s.longStrike}</span></Link>
                          : <Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}?tab=options`} className="text-[var(--text-2)] hover:text-[var(--accent)]">${s.putLong}/${s.putShort}<span className="text-[var(--text-4)]"> · </span>${s.callShort}/${s.callLong}</Link>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{expLabel(s.expiry)}<span className="ml-1 text-[10px] text-[var(--text-4)]">{s.dte}d</span></td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{renderEarn(c, s.expiry)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[#22c55e]" title="Net premium collected per share (×100 = per spread)">${s.credit.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]" title={`Width $${s.width.toFixed(2)} − credit`}>${s.maxLoss.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums" style={{ color: rorColor(s.ror * 100) }} title="Return on risk = credit ÷ max loss, to expiry">{pctN(s.ror * 100)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-2)]">{pctN(s.pop * 100)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{structure === "bullPut" ? `$${s.breakeven.toFixed(2)}` : `$${s.lowBE.toFixed(2)}–$${s.highBE.toFixed(2)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-[var(--text-3)]">No names match these filters for this structure/tenor.</div>}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-4)]">
            Wings are the ~16-delta short and ~8-delta long strikes solved from ATM implied vol (vendor IV is unreliable). Credit/max-loss are per share (×100 = per spread). RoR = credit ÷ max loss to expiry; POP ≈ 1 − short-strike delta (lognormal). Premiums are end-of-day last (or mid during market hours) — indicative, not a live fill; confirm on the chain. Research screen, not investment advice.
          </p>
        </>
      )}
    </main>
  );
}
