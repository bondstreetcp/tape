/**
 * "Super-investors" — a curated roster of famous value / long-term managers and their
 * latest SEC Form 13F-HR holdings (quarterly U.S. equity positions, ~45-day lag). The
 * heavy lifting (fetch, parse, CUSIP→ticker, quarter-over-quarter deltas) happens offline
 * in scripts/refresh-13f.ts, which writes data/superinvestors.json; this module just owns
 * the roster, the shared types, and the snapshot loader.
 *
 * 13F caveats worth knowing: it covers only U.S.-listed long equity (no shorts, cash,
 * bonds, or foreign listings), is filed up to 45 days after quarter-end, and a few
 * managers get confidential treatment for building positions — so it's a lagged, partial
 * view, not a live portfolio.
 */
import { promises as fsp } from "fs";
import path from "path";

export interface Investor {
  slug: string;
  name: string; // fund / firm name
  manager: string; // the person
  cik: string; // SEC CIK (10-digit, unpadded ok)
  blurb: string; // one-line style description
}

export type Change = "new" | "add" | "trim" | "hold";

export interface Holding {
  ticker: string | null; // null when CUSIP→ticker couldn't be resolved (small/odd names)
  name: string; // issuer name as filed
  cusip: string;
  cls: string; // title of class (COM, etc.)
  value: number; // $ market value
  shares: number;
  pct: number; // % of the 13F portfolio
  change: Change;
  deltaShares: number | null; // vs prior quarter (null when new)
  deltaPct: number | null; // share-count change vs prior quarter
}

export interface InvestorPortfolio extends Investor {
  asOf: string; // report period end (YYYY-MM-DD)
  filedAt: string; // filing date
  priorAsOf: string | null;
  totalValue: number;
  count: number;
  holdings: Holding[]; // sorted by value desc
  newBuys: { ticker: string | null; name: string; value: number; pct: number }[];
  soldOut: { ticker: string | null; name: string; cusip: string }[];
  topAdds: { ticker: string | null; name: string; deltaPct: number }[];
  topTrims: { ticker: string | null; name: string; deltaPct: number }[];
}

export interface MostOwned {
  ticker: string | null;
  name: string;
  cusip: string;
  holders: string[]; // investor slugs
  holderCount: number;
  totalValue: number;
}

export interface SuperInvestorsData {
  generatedAt: string;
  investors: InvestorPortfolio[];
  mostOwned: MostOwned[];
}

// The roster. CIKs verified against EDGAR (entity name + active 13F-HR filings). The
// refresh script drops any that go stale (no filing in the last ~3 quarters), so a manager
// winding down their 13F simply falls off rather than showing a years-old book.
export const INVESTORS: Investor[] = [
  { slug: "berkshire", name: "Berkshire Hathaway", manager: "Warren Buffett", cik: "1067983", blurb: "Quality businesses at fair prices; decades-long holds." },
  { slug: "himalaya", name: "Himalaya Capital", manager: "Li Lu", cik: "1709323", blurb: "Concentrated, long-term compounding; Munger's pick." },
  { slug: "akre", name: "Akre Capital", manager: "Chuck Akre", cik: "1112520", blurb: "“Three-legged stool”: great business, management, reinvestment." },
  { slug: "pershing", name: "Pershing Square", manager: "Bill Ackman", cik: "1336528", blurb: "Concentrated activist stakes in high-quality franchises." },
  { slug: "baupost", name: "Baupost Group", manager: "Seth Klarman", cik: "1061768", blurb: "Margin-of-safety value; deep contrarian and special situations." },
  { slug: "valueact", name: "ValueAct Capital", manager: "Mason Morfit", cik: "1418814", blurb: "Constructive activist; concentrated quality compounding." },
  { slug: "markel", name: "Markel Group", manager: "Tom Gayner", cik: "1096343", blurb: "Insurance float invested in durable compounders." },
  { slug: "gotham", name: "Gotham Asset Mgmt", manager: "Joel Greenblatt", cik: "1510387", blurb: "“Magic formula”: high returns on capital, cheap." },
  { slug: "greenhaven", name: "Greenhaven Associates", manager: "Edgar Wachenheim", cik: "846222", blurb: "Concentrated, patient deep-value in out-of-favor names." },
  { slug: "dodgecox", name: "Dodge & Cox", manager: "Investment Committee", cik: "200217", blurb: "Patient, fundamental value; low-turnover large caps." },
  { slug: "tweedy", name: "Tweedy Browne", manager: "Tweedy, Browne Co.", cik: "732905", blurb: "Graham-style value; the original net-net shop." },
  { slug: "fairholme", name: "Fairholme Capital", manager: "Bruce Berkowitz", cik: "1056831", blurb: "Highly concentrated, contrarian deep value." },
  { slug: "thirdpoint", name: "Third Point", manager: "Daniel Loeb", cik: "1040273", blurb: "Event-driven and activist; flexible value." },
  { slug: "appaloosa", name: "Appaloosa", manager: "David Tepper", cik: "1656456", blurb: "Opportunistic value; distressed and macro-aware." },
  { slug: "duquesne", name: "Duquesne Family Office", manager: "Stanley Druckenmiller", cik: "1536411", blurb: "Top-down macro meets concentrated stock-picking." },
  { slug: "scion", name: "Scion Asset Mgmt", manager: "Michael Burry", cik: "1649339", blurb: "Contrarian deep value; sporadic, high-conviction bets." },
];

export const INVESTOR_BY_SLUG: Record<string, Investor> = Object.fromEntries(INVESTORS.map((i) => [i.slug, i]));

let _cache: Promise<SuperInvestorsData | null> | null = null;

export function loadSuperInvestors(): Promise<SuperInvestorsData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "superinvestors.json"), "utf8")
      .then((s) => JSON.parse(s) as SuperInvestorsData)
      .catch(() => null);
  return _cache;
}
