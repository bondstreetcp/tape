/**
 * Portfolio analytics — turns a list of positions (symbol + shares; negative = short) plus per-name
 * market data into exposure, concentration, beta, and a market-shock scenario. Pure + fs-free so it's
 * unit-tested (tests/portfolio.test.ts) and runs on the client (the cockpit fetches per-name data from
 * /api/portfolio, which computes beta off the stored series server-side).
 */

export interface Position {
  symbol: string;
  shares: number; // negative = short
}

export interface NameData {
  symbol: string;
  name?: string;
  price: number;
  sector?: string;
  marketCap?: number;
  capBucket?: string; // explicit size bucket (ETFs); stocks are bucketed from marketCap
  beta?: number | null; // vs the market (SPY), from the stored series
  ret?: number | null; // % return over the selected timeframe
}

export interface Holding extends NameData {
  shares: number;
  value: number; // shares × price (signed)
  weight: number; // value / gross exposure (signed; Σ|weight| = 1)
}

export interface SectorExposure {
  sector: string;
  value: number; // net $ in the sector
  weight: number; // net value / gross
}

/** Market-cap size buckets, largest → smallest, for the size-exposure breakdown. */
export const CAP_ORDER = ["Mega", "Large", "Mid", "Small", "Micro"] as const;
export type CapBucket = (typeof CAP_ORDER)[number];

/** Map a market cap ($) to a size bucket. null if unknown / non-positive. */
export function capBucketOf(marketCap: number | null | undefined): CapBucket | null {
  if (marketCap == null || !(marketCap > 0)) return null;
  if (marketCap >= 200e9) return "Mega";
  if (marketCap >= 10e9) return "Large";
  if (marketCap >= 2e9) return "Mid";
  if (marketCap >= 300e6) return "Small";
  return "Micro";
}

export interface CapExposure {
  bucket: string;
  value: number; // net $ in the size bucket
  weight: number; // net value / gross
}

/**
 * Exposures as fractions of account equity (AUM) — the way an allocator reads a book
 * ("133% net long") rather than a pod's dollar P&L. Signed like their $ counterparts;
 * ×100 for a percent. Null on the parent stats when there's no usable AUM.
 */
export interface ExposurePct {
  gross: number; // Σ|value| / aum
  net: number; // net / aum
  long: number; // long / aum
  short: number; // short / aum (≤ 0)
  betaAdj: number | null; // Σ value·β / aum (beta-adjusted net; null if no name has a beta)
}

export interface PortfolioStats {
  holdings: Holding[]; // priced positions, sorted by |value| desc
  missing: string[]; // positions with no price data
  gross: number; // Σ |value|
  net: number; // Σ value (long − short)
  longValue: number;
  shortValue: number; // ≤ 0
  bySector: SectorExposure[]; // sorted by |value| desc
  byCap: CapExposure[]; // net exposure per market-cap bucket, in CAP_ORDER
  concentration: { top1: number; top5: number; hhi: number }; // fractions of gross (0..1)
  beta: number | null; // net beta per $ gross (over names with a beta)
  betaCoverage: number; // fraction of gross that has a beta
  ret: number | null; // gross-weighted timeframe return, % (over names with a ret)
  aum: number | null; // account equity (the % divisor); null when not provided or ≤ 0
  betaDollar: number | null; // Σ value·β — beta-adjusted net $ exposure (null if no betas)
  exposurePct: ExposurePct | null; // exposures as fractions of AUM; null without a usable AUM
}

/**
 * Parse a free-text positions blob into merged positions. One per line: `SYMBOL SHARES`, e.g.
 * `AAPL 100`, `TSLA -50` (short), `BRK.B 1,000`. Comma or whitespace between symbol and shares;
 * thousands separators + a leading $ are tolerated; `#`/`//` lines are comments. Dupes are summed,
 * net-zero lines dropped. Pure so the cockpit and a unit test share it.
 */
export function parsePositions(text: string): Position[] {
  const merged = new Map<string, number>();
  const order: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const m = line.match(/^\$?([A-Za-z][A-Za-z.\-]{0,9})[\s,]+(-?\$?[\d,]*\.?\d+)/);
    if (!m) continue;
    const symbol = m[1].toUpperCase();
    const shares = Number(m[2].replace(/[$,]/g, ""));
    if (!Number.isFinite(shares) || shares === 0) continue;
    if (!merged.has(symbol)) order.push(symbol);
    merged.set(symbol, (merged.get(symbol) ?? 0) + shares);
  }
  return order.map((symbol) => ({ symbol, shares: merged.get(symbol)! })).filter((p) => p.shares !== 0);
}

/**
 * Merge a delta book into a base book (what-if): sum shares per symbol, drop net-zero lines. `delta`
 * shares are signed — positive buys/covers, negative trims/shorts. Pure so the cockpit's before/after
 * simulation and a unit test share it.
 */
export function mergePositions(base: Position[], delta: Position[]): Position[] {
  const m = new Map<string, number>();
  const order: string[] = [];
  for (const p of [...base, ...delta]) {
    const sym = p.symbol.toUpperCase();
    if (!m.has(sym)) order.push(sym);
    m.set(sym, (m.get(sym) ?? 0) + p.shares);
  }
  return order.map((symbol) => ({ symbol, shares: m.get(symbol)! })).filter((p) => p.shares !== 0);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function computePortfolio(
  positions: Position[],
  data: Map<string, NameData>,
  aum: number | null = null,
): PortfolioStats {
  const holdings: Holding[] = [];
  const missing: string[] = [];
  for (const p of positions) {
    const d = data.get(p.symbol.toUpperCase());
    if (!d || !(d.price > 0) || !Number.isFinite(p.shares) || p.shares === 0) {
      if (p.shares) missing.push(p.symbol.toUpperCase());
      continue;
    }
    holdings.push({ ...d, shares: p.shares, value: p.shares * d.price, weight: 0 });
  }
  const gross = sum(holdings.map((h) => Math.abs(h.value)));
  const net = sum(holdings.map((h) => h.value));
  const longValue = sum(holdings.filter((h) => h.value > 0).map((h) => h.value));
  const shortValue = sum(holdings.filter((h) => h.value < 0).map((h) => h.value));
  for (const h of holdings) h.weight = gross ? h.value / gross : 0;
  holdings.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  // Sector exposure (net $ per sector).
  const secMap = new Map<string, number>();
  for (const h of holdings) secMap.set(h.sector || "—", (secMap.get(h.sector || "—") ?? 0) + h.value);
  const bySector: SectorExposure[] = [...secMap.entries()]
    .map(([sector, value]) => ({ sector, value, weight: gross ? value / gross : 0 }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  // Market-cap (size) exposure (net $ per bucket). Stocks bucket from marketCap; ETFs carry an explicit
  // capBucket (a representative size) so an ETF hedge shifts the size mix too.
  const capMap = new Map<string, number>();
  for (const h of holdings) {
    const b = h.capBucket ?? capBucketOf(h.marketCap);
    if (b) capMap.set(b, (capMap.get(b) ?? 0) + h.value);
  }
  const byCap: CapExposure[] = (CAP_ORDER as readonly string[])
    .filter((b) => capMap.has(b))
    .map((bucket) => ({ bucket, value: capMap.get(bucket)!, weight: gross ? capMap.get(bucket)! / gross : 0 }));

  // Concentration (fractions of GROSS).
  const absW = holdings.map((h) => Math.abs(h.value) / (gross || 1)).sort((a, b) => b - a);
  const concentration = {
    top1: absW[0] ?? 0,
    top5: sum(absW.slice(0, 5)),
    hhi: sum(absW.map((w) => w * w)), // Herfindahl (0..1; 1 = single name)
  };

  // Net beta per $ gross, over names that HAVE a beta (report coverage so the number is honest).
  const betaNames = holdings.filter((h) => typeof h.beta === "number" && Number.isFinite(h.beta));
  const betaGross = sum(betaNames.map((h) => Math.abs(h.value)));
  const betaDollar = betaGross ? sum(betaNames.map((h) => h.value * (h.beta as number))) : null; // Σ value·β
  const beta = betaDollar == null ? null : betaDollar / gross;
  const betaCoverage = gross ? betaGross / gross : 0;

  // Gross-weighted timeframe return, over names with a ret.
  const retNames = holdings.filter((h) => typeof h.ret === "number" && Number.isFinite(h.ret));
  const retGross = sum(retNames.map((h) => Math.abs(h.value)));
  const ret = retGross ? sum(retNames.map((h) => Math.abs(h.value) * (h.ret as number))) / retGross : null;

  // Exposures as % of account equity. AUM must be a positive divisor; a missing or ≤ 0
  // value leaves every % null so the UI cleanly falls back to dollars / % of gross.
  const usableAum = aum != null && Number.isFinite(aum) && aum > 0 ? aum : null;
  const exposurePct: ExposurePct | null = usableAum
    ? {
        gross: gross / usableAum,
        net: net / usableAum,
        long: longValue / usableAum,
        short: shortValue / usableAum,
        betaAdj: betaDollar == null ? null : betaDollar / usableAum,
      }
    : null;

  return { holdings, missing, gross, net, longValue, shortValue, bySector, byCap, concentration, beta, betaCoverage, ret, aum: usableAum, betaDollar, exposurePct };
}

/** Estimated $ P&L (and % of gross) from a broad market move, via each holding's beta: Σ value·beta·move. */
export function scenarioPnL(stats: PortfolioStats, marketMovePct: number): { dollar: number; pct: number } {
  const m = marketMovePct / 100;
  let dollar = 0;
  for (const h of stats.holdings) if (typeof h.beta === "number" && Number.isFinite(h.beta)) dollar += h.value * (h.beta as number) * m;
  return { dollar, pct: stats.gross ? (dollar / stats.gross) * 100 : 0 };
}

/** Named historical market drawdowns/rallies (index peak-to-trough magnitudes) for the stress table. */
export const HISTORICAL_EPISODES: { name: string; move: number; note: string }[] = [
  { name: "GFC 2008", move: -55, note: "Oct '07 – Mar '09 peak-to-trough" },
  { name: "COVID crash", move: -34, note: "Feb – Mar 2020, 33 days" },
  { name: "2022 bear", move: -25, note: "Jan – Oct 2022" },
  { name: "Black Monday '87", move: -22, note: "one day, Oct 19 1987" },
  { name: "−10% correction", move: -10, note: "typical pullback" },
  { name: "+10% rally", move: 10, note: "" },
  { name: "+20% bull year", move: 20, note: "" },
];

export interface StressScenario { name: string; marketMovePct: number; dollar: number; note: string }

/** Beta-propagated P&L for each historical episode — a first-order guide (crises expand betas). */
export function stressScenarios(stats: PortfolioStats): StressScenario[] {
  return HISTORICAL_EPISODES.map((e) => ({
    name: e.name, marketMovePct: e.move, dollar: scenarioPnL(stats, e.move).dollar, note: e.note,
  }));
}
