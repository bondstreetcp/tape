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
