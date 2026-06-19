import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
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

export async function getOptions(symbol: string, date?: string): Promise<OptionChain> {
  const opts: any = {};
  if (date) opts.date = new Date(date + "T00:00:00Z");
  const r: any = await yf.options(symbol, opts, { validateResult: false });
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
