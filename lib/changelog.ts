/**
 * The user-facing "What's new" changelog. Newest entry first. Bump the TOP entry's `id` whenever you
 * want the splash to re-appear for everyone (it's keyed on that id in localStorage), so routine deploys
 * don't nag — only a real, summarized release does. CLIENT-SAFE: plain data, imported by <WhatsNew/>.
 */
export interface ChangelogEntry {
  id: string; // stable key for the "seen" check — bump to re-show the splash
  date: string; // YYYY-MM-DD
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-08-27e",
    date: "2026-08-27",
    title: "A macro build-out — valuation, real-economy, positioning, energy, surprises, attention & free options",
    items: [
      "Macro → Real economy — a free dashboard of primary-source alt-data across the whole economy: broad activity (Chicago Fed CFNAI, the Weekly Economic Index, financial conditions), manufacturing (regional-Fed PMIs — the free ISM stand-in — industrial production, capacity use, core capex), freight (rail carloads/intermodal, a truck-freight index + the Cass Freight Index, inventories-to-sales), the consumer (retail sales, durable goods, autos), the labor market (weekly jobless claims), air travel (TSA), and housing (starts, permits, new-home sales, the 30-yr mortgage). Every card clicks into a full chart with selectable timeframes + labeled axes and a hover explainer, topped by an AI desk read of what it's signaling.",
      "Macro → Valuation — long-run trend channels: a log-price regression with ~68%/95% bands showing how far the S&P 500 (fit since 1932), Nasdaq, Russell 2000, and all 11 GICS sectors (ranked cheap → dear) sit above or below their own long-term growth trend, with a z-score gauge. Descriptive, not predictive.",
      "Macro → Positioning — CFTC Commitments of Traders across the key equity-index, rate, FX, energy, metal, ag & bitcoin futures: where large speculators are net long or short, and how crowded that is vs its own 5-year range (the contrarian read — a crowded long is fuel for a squeeze lower). Free CFTC data, published weekly.",
      "Macro → Energy — the oil & gas complex as a real-economy read: benchmark & retail prices (WTI, Brent, Henry Hub, US gasoline & diesel) plus the EIA weekly balance — crude/gasoline/distillate inventories and nat-gas storage with the weekly build/draw vs the 5-yr seasonal norm, and supply & demand (US production, refinery utilization, and product supplied = implied demand). Prices are keyless and live; the EIA half fills in once a free key is set.",
      "Macro → Surprises — a home-built Economic Surprise Index: each US release's actual vs the consensus forecast, standardized and summed with a ~90-day decay (positive = data mostly beating). It captures surprises as releases print, so it deepens week by week, with a running table of the latest beats & misses by category.",
      "Macro → Attention — public interest as a free demand proxy: daily Wikipedia pageviews for a curated set of tickers (big tech, consumer/retail, meme names) plus economic-anxiety topics, with an 'attention spike' score (this week vs the trailing 90-day norm) that flags a name suddenly in the public eye.",
      "Screens → Free Options — a single-stock screener for reasonably-priced names with under-appreciated multi-year earnings power: growth handed to you cheap (low PEG / 3-yr-out P/E) with rising estimates and a real revenue runway, quality-filtered, ranked and explained per name.",
      "Earnings — the technical setup now flags relative strength vs the stock's sector (leading or lagging), the whole tab is reorganized into clear, scannable sections, and the AI desk reads fold away until you want them.",
    ],
  },
  {
    id: "2026-08-25",
    date: "2026-08-25",
    title: "Staples Scanner, a live news wire & sharper earnings tools",
    items: [
      "New Staples Scanner (Screens → Staples Scanner) — NielsenIQ US retail demand & share for consumer staples: an AI desk read, sortable inline momentum sparklines, a ~2-week-lagged leading read on each name's quarter, and a new alert (Alerts → Signal → “Staples scanner inflection”) when a name accelerates or decelerates into its print.",
      "New Market Wire (Markets → Market Wire, plus tabs on Daily Desk & Macro and a scrolling ticker on every page) — Walter Bloomberg's curated flashes leading, then Reuters / Bloomberg / CNBC / WSJ. Clickable $tickers jump to the stock, it refreshes ~every 2 min with NEW flags, and the flashes now feed the AI daily brief.",
      "Macro — live “Recent releases” straight from BEA & BLS (GDP, CPI, jobs, PCE), the moment they print.",
      "Earnings — plain-English AI reads of “what are the options positioned for?” and the “technical setup” into the print; the AI preview factors in the Nielsen scanner for staples names; and the expected-move chart no longer clips outlier prints.",
      "Fixes across the board — realized-vol cone & dislocation sorting, IPO lockups, the backtest timeframe toggle, spin-off returns, merger-arb links, and the catalyst calendar.",
    ],
  },
];

export const LATEST = CHANGELOG[0];
