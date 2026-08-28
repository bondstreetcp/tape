"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { bsGreeks, ivFromPrice } from "@/lib/blackScholes";
import { LoadingState } from "./Spinner";

// A single-name covered-call / theta-wheel workbench with two modes:
//   • New call — for a stock you OWN, rank OTM calls by wheel economics (premium, annualized yield,
//     assignment odds, if-called return) and name a strike + expiry to sell.
//   • Roll a call — for a call you've ALREADY sold, find the best roll (up &/or out) with the net
//     credit/debit, new cap and new assignment odds — the hard part of running a wheel.
// Reuses the live chain (/api/options) + client-side Black-Scholes (IV solved from the mid).

interface Opt { strike: number; last: number | null; bid: number | null; ask: number | null; vol: number | null; oi: number | null; iv: number | null; itm: boolean }
interface Chain { underlying: number | null; expirations: string[]; selected: string | null; calls: Opt[]; puts: Opt[] }

interface Cand {
  expiry: string; dte: number; strike: number; mid: number;
  iv: number | null; delta: number | null; assignProb: number | null;
  premiumPct: number; annYield: number; ifCalledPct: number; ifCalledAnn: number;
  otmPct: number; oi: number | null; liquid: boolean;
  earningsConflict: boolean; belowBasis: boolean;
}

interface Roll {
  expiry: string; dte: number; strike: number; newMid: number;
  netCredit: number; delta: number | null; assignProb: number | null;
  newCapPct: number; addlDays: number; annCredit: number;
  earningsConflict: boolean; up: boolean;
}

const DAY = 86_400_000;
const dteOf = (expiry: string) => Math.round((Date.parse(expiry + "T00:00:00Z") - Date.now()) / DAY);
const pct = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`);
const money = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v < 0 ? "−" : ""}$${Math.abs(v).toFixed(d)}`);
const fmtDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const midOf = (c: Opt) => (c.bid != null && c.ask != null && c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.last ?? 0);

function earnISO(e?: string | number | null): string | null {
  if (e == null) return null;
  if (typeof e === "number") { const ms = e > 1e12 ? e : e * 1000; return new Date(ms).toISOString().slice(0, 10); }
  const s = String(e).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function buildCands(spot: number, chains: { expiry: string; dte: number; calls: Opt[] }[], earn: string | null, basis: number | null): Cand[] {
  const today = new Date().toISOString().slice(0, 10);
  const out: Cand[] = [];
  for (const { expiry, dte, calls } of chains) {
    if (dte <= 0) continue;
    const T = dte / 365;
    const earningsConflict = !!(earn && earn >= today && earn <= expiry);
    for (const c of calls) {
      if (c.strike <= spot) continue; // OTM calls only
      const mid = midOf(c);
      if (!(mid > 0)) continue;
      const iv = ivFromPrice("call", spot, c.strike, T, mid) ?? (c.iv && c.iv > 0 ? c.iv : null);
      const g = iv ? bsGreeks("call", spot, c.strike, T, iv) : null;
      const premiumPct = (mid / spot) * 100;
      const ifCalledPct = ((c.strike - spot) + mid) / spot * 100;
      out.push({
        expiry, dte, strike: c.strike, mid,
        iv, delta: g?.delta ?? null, assignProb: g?.probItm ?? null,
        premiumPct, annYield: premiumPct * (365 / dte),
        ifCalledPct, ifCalledAnn: ifCalledPct * (365 / dte),
        otmPct: (c.strike / spot - 1) * 100,
        oi: c.oi, liquid: (c.bid ?? 0) > 0 && (c.oi ?? 0) >= 25,
        earningsConflict, belowBasis: basis != null && c.strike < basis,
      });
    }
  }
  return out;
}

function buildRolls(spot: number, curStrike: number, curDte: number, curMark: number, chains: { expiry: string; dte: number; calls: Opt[] }[], earn: string | null): Roll[] {
  const today = new Date().toISOString().slice(0, 10);
  const out: Roll[] = [];
  for (const { expiry, dte, calls } of chains) {
    if (dte <= curDte || dte <= 0) continue; // roll OUT (later) only
    const T = dte / 365;
    const earningsConflict = !!(earn && earn >= today && earn <= expiry);
    for (const c of calls) {
      if (c.strike < curStrike) continue; // roll up or same — never down (that locks a loss)
      const mid = midOf(c);
      if (!(mid > 0)) continue;
      const netCredit = mid - curMark; // per share; >0 = you collect more
      const iv = ivFromPrice("call", spot, c.strike, T, mid);
      const g = iv ? bsGreeks("call", spot, c.strike, T, iv) : null;
      out.push({
        expiry, dte, strike: c.strike, newMid: mid, netCredit,
        delta: g?.delta ?? null, assignProb: g?.probItm ?? null,
        newCapPct: (c.strike / spot - 1) * 100, addlDays: dte - curDte,
        annCredit: netCredit / spot * 100 * (365 / (dte - curDte || 1)),
        earningsConflict, up: c.strike > curStrike,
      });
    }
  }
  return out;
}

const yieldColor = (ann: number) => (ann >= 40 ? "#22c55e" : ann >= 20 ? "#f59e0b" : "var(--text-3)");

const Row = ({ k, v, color }: { k: string; v: string; color?: string }) => (
  <div className="flex justify-between gap-2"><span className="text-[var(--text-4)]">{k}</span><span className="tabular-nums font-medium" style={color ? { color } : undefined}>{v}</span></div>
);

function StatCard({ c, contracts, label, tone }: { c: Cand; contracts: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" style={{ borderColor: `${tone}55` }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: tone }}>{label}</span>
        <span className="text-[10px] text-[var(--text-4)]">Δ {c.delta != null ? c.delta.toFixed(2) : "—"}</span>
      </div>
      <div className="mt-1 font-mono text-lg font-bold text-[var(--text)]">${c.strike}<span className="ml-1 text-[11px] font-normal text-[var(--text-4)]">call</span></div>
      <div className="text-[11px] text-[var(--text-3)]">{fmtDate(c.expiry)} · {c.dte}d · {pct(c.otmPct)} OTM</div>
      <div className="mt-2 space-y-0.5 text-[11px]">
        <Row k="Premium" v={`${money(c.mid)} (${pct(c.premiumPct)})`} />
        <Row k="Annualized" v={pct(c.annYield, 0)} color={yieldColor(c.annYield)} />
        <Row k="Assign odds" v={c.assignProb != null ? pct(c.assignProb * 100, 0) : "—"} />
        <Row k="If called" v={`${pct(c.ifCalledPct)} (${pct(c.ifCalledAnn, 0)} ann)`} />
        {contracts > 0 && <Row k={`Income ×${contracts}`} v={money(c.mid * 100 * contracts, 0)} color="#22c55e" />}
      </div>
    </div>
  );
}

export default function CoveredCallWheel({ symbol, earningsDate }: { symbol: string; currency?: string; earningsDate?: string | number | null }) {
  const [spot, setSpot] = useState<number | null>(null);
  const [expirations, setExpirations] = useState<string[]>([]);
  const [chainsByExp, setChainsByExp] = useState<Record<string, Opt[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "roll">("new");
  const [shares, setShares] = useState(100);
  const [basis, setBasis] = useState<number | null>(null);
  const [curExpiry, setCurExpiry] = useState<string>("");
  const [curStrike, setCurStrike] = useState<number | null>(null);

  const earn = useMemo(() => earnISO(earningsDate), [earningsDate]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null); setChainsByExp({}); setSpot(null); setExpirations([]); setCurExpiry(""); setCurStrike(null);
    (async () => {
      try {
        const base: Chain = await fetch(`/api/options/${encodeURIComponent(symbol)}`).then((r) => r.json());
        if (!alive) return;
        if (!base.underlying) { setErr("No live options chain for this name."); setLoading(false); return; }
        setSpot(base.underlying);
        setExpirations(base.expirations || []);
        const seed: Record<string, Opt[]> = {};
        if (base.selected) seed[base.selected] = base.calls || [];
        // Wheel-relevant tenors: 7–70 DTE, up to 6 expiries (the theta sweet spot lives ~30–45d).
        const windowed = (base.expirations || []).map((e) => ({ e, dte: dteOf(e) })).filter((x) => x.dte >= 7 && x.dte <= 70);
        const picked = windowed.length > 6 ? windowed.filter((_, i) => i % Math.ceil(windowed.length / 6) === 0).slice(0, 6) : windowed;
        await Promise.all(picked.map(async ({ e }) => {
          if (seed[e]) return;
          try { const ch: Chain = await fetch(`/api/options/${encodeURIComponent(symbol)}?date=${e}`).then((r) => r.json()); seed[e] = ch.calls || []; } catch { /* skip */ }
        }));
        if (!alive) return;
        setChainsByExp(seed);
      } catch (e) { if (alive) setErr(String(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [symbol]);

  // Fetch a specific expiry's chain on demand (for a rolled call's current expiry, which may be outside the window).
  const ensureChain = useCallback(async (expiry: string) => {
    if (!expiry || chainsByExp[expiry]) return;
    try { const ch: Chain = await fetch(`/api/options/${encodeURIComponent(symbol)}?date=${expiry}`).then((r) => r.json()); setChainsByExp((prev) => ({ ...prev, [expiry]: ch.calls || [] })); } catch { /* skip */ }
  }, [symbol, chainsByExp]);

  // Default the roll inputs once the chain loads: nearest expiry ~3–45 DTE, nearest strike to spot.
  useEffect(() => {
    if (mode !== "roll" || !spot || curExpiry) return;
    const near = expirations.map((e) => ({ e, dte: dteOf(e) })).filter((x) => x.dte >= 2).sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))[0];
    if (near) { setCurExpiry(near.e); ensureChain(near.e); }
  }, [mode, spot, expirations, curExpiry, ensureChain]);

  useEffect(() => { if (mode === "roll" && curExpiry) ensureChain(curExpiry); }, [mode, curExpiry, ensureChain]);

  // Default the current strike to the nearest strike ≥ spot once the current expiry's chain is in.
  useEffect(() => {
    if (mode !== "roll" || !spot || curStrike != null || !curExpiry || !chainsByExp[curExpiry]) return;
    const strikes = chainsByExp[curExpiry].map((c) => c.strike).sort((a, b) => a - b);
    const atmUp = strikes.find((s) => s >= spot) ?? strikes[strikes.length - 1];
    if (atmUp != null) setCurStrike(atmUp);
  }, [mode, spot, curStrike, curExpiry, chainsByExp]);

  const windowChains = useMemo(() => Object.entries(chainsByExp).map(([expiry, calls]) => ({ expiry, dte: dteOf(expiry), calls })).filter((x) => x.dte >= 7 && x.dte <= 70), [chainsByExp]);
  const cands = useMemo(() => (spot ? buildCands(spot, windowChains, earn, basis) : []), [spot, windowChains, earn, basis]);
  const contracts = Math.floor(shares / 100);

  const pick = (targetDelta: number): Cand | null => {
    const pool = cands.filter((c) => c.assignProb != null && c.delta != null && !c.earningsConflict && !c.belowBasis && c.dte >= 20 && c.dte <= 50 && c.liquid);
    const fallback = cands.filter((c) => c.delta != null && !c.earningsConflict && !c.belowBasis);
    const use = pool.length ? pool : fallback;
    return use.reduce<Cand | null>((best, c) => (best == null || Math.abs((c.delta as number) - targetDelta) < Math.abs((best.delta as number) - targetDelta) ? c : best), null);
  };
  const conservative = useMemo(() => pick(0.2), [cands]);
  const balanced = useMemo(() => pick(0.3), [cands]);
  const aggressive = useMemo(() => pick(0.4), [cands]);

  const buckets = [2, 5, 8, 12];
  const grid = useMemo(() => {
    const byExp = new Map<string, Cand[]>();
    for (const c of cands) { const a = byExp.get(c.expiry) || []; a.push(c); byExp.set(c.expiry, a); }
    return [...byExp.entries()].sort((a, b) => dteOf(a[0]) - dteOf(b[0])).map(([expiry, list]) => ({
      expiry, dte: dteOf(expiry), earningsConflict: list[0]?.earningsConflict ?? false,
      cells: buckets.map((b) => list.reduce<Cand | null>((best, c) => (best == null || Math.abs(c.otmPct - b) < Math.abs(best.otmPct - b) ? c : best), null)),
    }));
  }, [cands]);

  // ── roll mode derived ──
  const curCall = useMemo(() => {
    if (mode !== "roll" || !curExpiry || curStrike == null) return null;
    const c = (chainsByExp[curExpiry] || []).find((x) => x.strike === curStrike);
    if (!c) return null;
    const dte = dteOf(curExpiry), T = Math.max(dte, 0.5) / 365, mark = midOf(c);
    const iv = spot && mark > 0 ? ivFromPrice("call", spot, curStrike, T, mark) : null;
    const g = spot && iv ? bsGreeks("call", spot, curStrike, T, iv) : null;
    return { strike: curStrike, expiry: curExpiry, dte, mark, delta: g?.delta ?? null, assignProb: g?.probItm ?? null, itm: !!spot && spot >= curStrike };
  }, [mode, curExpiry, curStrike, chainsByExp, spot]);

  const rolls = useMemo(() => (mode === "roll" && spot && curCall && curCall.mark > 0 ? buildRolls(spot, curCall.strike, curCall.dte, curCall.mark, windowChains, earn) : []), [mode, spot, curCall, windowChains, earn]);
  const bestRoll = useMemo(() => {
    const ok = rolls.filter((r) => r.netCredit >= 0 && r.delta != null && r.delta >= 0.18 && r.delta <= 0.42 && !r.earningsConflict);
    const pool = ok.length ? ok : rolls.filter((r) => r.delta != null && !r.earningsConflict);
    return pool.reduce<Roll | null>((best, r) => (best == null || r.netCredit > best.netCredit ? r : best), null);
  }, [rolls]);

  if (loading) return <LoadingState label="Reading the options chain…" />;
  if (err) return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">{err}</div>;
  if (!spot) return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">No options chain for {symbol}.</div>;

  const Toggle = () => (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
      {(["new", "roll"] as const).map((m) => (
        <button key={m} onClick={() => setMode(m)} className={"rounded-md px-3 py-1 " + (mode === m ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{m === "new" ? "Sell a new call" : "Roll an open call"}</button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-[var(--text)]">Covered-call recommender <span className="font-normal text-[var(--text-4)]">— {symbol} at {money(spot)}</span></h3>
        <Toggle />
      </div>

      {mode === "new" ? (
        !cands.length ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">No sellable out-of-the-money calls in the 7–70 day window.</div>
        ) : (
          <>
            <p className="max-w-3xl text-[12px] leading-relaxed text-[var(--text-3)]">Ranks out-of-the-money calls by wheel economics — premium collected, annualized yield, the odds you get called away, and your return if that happens. IV solved from each option&apos;s mid, greeks from Black-Scholes.</p>

            <div className="flex flex-wrap items-end gap-3 text-[12px]">
              <label className="flex flex-col gap-0.5"><span className="text-[var(--text-4)]">Shares owned</span>
                <input type="number" value={shares} min={0} step={100} onChange={(e) => setShares(Math.max(0, Number(e.target.value) || 0))} className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 tabular-nums" />
              </label>
              <label className="flex flex-col gap-0.5"><span className="text-[var(--text-4)]">Cost basis (optional)</span>
                <input type="number" placeholder="e.g. 180" min={0} step={1} onChange={(e) => setBasis(e.target.value ? Number(e.target.value) : null)} className="w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 tabular-nums" />
              </label>
              <div className="text-[11px] text-[var(--text-4)]">{contracts > 0 ? `${contracts} contract${contracts > 1 ? "s" : ""}` : "≥100 shares to write 1 contract"}{basis != null ? ` · strikes below ${money(basis, 0)} excluded` : ""}</div>
            </div>

            {earn && earn >= new Date().toISOString().slice(0, 10) && (
              <div className="rounded-lg border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-2 text-[12px] text-[var(--text-2)]">⚠ Earnings on <b>{fmtDate(earn)}</b> — expiries that span it carry event risk; those rows are flagged and the recommendation avoids them.</div>
            )}

            {balanced && (
              <div className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">Recommended</div>
                <div className="mt-1 text-[15px] font-semibold text-[var(--text)]">Sell the <b>{money(balanced.strike, 0)} call</b> expiring <b>{fmtDate(balanced.expiry)}</b> ({balanced.dte}d)</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-3)]">
                  <span>Collect <b className="text-[#22c55e]">{money(balanced.mid)}</b>/sh ({pct(balanced.premiumPct)}){contracts > 0 ? ` = ${money(balanced.mid * 100 * contracts, 0)}` : ""}</span>
                  <span><b style={{ color: yieldColor(balanced.annYield) }}>{pct(balanced.annYield, 0)}</b> annualized</span>
                  <span>~<b>{balanced.assignProb != null ? pct(balanced.assignProb * 100, 0) : "—"}</b> called away</span>
                  <span>if called: <b>{pct(balanced.ifCalledPct)}</b></span>
                </div>
              </div>
            )}

            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Pick your risk</div>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {conservative && <StatCard c={conservative} contracts={contracts} label="Conservative" tone="#22c55e" />}
                {balanced && <StatCard c={balanced} contracts={contracts} label="Balanced" tone="#60a5fa" />}
                {aggressive && <StatCard c={aggressive} contracts={contracts} label="Aggressive" tone="#f59e0b" />}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-4)]">Conservative = further OTM (~0.20Δ, keep your shares more often). Aggressive = nearer the money (~0.40Δ, more premium, likelier called).</div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Annualized yield · expiry × how far out-of-the-money</div>
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full min-w-[420px] text-[12px]">
                  <thead><tr className="bg-[var(--surface-2)] text-[var(--text-4)]"><th className="px-2 py-1.5 text-left font-medium">Expiry</th>{buckets.map((b) => <th key={b} className="px-2 py-1.5 text-right font-medium">+{b}%</th>)}</tr></thead>
                  <tbody>
                    {grid.map((r) => (
                      <tr key={r.expiry} className="border-t border-[var(--divider)]">
                        <td className="px-2 py-1.5 text-[var(--text-2)]">{fmtDate(r.expiry)} <span className="text-[10px] text-[var(--text-4)]">{r.dte}d</span>{r.earningsConflict && <span className="ml-1 text-[#f59e0b]" title="Spans earnings">⚠</span>}</td>
                        {r.cells.map((c, i) => (
                          <td key={i} className="px-2 py-1.5 text-right tabular-nums" title={c ? `$${c.strike} call · ${money(c.mid)} · Δ${c.delta?.toFixed(2)} · assign ${c.assignProb != null ? Math.round(c.assignProb * 100) : "—"}%` : ""}>{c ? <span style={{ color: yieldColor(c.annYield) }}>{pct(c.annYield, 0)}</span> : <span className="text-[var(--text-4)]">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      ) : (
        // ── ROLL MODE ──
        <>
          <p className="max-w-3xl text-[12px] leading-relaxed text-[var(--text-3)]">Already short a call? Enter it below and this finds the best <b className="text-[var(--text-2)]">roll</b> — buy it back and sell a later (and/or higher) one — showing the net credit, new upside cap and new assignment odds. Rolling <b>up &amp; out</b> for a credit is the wheel&apos;s standard defense when the stock runs at your strike.</p>

          <div className="flex flex-wrap items-end gap-3 text-[12px]">
            <label className="flex flex-col gap-0.5"><span className="text-[var(--text-4)]">Your call&apos;s expiry</span>
              <select value={curExpiry} onChange={(e) => { setCurExpiry(e.target.value); setCurStrike(null); }} className="w-36 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1">
                <option value="">select…</option>
                {expirations.filter((e) => dteOf(e) >= 0).map((e) => <option key={e} value={e}>{fmtDate(e)} ({dteOf(e)}d)</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-0.5"><span className="text-[var(--text-4)]">Your strike</span>
              <input type="number" value={curStrike ?? ""} min={0} step={1} onChange={(e) => setCurStrike(e.target.value ? Number(e.target.value) : null)} className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 tabular-nums" />
            </label>
          </div>

          {!curCall ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">Pick your open call&apos;s expiry and strike above{curExpiry && curStrike != null ? " — no matching contract found on the chain (check the strike)." : "."}</div>
          ) : (
            <>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-[12px]">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="font-semibold text-[var(--text)]">Your call: ${curCall.strike} · {fmtDate(curCall.expiry)} · {curCall.dte}d left</span>
                  <span className="text-[var(--text-3)]">now worth <b>{money(curCall.mark)}</b>/sh to buy back</span>
                  <span className="text-[var(--text-3)]">Δ {curCall.delta != null ? curCall.delta.toFixed(2) : "—"}</span>
                  <span className="text-[var(--text-3)]">assign ~{curCall.assignProb != null ? pct(curCall.assignProb * 100, 0) : "—"}</span>
                  {curCall.itm ? <span className="rounded bg-[#ef4444]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#ef4444]">IN THE MONEY — assignment risk</span> : <span className="rounded bg-[#22c55e]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#22c55e]">out of the money</span>}
                </div>
              </div>

              {bestRoll ? (
                <div className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">Recommended roll — {bestRoll.up ? "up & out" : "out"}</div>
                  <div className="mt-1 text-[15px] font-semibold text-[var(--text)]">Buy back your {money(curCall.strike, 0)} → sell the <b>{money(bestRoll.strike, 0)} call</b> expiring <b>{fmtDate(bestRoll.expiry)}</b></div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-3)]">
                    <span>Net <b style={{ color: bestRoll.netCredit >= 0 ? "#22c55e" : "#ef4444" }}>{bestRoll.netCredit >= 0 ? "credit" : "debit"} {money(Math.abs(bestRoll.netCredit))}</b>/sh{contracts > 0 ? ` = ${money(bestRoll.netCredit * 100 * contracts, 0)}` : ""}</span>
                    <span>+{bestRoll.addlDays}d of time</span>
                    <span>new cap <b>{pct(bestRoll.newCapPct)}</b> OTM</span>
                    <span>new assign ~<b>{bestRoll.assignProb != null ? pct(bestRoll.assignProb * 100, 0) : "—"}</b></span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-4)]">{bestRoll.up ? "Raises your strike (more upside kept) and " : "Keeps your strike and "}buys time{bestRoll.netCredit >= 0 ? " for a net credit — you get paid to defend the position." : " — but at a net debit; consider letting it be called instead."}</div>
                </div>
              ) : <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">No later expiries loaded to roll into — the wheel window is 7–70 days out.</div>}

              {rolls.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Net credit to roll · new expiry × new strike</div>
                  <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                    <table className="w-full min-w-[440px] text-[12px]">
                      <thead><tr className="bg-[var(--surface-2)] text-[var(--text-4)]"><th className="px-2 py-1.5 text-left font-medium">Roll to</th><th className="px-2 py-1.5 text-right font-medium">Net</th><th className="px-2 py-1.5 text-right font-medium">+days</th><th className="px-2 py-1.5 text-right font-medium">New Δ</th><th className="px-2 py-1.5 text-right font-medium">New cap</th><th className="px-2 py-1.5 text-right font-medium">Assign</th></tr></thead>
                      <tbody>
                        {[...rolls].filter((r) => r.up ? r.newCapPct <= 15 : true).sort((a, b) => b.netCredit - a.netCredit).slice(0, 12).map((r, i) => (
                          <tr key={i} className="border-t border-[var(--divider)]">
                            <td className="px-2 py-1.5 text-[var(--text-2)]">${r.strike} · {fmtDate(r.expiry)} {r.up && <span className="text-[10px] text-[var(--accent)]">up</span>}{r.earningsConflict && <span className="ml-1 text-[#f59e0b]" title="Spans earnings">⚠</span>}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: r.netCredit >= 0 ? "#22c55e" : "#ef4444" }}>{money(r.netCredit)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">+{r.addlDays}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{r.delta != null ? r.delta.toFixed(2) : "—"}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{pct(r.newCapPct)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{r.assignProb != null ? pct(r.assignProb * 100, 0) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      <p className="max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">
        The wheel: sell covered calls for income; if called away above your basis you bank the gain, then sell cash-secured puts to buy back in. Assignment odds are the risk-neutral P(finish ITM). Live chain via Yahoo, IV solved from the mid — decision-support, not advice. Confirm the live bid/ask before trading.
      </p>
    </div>
  );
}
