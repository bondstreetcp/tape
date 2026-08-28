"use client";
import { useEffect, useMemo, useState } from "react";
import { bsGreeks, ivFromPrice } from "@/lib/blackScholes";
import { LoadingState } from "./Spinner";

// A single-name covered-call / theta-wheel recommender: given a stock you OWN, it reads the live
// options chain and ranks OTM calls by wheel economics — premium, annualized yield, assignment odds,
// if-called return — flags any expiry that spans an earnings print, and names a strike + expiry to sell.
// Reuses the app's live chain (/api/options) + client-side Black-Scholes (IV solved from the mid).

interface Opt { strike: number; last: number | null; bid: number | null; ask: number | null; vol: number | null; oi: number | null; iv: number | null; itm: boolean }
interface Chain { underlying: number | null; expirations: string[]; selected: string | null; calls: Opt[]; puts: Opt[] }

interface Cand {
  expiry: string; dte: number; strike: number; mid: number;
  iv: number | null; delta: number | null; assignProb: number | null;
  premiumPct: number; annYield: number; ifCalledPct: number; ifCalledAnn: number;
  otmPct: number; oi: number | null; liquid: boolean;
  earningsConflict: boolean; belowBasis: boolean;
}

const DAY = 86_400_000;
const todayMs = () => Date.now();
const dteOf = (expiry: string) => Math.round((Date.parse(expiry + "T00:00:00Z") - todayMs()) / DAY);
const pct = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(d)}%`);
const money = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(d)}`);
const fmtDate = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// Normalize an earnings date (ISO string or epoch s/ms) to YYYY-MM-DD, or null.
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
      if (c.strike <= spot) continue; // OTM calls only (a covered call sells upside above spot)
      const mid = c.bid != null && c.ask != null && c.bid > 0 && c.ask > 0 ? (c.bid + c.ask) / 2 : c.last ?? 0;
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

const yieldColor = (ann: number) => (ann >= 40 ? "#22c55e" : ann >= 20 ? "#f59e0b" : "var(--text-3)");

function StatCard({ c, spot, contracts, label, tone }: { c: Cand; spot: number; contracts: number; label: string; tone: string }) {
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
const Row = ({ k, v, color }: { k: string; v: string; color?: string }) => (
  <div className="flex justify-between gap-2"><span className="text-[var(--text-4)]">{k}</span><span className="tabular-nums font-medium" style={color ? { color } : undefined}>{v}</span></div>
);

export default function CoveredCallWheel({ symbol, earningsDate }: { symbol: string; currency?: string; earningsDate?: string | number | null }) {
  const [spot, setSpot] = useState<number | null>(null);
  const [chains, setChains] = useState<{ expiry: string; dte: number; calls: Opt[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [shares, setShares] = useState(100);
  const [basis, setBasis] = useState<number | null>(null);

  const earn = useMemo(() => earnISO(earningsDate), [earningsDate]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null); setChains([]); setSpot(null);
    (async () => {
      try {
        const base: Chain = await fetch(`/api/options/${encodeURIComponent(symbol)}`).then((r) => r.json());
        if (!alive) return;
        if (!base.underlying) { setErr("No live options chain for this name."); setLoading(false); return; }
        setSpot(base.underlying);
        // Wheel-relevant tenors: 7–70 DTE, up to 6 expiries (the theta sweet spot lives ~30–45d).
        const windowed = (base.expirations || []).map((e) => ({ e, dte: dteOf(e) })).filter((x) => x.dte >= 7 && x.dte <= 70);
        const picked = windowed.length > 6 ? windowed.filter((_, i) => i % Math.ceil(windowed.length / 6) === 0).slice(0, 6) : windowed;
        const got = await Promise.all(picked.map(async ({ e, dte }) => {
          try {
            const ch: Chain = e === base.selected ? base : await fetch(`/api/options/${encodeURIComponent(symbol)}?date=${e}`).then((r) => r.json());
            return { expiry: e, dte, calls: ch.calls || [] };
          } catch { return null; }
        }));
        if (!alive) return;
        setChains(got.filter((x): x is { expiry: string; dte: number; calls: Opt[] } => !!x && x.calls.length > 0));
      } catch (e) { if (alive) setErr(String(e)); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [symbol]);

  const cands = useMemo(() => (spot ? buildCands(spot, chains, earn, basis) : []), [spot, chains, earn, basis]);
  const contracts = Math.floor(shares / 100);

  // Profiles by target delta, drawn from the theta sweet spot (20–50 DTE), liquid, no earnings/ below-basis conflict.
  const pick = (targetDelta: number): Cand | null => {
    const pool = cands.filter((c) => c.assignProb != null && c.delta != null && !c.earningsConflict && !c.belowBasis && c.dte >= 20 && c.dte <= 50 && c.liquid);
    const fallback = cands.filter((c) => c.delta != null && !c.earningsConflict && !c.belowBasis);
    const use = pool.length ? pool : fallback;
    return use.reduce<Cand | null>((best, c) => (best == null || Math.abs((c.delta as number) - targetDelta) < Math.abs((best.delta as number) - targetDelta) ? c : best), null);
  };
  const conservative = useMemo(() => pick(0.2), [cands]);
  const balanced = useMemo(() => pick(0.3), [cands]);
  const aggressive = useMemo(() => pick(0.4), [cands]);

  // Grid: expiries (rows) × ~OTM moneyness buckets (cols), cell = annualized yield of the nearest strike.
  const buckets = [2, 5, 8, 12];
  const grid = useMemo(() => {
    const byExp = new Map<string, Cand[]>();
    for (const c of cands) { const a = byExp.get(c.expiry) || []; a.push(c); byExp.set(c.expiry, a); }
    return [...byExp.entries()].sort((a, b) => dteOf(a[0]) - dteOf(b[0])).map(([expiry, list]) => ({
      expiry, dte: dteOf(expiry), earningsConflict: list[0]?.earningsConflict ?? false,
      cells: buckets.map((b) => list.reduce<Cand | null>((best, c) => (best == null || Math.abs(c.otmPct - b) < Math.abs(best.otmPct - b) ? c : best), null)),
    }));
  }, [cands]);

  if (loading) return <LoadingState label="Reading the options chain…" />;
  if (err) return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">{err}</div>;
  if (!spot || !cands.length) return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">No sellable out-of-the-money calls found for {symbol} in the 7–70 day window.</div>;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-bold text-[var(--text)]">Covered-call recommender <span className="font-normal text-[var(--text-4)]">— sell calls on shares you own (the wheel&apos;s call leg)</span></h3>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-[var(--text-3)]">
          {symbol} at <b className="text-[var(--text-2)]">{money(spot)}</b>. Ranks out-of-the-money calls by wheel economics — premium collected, annualized yield, the odds you get assigned (called away), and your return if that happens. IV is solved from each option&apos;s mid, greeks from Black-Scholes.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-0.5"><span className="text-[var(--text-4)]">Shares owned</span>
          <input type="number" value={shares} min={0} step={100} onChange={(e) => setShares(Math.max(0, Number(e.target.value) || 0))} className="w-28 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 tabular-nums" />
        </label>
        <label className="flex flex-col gap-0.5"><span className="text-[var(--text-4)]">Cost basis (optional)</span>
          <input type="number" placeholder="e.g. 180" min={0} step={1} onChange={(e) => setBasis(e.target.value ? Number(e.target.value) : null)} className="w-32 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 tabular-nums" />
        </label>
        <div className="text-[11px] text-[var(--text-4)]">{contracts > 0 ? `${contracts} contract${contracts > 1 ? "s" : ""}` : "≥100 shares to write 1 contract"}{basis != null ? ` · strikes below ${money(basis, 0)} excluded (would lock a loss if called)` : ""}</div>
      </div>

      {earn && earn >= new Date().toISOString().slice(0, 10) && (
        <div className="rounded-lg border border-[#f59e0b]/40 bg-[#f59e0b]/10 px-3 py-2 text-[12px] text-[var(--text-2)]">
          ⚠ Earnings on <b>{fmtDate(earn)}</b> — expiries that span it carry event risk (a gap can blow past your strike). Those rows are flagged below; the recommendation avoids them.
        </div>
      )}

      {balanced ? (
        <div className="rounded-2xl border border-[var(--accent)]/40 bg-[var(--accent)]/[0.06] p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">Recommended</div>
          <div className="mt-1 text-[15px] font-semibold text-[var(--text)]">
            Sell the <b>{money(balanced.strike, 0)} call</b> expiring <b>{fmtDate(balanced.expiry)}</b> ({balanced.dte}d)
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-3)]">
            <span>Collect <b className="text-[#22c55e]">{money(balanced.mid)}</b>/sh ({pct(balanced.premiumPct)}){contracts > 0 ? ` = ${money(balanced.mid * 100 * contracts, 0)}` : ""}</span>
            <span><b style={{ color: yieldColor(balanced.annYield) }}>{pct(balanced.annYield, 0)}</b> annualized</span>
            <span>~<b>{balanced.assignProb != null ? pct(balanced.assignProb * 100, 0) : "—"}</b> chance called away</span>
            <span>if called: <b>{pct(balanced.ifCalledPct)}</b> ({pct(balanced.ifCalledAnn, 0)} ann)</span>
          </div>
          <div className="mt-1 text-[11px] text-[var(--text-4)]">A ~0.30-delta strike ~{pct(balanced.otmPct)} out, in the 20–50-day theta sweet spot — balances premium against keeping your shares.</div>
        </div>
      ) : null}

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Pick your risk</div>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {conservative && <StatCard c={conservative} spot={spot} contracts={contracts} label="Conservative" tone="#22c55e" />}
          {balanced && <StatCard c={balanced} spot={spot} contracts={contracts} label="Balanced" tone="#60a5fa" />}
          {aggressive && <StatCard c={aggressive} spot={spot} contracts={contracts} label="Aggressive" tone="#f59e0b" />}
        </div>
        <div className="mt-1 text-[11px] text-[var(--text-4)]">Conservative = further OTM (~0.20Δ, keep your shares more often, less premium). Aggressive = nearer the money (~0.40Δ, more premium, likelier to be called).</div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Annualized yield · expiry × how far out-of-the-money</div>
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full min-w-[420px] text-[12px]">
            <thead><tr className="bg-[var(--surface-2)] text-[var(--text-4)]">
              <th className="px-2 py-1.5 text-left font-medium">Expiry</th>
              {buckets.map((b) => <th key={b} className="px-2 py-1.5 text-right font-medium">+{b}%</th>)}
            </tr></thead>
            <tbody>
              {grid.map((r) => (
                <tr key={r.expiry} className="border-t border-[var(--divider)]">
                  <td className="px-2 py-1.5 text-[var(--text-2)]">{fmtDate(r.expiry)} <span className="text-[10px] text-[var(--text-4)]">{r.dte}d</span>{r.earningsConflict && <span className="ml-1 text-[#f59e0b]" title="Spans earnings">⚠</span>}</td>
                  {r.cells.map((c, i) => (
                    <td key={i} className="px-2 py-1.5 text-right tabular-nums" title={c ? `$${c.strike} call · ${money(c.mid)} · Δ${c.delta?.toFixed(2)} · assign ${c.assignProb != null ? Math.round(c.assignProb * 100) : "—"}%` : ""}>
                      {c ? <span style={{ color: yieldColor(c.annYield) }}>{pct(c.annYield, 0)}</span> : <span className="text-[var(--text-4)]">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">
        The wheel: sell covered calls for income; if your shares get called away above your basis you bank the gain, then sell cash-secured puts to buy back in. Annualized yield assumes you repeat the trade; assignment odds are the risk-neutral P(finish in-the-money). Live chain via Yahoo, IV solved from the mid — a decision-support tool, not advice. Confirm the live bid/ask before trading.
      </p>
    </div>
  );
}
