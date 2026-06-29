// Single source of truth for the app's navigable features. Powers the nav dropdowns
// (with one-line descriptions), the ⌘K command palette, and the "Start here" map —
// so a newcomer can find and understand every feature without clicking blind.

export type NavGroup = "Markets" | "Strategies" | "Research";
export type Job = "Track the market" | "Find ideas" | "Research a name" | "Income strategies";

export interface NavItem {
  label: string;
  path: string; // appended to /u/[universe]; "" = the universe home
  desc: string; // one-line, plain-English (assume the reader isn't a finance pro)
  group?: NavGroup; // dropdown group; omitted for the always-visible top links
  job: Job; // job-to-be-done bucket for the Start-here map
  kw?: string; // extra search keywords for the palette
}

// Always-visible top-level links.
export const TOP_LINKS: NavItem[] = [
  { label: "Home", path: "", desc: "Market overview — the index, sectors, and biggest movers", job: "Track the market", kw: "dashboard overview" },
  { label: "Morning Desk", path: "/morning-desk", desc: "AI overnight brief — what moved overnight and why", job: "Track the market", kw: "ai brief notes overnight" },
  { label: "Daily Briefing", path: "/briefing", desc: "The day's market news wire", job: "Track the market", kw: "news reuters wire" },
  { label: "Screener", path: "/screener", desc: "Filter the whole universe by return, valuation, and quality", job: "Find ideas", kw: "filter screen factors" },
  { label: "Watchlist", path: "/watchlist", desc: "Your saved names, with a daily AI digest", job: "Research a name", kw: "saved favorites star" },
];

// Grouped (dropdown) features.
export const FEATURES: NavItem[] = [
  // ── Markets
  { label: "Heatmap", path: "/heatmap", desc: "Treemap of the market — tile size = market cap, color = return", group: "Markets", job: "Track the market", kw: "treemap map sectors" },
  { label: "Cross-Asset Monitor", path: "/market", desc: "Stocks, rates, FX, commodities, and crypto on one screen", group: "Markets", job: "Track the market", kw: "macro assets bonds fx commodities" },
  { label: "Sector Rotation", path: "/rotation", desc: "Which sectors are leading and which are lagging", group: "Markets", job: "Track the market", kw: "sectors leaders laggards" },
  { label: "Leaders Board", path: "/leaders", desc: "Every name ranked by relative strength, with momentum quadrants and breakouts", group: "Markets", job: "Find ideas", kw: "relative strength rs leaders laggards momentum breakout rrg ibd trend" },
  { label: "Options Flow", path: "/flow", desc: "Unusually large options trades across the S&P 500", group: "Markets", job: "Find ideas", kw: "options unusual calls puts premium" },
  { label: "Earnings Calendar", path: "/earnings", desc: "Who reports when, with the options-implied move", group: "Markets", job: "Find ideas", kw: "earnings dates report calendar" },
  { label: "Macro & Rates", path: "/macro", desc: "Yield curve, inflation, growth, and credit spreads (FRED)", group: "Markets", job: "Track the market", kw: "fred yields inflation rates economy" },
  { label: "Breadth & Regime", path: "/breadth", desc: "Market internals — how many names participate, plus the macro risk backdrop", group: "Markets", job: "Track the market", kw: "breadth internals advance decline new highs lows above 200 day ma participation t2108 regime risk-on risk-off" },
  // ── Strategies
  { label: "Put-Writing", path: "/put-writing", desc: "Cash-secured puts on quality names, fairly priced", group: "Strategies", job: "Income strategies", kw: "options income sell puts premium" },
  { label: "Covered-Call", path: "/covered-call", desc: "Covered-call income on stocks you'd hold", group: "Strategies", job: "Income strategies", kw: "options income sell calls" },
  { label: "Credit Spreads", path: "/credit-spreads", desc: "Bull-put and iron-condor setups ranked by reward vs risk", group: "Strategies", job: "Income strategies", kw: "options spreads iron condor" },
  { label: "Earnings Move", path: "/earnings-move", desc: "Where options over- or under-price an earnings event", group: "Strategies", job: "Find ideas", kw: "earnings straddle implied move volatility" },
  { label: "Earnings Setup Cards", path: "/earnings-setup", desc: "Glanceable cards of upcoming reporters — implied vs. historical move, rich/cheap", group: "Strategies", job: "Find ideas", kw: "earnings setup cards implied move straddle reporting this week" },
  { label: "CEF Screener", path: "/cef", desc: "Closed-end funds trading at a discount to their NAV", group: "Strategies", job: "Income strategies", kw: "closed end funds discount nav yield" },
  { label: "CEF Discount Hunter", path: "/cef-hunter", desc: "The scored shortlist of the most stretched closed-end-fund discounts", group: "Strategies", job: "Income strategies", kw: "cef closed end fund discount hunter stretched z-score yield" },
  { label: "Backtest", path: "/backtest", desc: "Test factor screens and strategies against history", group: "Strategies", job: "Find ideas", kw: "backtest strategy momentum factor" },
  // ── Research
  { label: "Confluence Engine", path: "/confluence", desc: "Names where several independent bullish signals stack up — the flagship idea scanner", group: "Research", job: "Find ideas", kw: "confluence signals ideas opportunities value smart money setups" },
  { label: "Smart-Money Radar", path: "/smart-money", desc: "Who's quietly accumulating — super-investor 13F adds + Congress buys, dip-buys flagged", group: "Research", job: "Find ideas", kw: "smart money insiders accumulation 13f congress buying dip institutional" },
  { label: "Factor-Screen Overlap", path: "/factor-overlap", desc: "Names that top several value/quality screens at once — the best all-round profiles", group: "Research", job: "Find ideas", kw: "factor screens overlap value quality magic formula piotroski composite" },
  { label: "Overnight Filings", path: "/overnight", desc: "AI desk notes on new material SEC filings (8-K/10-Q/10-K)", group: "Research", job: "Find ideas", kw: "sec edgar filings 8-k 10-q ai superanalyst" },
  { label: "Discount to History", path: "/valuation-history", desc: "Names trading cheap vs their own 10-year valuation", group: "Research", job: "Find ideas", kw: "valuation cheap multiple discount mean reversion" },
  { label: "Compare Stocks", path: "/compare-stocks", desc: "Two+ stocks side by side, with an AI verdict", group: "Research", job: "Research a name", kw: "compare versus head to head" },
  { label: "Sector Compare", path: "/compare", desc: "Compare the industries inside a sector", group: "Research", job: "Research a name", kw: "industry compare sector" },
  { label: "Super-Investors", path: "/superinvestors", desc: "Famous-investor 13F holdings and quarter-over-quarter changes", group: "Research", job: "Find ideas", kw: "13f buffett hedge funds holdings managers" },
  { label: "Congress Trades", path: "/congress", desc: "Members of Congress' stock trades (STOCK Act)", group: "Research", job: "Find ideas", kw: "congress senate house pelosi trades politicians" },
  { label: "Filings & Docs", path: "/research", desc: "Browse and AI-summarize a company's SEC filings", group: "Research", job: "Research a name", kw: "filings documents sec edgar summary" },
  { label: "Research Desk", path: "/research-desk", desc: "Upload sell-side PDFs → searchable, cross-broker synthesis", group: "Research", job: "Research a name", kw: "research pdf upload broker analyst report" },
];

export const ALL_NAV: NavItem[] = [...TOP_LINKS, ...FEATURES];
export const NAV_GROUPS: NavGroup[] = ["Markets", "Strategies", "Research"];
export const JOBS: Job[] = ["Track the market", "Find ideas", "Research a name", "Income strategies"];
export const JOB_BLURB: Record<Job, string> = {
  "Track the market": "See what's happening right now across the market.",
  "Find ideas": "Surface interesting names and setups to look into.",
  "Research a name": "Dig into a single company in depth.",
  "Income strategies": "Options and fund screens for generating yield.",
};
