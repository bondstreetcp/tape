/**
 * Server-side loader: fetch a name's near-term option chains, solve each contract's IV from the mid, and
 * compute its dealer gamma exposure. Shared by /api/gamma/[symbol] (per-name view) and the nightly
 * gamma-board scan so the two can never drift. Not client-safe (uses getOptions → network).
 */
import { getOptions } from "./options";
import { ivFromPrice } from "./blackScholes";
import { computeGamma, type GammaContract, type GammaExposure } from "./gammaExposure";

const MAX_EXP = 4; // near expiries carry the bulk of dealer gamma
const BAND = 0.4; // |ln(K/S)| — ignore deep-OTM strikes (negligible gamma + junk quotes)

const mid = (o: { bid: number | null; ask: number | null; last: number | null }): number | null =>
  o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : o.last != null && o.last > 0 ? o.last : null;

export interface LoadedGamma {
  gex: GammaExposure;
  spot: number;
  expiries: { date: string; dte: number }[];
}

/**
 * Build GammaContract[] from the nearest `maxExp` future expiries (IV solved from mid, vendor IV fallback)
 * and run computeGamma. `fetchChain` is injected so callers reuse their own throttle/retry harness; it
 * defaults to a plain getOptions. Returns null if the chain is missing or too thin to be meaningful.
 */
export async function loadGamma(
  sym: string,
  fetchChain: (sym: string, date?: string) => Promise<any> = (s, d) => getOptions(s, d),
  maxExp = MAX_EXP,
): Promise<LoadedGamma | null> {
  const base = await fetchChain(sym).catch(() => null);
  if (!base?.underlying || !base.expirations?.length) return null;
  const S = base.underlying;
  const now = Date.now();
  const future = base.expirations.filter((e: string) => Date.parse(e + "T00:00:00Z") - now > 0.5 * 86_400_000).sort();
  if (!future.length) return null;
  const picks = future.slice(0, maxExp);
  const chains = await Promise.all(picks.map((e: string) => (e === base.selected ? Promise.resolve(base) : fetchChain(sym, e).catch(() => null))));

  const contracts: GammaContract[] = [];
  const expiries: { date: string; dte: number }[] = [];
  for (const ch of chains) {
    if (!ch?.selected || !ch.underlying) continue;
    const T = (Date.parse(ch.selected + "T00:00:00Z") - now) / (365 * 86_400_000);
    if (T <= 0) continue;
    let any = false;
    for (const kind of ["call", "put"] as const) {
      for (const o of kind === "call" ? ch.calls : ch.puts) {
        const oi = o.oi;
        if (!(oi != null && oi > 0)) continue;
        if (Math.abs(Math.log(o.strike / S)) > BAND) continue;
        const m = mid(o);
        let sig = m != null && m > 0 ? ivFromPrice(kind, S, o.strike, T, m) : null;
        if (sig == null || sig <= 0) sig = o.iv != null && o.iv > 0 ? o.iv : null;
        if (sig == null || sig < 0.02 || sig > 4) continue;
        contracts.push({ kind, strike: o.strike, T, sig, oi });
        any = true;
      }
    }
    if (any) expiries.push({ date: ch.selected, dte: Math.round(T * 365) });
  }
  if (contracts.length < 4) return null;
  const gex = computeGamma(contracts, S, 0.25);
  return gex ? { gex, spot: S, expiries } : null;
}
