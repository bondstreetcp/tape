import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

const num = (v: any): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export type AssetKind = "index" | "rate" | "fx" | "commodity" | "crypto";

export interface Tile {
  sym: string;
  name: string;
  kind: AssetKind;
  price: number | null;
  change: number | null;
  changePct: number | null;
}
export interface MarketGroup {
  name: string;
  kind: AssetKind;
  tiles: Tile[];
}

const GROUPS: { name: string; kind: AssetKind; syms: [string, string][] }[] = [
  {
    name: "Equity Indices",
    kind: "index",
    syms: [
      ["^GSPC", "S&P 500"],
      ["^DJI", "Dow Jones"],
      ["^IXIC", "Nasdaq Comp"],
      ["^RUT", "Russell 2000"],
      ["^VIX", "VIX"],
      ["^FTSE", "FTSE 100"],
      ["^GDAXI", "DAX"],
      ["^STOXX50E", "Euro Stoxx 50"],
      ["^N225", "Nikkei 225"],
      ["^HSI", "Hang Seng"],
    ],
  },
  {
    name: "Rates & Bonds",
    kind: "rate",
    syms: [
      ["^IRX", "3-Month"],
      ["^FVX", "5-Year"],
      ["^TNX", "10-Year"],
      ["^TYX", "30-Year"],
    ],
  },
  {
    name: "Currencies",
    kind: "fx",
    syms: [
      ["DX-Y.NYB", "US Dollar Index"],
      ["EURUSD=X", "EUR / USD"],
      ["USDJPY=X", "USD / JPY"],
      ["GBPUSD=X", "GBP / USD"],
      ["USDCNY=X", "USD / CNY"],
      ["USDCAD=X", "USD / CAD"],
    ],
  },
  {
    name: "Commodities",
    kind: "commodity",
    syms: [
      ["CL=F", "WTI Crude"],
      ["BZ=F", "Brent Crude"],
      ["GC=F", "Gold"],
      ["SI=F", "Silver"],
      ["HG=F", "Copper"],
      ["NG=F", "Nat Gas"],
    ],
  },
  {
    name: "Crypto",
    kind: "crypto",
    syms: [
      ["BTC-USD", "Bitcoin"],
      ["ETH-USD", "Ethereum"],
      ["SOL-USD", "Solana"],
      ["BNB-USD", "BNB"],
    ],
  },
];

export async function getMarketMonitor(): Promise<{ groups: MarketGroup[]; asOf: string }> {
  const all = GROUPS.flatMap((g) => g.syms.map(([s]) => s));
  const qmap = new Map<string, any>();
  try {
    const qs = (await yf.quote(all, {}, { validateResult: false })) as any[];
    for (const q of qs) if (q?.symbol) qmap.set(q.symbol, q);
  } catch {
    // per-symbol fallback so one bad ticker doesn't blank the board
    for (const s of all) {
      try {
        const q = await yf.quote(s, {}, { validateResult: false });
        if (q?.symbol) qmap.set(q.symbol, q);
      } catch {
        /* skip */
      }
    }
  }
  const groups: MarketGroup[] = GROUPS.map((g) => ({
    name: g.name,
    kind: g.kind,
    tiles: g.syms.map(([sym, name]) => {
      const q = qmap.get(sym);
      return {
        sym,
        name,
        kind: g.kind,
        price: num(q?.regularMarketPrice),
        change: num(q?.regularMarketChange),
        changePct: num(q?.regularMarketChangePercent),
      };
    }),
  }));
  return { groups, asOf: new Date().toISOString() };
}
