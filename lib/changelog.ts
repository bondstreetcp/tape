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
    id: "2026-08-28-wheel-suite",
    date: "2026-08-28",
    title: "A full theta-wheel workbench",
    items: [
      "Any stock → the new Wheel tab — reads the live options chain and names a strike + expiry for BOTH legs: sell a covered call, sell a cash-secured put to enter, or roll an open call. Conservative / balanced / aggressive picks by delta, expiry × moneyness yield grids, a payoff diagram, a premium-rich check (current IV vs realized vol), a “does this name wheel well?” backtest, and guards for both earnings and ex-dividend dates (early-assignment risk).",
      "Put-Writing & Covered-Call screeners now sort by a Wheel score — annualized yield × assignment-comfort (~0.2–0.35Δ) × quality, minus an earnings penalty — so good wheels rank up top, alongside a one-click “clear of earnings” filter.",
      "New Wheel Tracker (Options → Income) — log your active wheels (which leg, shares, cost basis, premium collected), watch your adjusted basis grind down, and get a roll reminder as your short calls near expiry. Stays in your browser.",
    ],
  },
  {
    id: "2026-08-27i",
    date: "2026-08-27",
    title: "A macro build-out — valuation, real-economy, positioning, energy, surprises, attention & free options",
    items: [
      "Macro → Real economy — a free, 48-series dashboard across 11 groups: activity, recession watch, manufacturing, services, freight, consumer, prices & inflation, money & credit, labor, travel and housing. Every card opens a timeframed chart with a plain-English explainer, topped by an AI desk read.",
      "Macro → Valuation — long-run log-price trend channels (±1σ/2σ bands) for the S&P 500 (fit since 1932), Nasdaq, Russell 2000 and the 11 GICS sectors, ranked cheap → dear. Descriptive, not predictive.",
      "Macro → Positioning — CFTC Commitments of Traders across index, rate, FX, energy, metal, ag & bitcoin futures, with a 5-year crowding percentile (the contrarian read).",
      "Macro → Energy — WTI / Brent / Henry Hub + US retail gasoline & diesel, plus the EIA weekly balance: inventories vs their 5-yr seasonal norm, production, refinery runs and implied demand.",
      "Macro → Surprises — a home-built Economic Surprise Index (US data actual vs consensus, standardized and time-decayed) with a running beats-and-misses table that deepens each week.",
      "Macro → Attention — Wikipedia pageviews as a free demand proxy, with an “attention spike” score that flags a name suddenly in the public eye.",
      "Screens → Free Options — a screener for reasonably-priced names with under-appreciated multi-year earnings power (low PEG / 3-yr-out P/E, rising estimates, a real runway).",
      "Earnings — relative-strength-vs-sector flags on the technical setup, a cleaner reorganized tab, and collapsible AI reads.",
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
