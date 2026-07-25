import { yahoo } from "./yahooClient";
import { memo } from "./memoCache";

const n = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface Opt {
  strike: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  vol: number | null;
  oi: number | null;
  iv: number | null;
  itm: boolean;
}

export interface OptionChain {
  underlying: number | null;
  expirations: string[];
  selected: string | null;
  calls: Opt[];
  puts: Opt[];
}

const map = (x: any): Opt => ({
  strike: x.strike,
  last: n(x.lastPrice),
  bid: n(x.bid),
  ask: n(x.ask),
  vol: n(x.volume),
  oi: n(x.openInterest),
  iv: n(x.impliedVolatility),
  itm: !!x.inTheMoney,
});

/**
 * THE options choke point. Opening a stock's Options tab fans out to ~26 chain fetches across four
 * routes (/api/options in three modes incl. the 8-expiry term structure, /api/iv-surface's 8, and
 * /api/gamma's 4 — requested TWICE concurrently by two mounted cards), and every one of them lands
 * here. On Vercel the CDN absorbed the repeat views; the NAS origin has no CDN, so memoizing this ONE
 * function is what makes the tab quick — and the in-flight dedup collapses the concurrent duplicates
 * into a single request instead of racing Yahoo with two identical bursts.
 *
 * 5-minute TTL: chains move intraday, but not within one tab-open. cacheIf skips the empty shape so a
 * throttled response never pins "no chain" for five minutes. Nightly scripts share the memo harmlessly
 * — each runs in a short-lived process, so it only ever dedups within that run.
 */
export async function getOptions(symbol: string, date?: string): Promise<OptionChain> {
  return memo(
    `opt:${symbol.toUpperCase()}:${date || "near"}`,
    300_000,
    () => fetchOptions(symbol, date),
    { cacheIf: (c) => c.underlying != null && (c.calls.length > 0 || c.puts.length > 0) },
  );
}

async function fetchOptions(symbol: string, date?: string): Promise<OptionChain> {
  const opts: any = {};
  if (date) opts.date = new Date(date + "T00:00:00Z");
  const r: any = await yahoo.options(symbol, opts, { validateResult: false });
  const expirations: string[] = (r.expirationDates || []).map((d: any) =>
    new Date(d).toISOString().slice(0, 10),
  );
  const o = r.options?.[0];
  return {
    underlying: n(r.quote?.regularMarketPrice),
    expirations,
    selected: o ? new Date(o.expirationDate).toISOString().slice(0, 10) : date || null,
    calls: (o?.calls || []).map(map),
    puts: (o?.puts || []).map(map),
  };
}

function atmIV(chain: OptionChain): number | null {
  const u = chain.underlying;
  if (!u) return null;
  const strikes = [...new Set([...chain.calls, ...chain.puts].map((o) => o.strike))];
  if (!strikes.length) return null;
  const atm = strikes.reduce((a, b) => (Math.abs(b - u) < Math.abs(a - u) ? b : a));
  const c = chain.calls.find((o) => o.strike === atm)?.iv;
  const p = chain.puts.find((o) => o.strike === atm)?.iv;
  const vals = [c, p].filter((v): v is number => v != null && v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export interface TermPoint { date: string; dte: number; atmIV: number | null }

/** ATM implied vol across a spread of expiries (the IV term structure). */
export async function getTermStructure(symbol: string, maxPoints = 8): Promise<{ underlying: number | null; points: TermPoint[] }> {
  const base = await getOptions(symbol);
  const exps = base.expirations;
  if (!exps.length) return { underlying: base.underlying, points: [] };
  const step = Math.max(1, Math.floor(exps.length / maxPoints));
  const picked = exps.filter((_, i) => i % step === 0).slice(0, maxPoints);
  const now = Date.now();
  const results = await Promise.all(
    picked.map(async (date): Promise<TermPoint | null> => {
      try {
        const chain = date === base.selected ? base : await getOptions(symbol, date);
        return { date, dte: Math.round((new Date(date + "T00:00:00Z").getTime() - now) / 86_400_000), atmIV: atmIV(chain) };
      } catch {
        return null;
      }
    }),
  );
  return { underlying: base.underlying, points: results.filter((p): p is TermPoint => !!p && p.atmIV != null) };
}
