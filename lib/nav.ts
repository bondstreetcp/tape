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
  // NOTE: when auth activates (docs/SETUP-auth.md), add an "Alerts" entry here — the page exists at
  // /alerts but is a dead-end ("accounts aren't configured") until then, so it stays out of the nav.
];

// Grouped (dropdown) features.
export const FEATURES: NavItem[] = [
  // ── Markets
  { label: "Heatmap", path: "/heatmap", desc: "Treemap of the market — tile size = market cap, color = return", group: "Markets", job: "Track the market", kw: "treemap map sectors" },
  { label: "Cross-Asset Monitor", path: "/market", desc: "Stocks, rates, FX, commodities, and crypto on one screen", group: "Markets", job: "Track the market", kw: "macro assets bonds fx commodities" },
  { label: "Sector Rotation", path: "/rotation", desc: "Which sectors are leading and which are lagging", group: "Markets", job: "Track the market", kw: "sectors leaders laggards" },
  { label: "Leaders Board", path: "/leaders", desc: "Every name ranked by relative strength, with momentum quadrants and breakouts", group: "Markets", job: "Find ideas", kw: "relative strength rs leaders laggards momentum breakout rrg ibd trend" },
  { label: "Options Flow", path: "/flow", desc: "Unusually large options trades across the S&P 500", group: "Markets", job: "Find ideas", kw: "options unusual calls puts premium" },
  { label: "Reddit Buzz", path: "/reddit-buzz", desc: "What retail is talking about — Reddit mention counts + 24h surge (r/wallstreetbets &c.)", group: "Markets", job: "Find ideas", kw: "reddit wallstreetbets wsb buzz mentions retail social sentiment apewisdom meme trending chatter" },
  { label: "Earnings Calendar", path: "/earnings", desc: "Who reports when, with the options-implied move", group: "Markets", job: "Find ideas", kw: "earnings dates report calendar" },
  { label: "Macro & Rates", path: "/macro", desc: "Yield curve, inflation, growth, and credit spreads (FRED)", group: "Markets", job: "Track the market", kw: "fred yields inflation rates economy" },
  { label: "Fixed Income", path: "/rates", desc: "The bond desk — curve spreads, inversion, and credit OAS in one view", group: "Markets", job: "Track the market", kw: "rates bonds curve inversion 2s10s oas credit spreads treasury fixed income" },
  { label: "Spinoff Turnover", path: "/spinoffs", desc: "Completed spinoffs with the share-register turnover clock — ~50% turned has historically marked the bottom", group: "Research", job: "Find ideas", kw: "spinoff spin-off turnover when-issued forced selling seller exhaustion greenblatt special situations bottom" },
  { label: "Fed Watch", path: "/fed", desc: "FOMC statements, minutes, speeches & the Beige Book — AI-scored hawkish↔dovish with what changed", group: "Markets", job: "Track the market", kw: "fed federal reserve fomc powell hawkish dovish rate cut hike minutes beige book monetary policy speeches" },
  { label: "Breadth & Regime", path: "/breadth", desc: "Market internals — how many names participate, plus the macro risk backdrop", group: "Markets", job: "Track the market", kw: "breadth internals advance decline new highs lows above 200 day ma participation t2108 regime risk-on risk-off" },
  // ── Strategies
  { label: "Put-Writing", path: "/put-writing", desc: "Cash-secured puts on quality names, fairly priced", group: "Strategies", job: "Income strategies", kw: "options income sell puts premium" },
  { label: "Covered-Call", path: "/covered-call", desc: "Covered-call income on stocks you'd hold", group: "Strategies", job: "Income strategies", kw: "options income sell calls" },
  { label: "Credit Spreads", path: "/credit-spreads", desc: "Bull-put and iron-condor setups ranked by reward vs risk", group: "Strategies", job: "Income strategies", kw: "options spreads iron condor" },
  { label: "Earnings Move", path: "/earnings-move", desc: "Where options over- or under-price an earnings event", group: "Strategies", job: "Find ideas", kw: "earnings straddle implied move volatility" },
  { label: "Earnings Setup Cards", path: "/earnings-setup", desc: "Glanceable cards of upcoming reporters — implied vs. historical move, rich/cheap", group: "Strategies", job: "Find ideas", kw: "earnings setup cards implied move straddle reporting this week" },
  { label: "Earnings Play Track Record", path: "/track-record", desc: "How the earnings card's suggested option plays have actually done — logged live, settled at expiry", group: "Strategies", job: "Find ideas", kw: "track record performance earnings play trade log scorecard win rate pnl settled straddle strangle results hit rate accountability" },
  { label: "Catalyst Vol", path: "/catalyst-vol", desc: "Cheap options into a known event — investor days where the straddle isn't pricing the move", group: "Strategies", job: "Find ideas", kw: "catalyst investor day analyst day capital markets day cheap options straddle implied vs realized volatility event driven underpriced move optionality" },
  { label: "Vol Dislocation", path: "/vol-dislocation", desc: "Where option vol is rich or cheap vs realized — the variance premium, cross-sectional", group: "Strategies", job: "Find ideas", kw: "implied volatility realized variance premium rich cheap options overpriced underpriced skew term structure vol screener iv rank sell premium mispriced" },
  { label: "Guidance", path: "/guidance", desc: "Each company's standing guide + who sandbags (guides low, beats) vs over-promises its own outlook", group: "Strategies", job: "Find ideas", kw: "guidance outlook forecast raised reaffirmed cut lowered eps revenue range sandbagger sandbag beats own guide track record forward guide management credibility conservative aggressive earnings" },
  { label: "Earnings Season Desk", path: "/earnings-desk", desc: "The one-page hub — this week's prints, where options are mispriced into them, who's drifting, and the standing setups, all collated", group: "Strategies", job: "Find ideas", kw: "earnings season desk hub dashboard overview home landing collate everything one place calendar this week options mispriced drift sandbaggers vol summary digest command center" },
  { label: "Catalyst Calendar", path: "/catalyst-calendar", desc: "Every upcoming dated catalyst on one timeline — earnings, investor days, biotech readouts, and IPO lockup expiries", group: "Strategies", job: "Find ideas", kw: "catalyst calendar upcoming events timeline earnings investor day analyst day biotech readout clinical pdufa fda ipo lockup expiry unlock forward schedule diary whats coming next event driven prep dates" },
  { label: "Trade Desk", path: "/trade-desk", desc: "This week's best code-detected option mispricings, with an AI thesis + key risk on each", group: "Strategies", job: "Find ideas", kw: "trade ideas desk note weekly best trades options mispricing straddle buy sell vol premium ai llm thesis conviction top picks actionable setups this week rich cheap variance premium catalyst mispriced shortlist" },
  { label: "Skew Screener", path: "/skew", desc: "Where the options market leans up or down — call-skew flags takeover/squeeze bids, put-skew flags crash-hedging", group: "Strategies", job: "Find ideas", kw: "skew risk reversal put call iv volatility smile takeover squeeze buyout upside downside crash hedge 25 delta rr options leans" },
  { label: "Term Structure", path: "/term-structure", desc: "Front vs back IV — backwardated (event-loaded) names for calendar-spread setups", group: "Strategies", job: "Find ideas", kw: "term structure calendar spread backwardation contango front back iv time spread vol curve options event loaded near dated" },
  { label: "Earnings This Week", path: "/earnings-week", desc: "The week-ahead earnings calendar with each name's implied expected move + rich/cheap", group: "Strategies", job: "Find ideas", kw: "earnings calendar this week upcoming reporters expected move straddle implied rich cheap bmo amc before open after close schedule when reporting" },
  { label: "Dispersion", path: "/dispersion", desc: "Index vol (VIX) vs cap-weighted single-name vol — the implied-correlation / dispersion read", group: "Strategies", job: "Find ideas", kw: "dispersion index vol single name implied correlation vix cap weighted sell index buy components idiosyncratic basket correlation trade" },
  { label: "Dealer Gamma Board", path: "/gamma-board", desc: "Universe-wide dealer gamma (GEX) — who's short gamma (moves amplified), who's pinned long, and who sits on their gamma flip", group: "Strategies", job: "Find ideas", kw: "gamma exposure gex dealer positioning spotgamma zero gamma flip call put wall pin open interest short long gamma amplify dampen mm market maker hedging vanna charm squeeze pin risk spy qqq" },
  { label: "Post-Earnings Drift", path: "/pead", desc: "Names still drifting after the print — the earnings-day gap vs the drift since", group: "Strategies", job: "Find ideas", kw: "pead post earnings drift momentum gap reaction continuation surprise fade reported recently after the print sue" },
  { label: "Earnings Seasonality", path: "/seasonality", desc: "Which names systematically move big (or quiet) on earnings — the earnings amplifier", group: "Strategies", job: "Find ideas", kw: "earnings seasonality amplifier systematic move big straddle historical backtest volatility event quiet premium quarterly reaction" },
  { label: "CEF Screener", path: "/cef", desc: "Closed-end funds trading at a discount to their NAV", group: "Strategies", job: "Income strategies", kw: "closed end funds discount nav yield" },
  { label: "CEF Discount Hunter", path: "/cef-hunter", desc: "The scored shortlist of the most stretched closed-end-fund discounts", group: "Strategies", job: "Income strategies", kw: "cef closed end fund discount hunter stretched z-score yield" },
  { label: "Holdco NAV Tracker", path: "/holdco-nav", desc: "Holding companies vs their look-through NAV — discount/premium (Prosus, Exor, GBL…)", group: "Research", job: "Find ideas", kw: "holdco holding company nav discount premium look-through prosus exor gbl arbitrage sum of the parts sotp" },
  { label: "Backtest", path: "/backtest", desc: "Test factor screens and strategies against history", group: "Strategies", job: "Find ideas", kw: "backtest strategy momentum factor" },
  // ── Research
  { label: "Confluence Engine", path: "/confluence", desc: "Names where several independent bullish signals stack up — the flagship idea scanner", group: "Research", job: "Find ideas", kw: "confluence signals ideas opportunities value smart money setups" },
  { label: "Smart-Money Radar", path: "/smart-money", desc: "Who's quietly accumulating — super-investor 13F adds + Congress buys, dip-buys flagged", group: "Research", job: "Find ideas", kw: "smart money insiders accumulation 13f congress buying dip institutional" },
  { label: "Insider Cluster-Buying", path: "/insiders", desc: "Open-market insider buys (SEC Form 4) — several insiders or big cheques flagged", group: "Research", job: "Find ideas", kw: "insider buying form 4 open market cluster buy sec code p executives directors" },
  { label: "Revisions Momentum", path: "/revisions", desc: "Where the Street is quietly raising (or cutting) estimates — the revision-momentum factor", group: "Research", job: "Find ideas", kw: "estimate revisions momentum eps consensus upgrades pead drift analyst starmine" },
  { label: "Analyst Upside", path: "/analyst-upside", desc: "Where the Street sees the most room — names ranked by price-target upside and rating", group: "Research", job: "Find ideas", kw: "analyst price target upside rating buy hold sell consensus most upgraded anr" },
  { label: "Short-Squeeze Radar", path: "/squeeze", desc: "Crowded shorts ranked by % of float, days to cover, and rising short interest", group: "Research", job: "Find ideas", kw: "short squeeze interest float days to cover crowded borrow gamma ortex s3 si" },
  { label: "Factor-Screen Overlap", path: "/factor-overlap", desc: "Names that top several value/quality screens at once — the best all-round profiles", group: "Research", job: "Find ideas", kw: "factor screens overlap value quality magic formula piotroski composite" },
  { label: "Comps Board", path: "/comps", desc: "Restaurants & retailers ranked by same-store sales — sequential acceleration + 2-yr stack", group: "Research", job: "Find ideas", kw: "same store sales comps comparable sales restaurants retail traffic ticket acceleration stack like for like identical sales sss lfl" },
  { label: "Overnight Filings", path: "/overnight", desc: "AI desk notes on new material SEC filings (8-K/10-Q/10-K)", group: "Research", job: "Find ideas", kw: "sec edgar filings 8-k 10-q ai superanalyst" },
  { label: "Discount to History", path: "/valuation-history", desc: "Names trading cheap vs their own 10-year valuation", group: "Research", job: "Find ideas", kw: "valuation cheap multiple discount mean reversion" },
  { label: "Expectations (Reverse-DCF)", path: "/expectations", desc: "What growth the price implies vs what the business delivers — cheap vs priced-for-perfection", group: "Research", job: "Find ideas", kw: "reverse dcf implied growth expectations investing fcf mauboussin priced for perfection" },
  { label: "Compare Stocks", path: "/compare-stocks", desc: "Two+ stocks side by side, with an AI verdict", group: "Research", job: "Research a name", kw: "compare versus head to head" },
  { label: "Ratio & Formula", path: "/ratio", desc: "Plot one security against another — A÷B, spread, rebased, or a custom formula (e.g. MDT − 0.19 MMED stub)", group: "Research", job: "Research a name", kw: "ratio spread relative strength pairs rebased rs chart divided by versus formula stub spinoff implied value linear combination basket" },
  { label: "Pairs (Relative Value)", path: "/pairs", desc: "Same-sector S&P 500 pairs whose spread is stretched and mean-reverts — the classic stat-arb setup, ranked by z-score", group: "Research", job: "Find ideas", kw: "pairs trading relative value stat arb statistical arbitrage cointegration spread z-score mean reversion hedge ratio long short market neutral convergence divergence half life correlation pair trade" },
  { label: "Sector Compare", path: "/compare", desc: "Compare the industries inside a sector", group: "Research", job: "Research a name", kw: "industry compare sector" },
  { label: "Super-Investors", path: "/superinvestors", desc: "Famous-investor 13F holdings and quarter-over-quarter changes", group: "Research", job: "Find ideas", kw: "13f buffett hedge funds holdings managers" },
  { label: "Congress Trades", path: "/congress", desc: "Members of Congress' stock trades (STOCK Act)", group: "Research", job: "Find ideas", kw: "congress senate house pelosi trades politicians" },
  { label: "Trump's Stock Calls", path: "/trump-stocks", desc: "Just the Truth Social posts where Trump names a public company — with how the stock did since", group: "Research", job: "Find ideas", kw: "trump truth social stock calls recommendations mentions dell intel nvidia tariffs bullish bearish president politician social" },
  { label: "Activism & Shorts", path: "/campaigns", desc: "Activist stakes (13D), proxy fights, and short-seller reports — the ask/allegation + the stock since", group: "Research", job: "Find ideas", kw: "activist 13d proxy fight short seller muddy waters campaign icahn elliott saba radoff dissident board seats hindenburg allegation event driven" },
  { label: "Corporate Events", path: "/corp-events", desc: "Buybacks, spin-offs, strategic alternatives, splits, and CEO/CFO changes — from SEC 8-Ks", group: "Research", job: "Find ideas", kw: "buyback repurchase spin-off spinoff carve-out strategic alternatives sale merger stock split reverse split ceo cfo change leadership 8-k corporate event driven kedm monitor" },
  { label: "Merger Arb", path: "/merger-arb", desc: "Pending US acquisitions with the live arb spread + annualized return — cash & stock deals from SEC merger proxies", group: "Research", job: "Find ideas", kw: "merger arbitrage arb pending deal acquisition takeover spread annualized return definitive agreement per share cash stock exchange ratio cvr break price deal close regulatory antitrust event driven risk arb m&a target acquirer" },
  { label: "IPOs & Lockups", path: "/ipos", desc: "Recent IPOs + the lockup-expiry calendar (IPO + ~180d) — when insider supply first hits the stock", group: "Research", job: "Find ideas", kw: "ipo initial public offering lockup unlock expiry 180 days insider supply 424b4 new listing nasdaq nyse event driven kedm" },
  { label: "Biotech Catalysts", path: "/biotech-catalysts", desc: "Clinical binary events — Phase 2/3 readouts, enrollment done, failures — mapped to the sponsor's ticker", group: "Research", job: "Find ideas", kw: "biotech pharma clinical trial phase 3 phase 2 readout pdufa fda catalyst binary event clinicaltrials topline data sponsor drug" },
  { label: "Policy & Contracts", path: "/policy", desc: "New federal rules (tariffs, EPA, FAA, drug-pricing) + big government contract wins, mapped to tickers", group: "Research", job: "Find ideas", kw: "policy federal register rule tariff epa fda cms drug pricing faa ftc government contract award defense usaspending lockheed boeing raytheon revenue signal regulation" },
  { label: "Filings & Docs", path: "/research", desc: "Browse and AI-summarize a company's SEC filings", group: "Research", job: "Research a name", kw: "filings documents sec edgar summary" },
  { label: "Research Desk", path: "/research-desk", desc: "Upload sell-side PDFs → searchable, cross-broker synthesis", group: "Research", job: "Research a name", kw: "research pdf upload broker analyst report" },
  { label: "Portfolio Cockpit", path: "/portfolio", desc: "Paste your book → live gross/net exposure, sector tilts, concentration, beta & a market-shock P&L", group: "Research", job: "Track the market", kw: "portfolio book positions holdings risk exposure gross net long short beta market shock scenario stress test concentration hhi sector tilt cockpit blotter my positions var drawdown hedge" },
];

// Sub-hubs — the Research and Strategies menus grew long, so cluster each into a few hubs that act as
// sub-tabs of each other. The dropdown shows the hubs; a secondary sub-nav bar (AppHeader) shows a
// hub's members when you're on one of its pages. Paths must match FEATURES paths above. A 1-path hub
// is just a plain entry (no sub-nav bar).
export interface NavHub { label: string; blurb: string; paths: string[] }
export const GROUP_HUBS: Partial<Record<NavGroup, NavHub[]>> = {
  Strategies: [
    { label: "Options Income", blurb: "Sell premium on quality names — cash-secured puts, covered calls, spreads", paths: ["/put-writing", "/covered-call", "/credit-spreads"] },
    { label: "Earnings & Events", blurb: "Trade the event — start at the Earnings Season Desk + the forward Catalyst Calendar, then the weekly AI trade desk, the week-ahead earnings moves, implied vs. historical move, skew & term-structure setups, cheap options into a catalyst, where vol is rich/cheap, dealer gamma positioning, and who sandbags their own guide", paths: ["/earnings-desk", "/catalyst-calendar", "/trade-desk", "/earnings-week", "/earnings-move", "/earnings-setup", "/track-record", "/catalyst-vol", "/vol-dislocation", "/skew", "/term-structure", "/dispersion", "/gamma-board", "/pead", "/seasonality", "/guidance"] },
    { label: "Closed-End Funds", blurb: "Funds trading below NAV — the full screener + the stretched-discount shortlist", paths: ["/cef", "/cef-hunter"] },
    { label: "Backtest", blurb: "Test factor screens and strategies against history", paths: ["/backtest"] },
  ],
  Research: [
    { label: "Idea Scanners", blurb: "Signal-fusion boards — names where bullish signals stack up", paths: ["/confluence", "/smart-money", "/revisions", "/analyst-upside", "/squeeze", "/insiders", "/factor-overlap", "/comps"] },
    { label: "Event-Driven", blurb: "Catalyst monitors — merger-arb spreads, activism & shorts, corporate events, spinoff turnover, IPO lockups, biotech readouts, policy, and Trump's stock calls", paths: ["/merger-arb", "/campaigns", "/corp-events", "/spinoffs", "/ipos", "/biotech-catalysts", "/policy", "/trump-stocks"] },
    { label: "Valuation", blurb: "Cheap vs history, reverse-DCF expectations, holdco discounts", paths: ["/valuation-history", "/expectations", "/holdco-nav"] },
    { label: "Ownership", blurb: "Super-investor 13F holdings + Congress trades", paths: ["/superinvestors", "/congress"] },
    { label: "Charts & Compare", blurb: "Head-to-head, ratio/spread charts, relative-value pairs, sector compare", paths: ["/compare-stocks", "/ratio", "/pairs", "/compare"] },
    { label: "Documents", blurb: "SEC filings, overnight desk notes, your research corpus", paths: ["/research-desk", "/research", "/overnight"] },
    { label: "Portfolio", blurb: "Your book's exposure, sector tilts, concentration, beta & market-shock P&L", paths: ["/portfolio"] },
  ],
};

// US-only features: they live under /u/[universe]/ but read a GLOBAL feed built from US single-stock
// options / US earnings (vol-dislocation, earnings-move, dispersion, pead, seasonality, guidance-board,
// trade-ideas, catalyst-vol). The data is the same US set regardless of universe, so on an INTERNATIONAL
// universe they'd show US tickers under an intl index header. The nav hides them on intl universes and
// the pages show a "US options only" notice on direct navigation. This IS the "Earnings & Events" hub.
export const US_ONLY_PATHS: ReadonlySet<string> = new Set([
  ...(GROUP_HUBS.Strategies?.find((h) => h.label === "Earnings & Events")?.paths ?? []),
  "/pairs", // S&P 500 stat-arb pairs (data/pairs.json is US-only) — lives in the Research "Charts & Compare" hub
  "/merger-arb", // US merger-arb (SEC merger proxies) — lives in the Research "Event-Driven" hub
]);
/** True if a relative path (e.g. "/skew" or "/skew/AAPL") is one of the US-only feature routes. */
export const isUsOnlyPath = (relPath: string): boolean =>
  [...US_ONLY_PATHS].some((p) => relPath === p || relPath.startsWith(p + "/"));

const _allHubs: NavHub[] = [GROUP_HUBS.Markets, GROUP_HUBS.Strategies, GROUP_HUBS.Research].flatMap((h) => h ?? []);
const _featByPath = new Map(FEATURES.map((f) => [f.path, f] as const));
/** The hub a relative path (e.g. "/cef") belongs to + its member NavItems — for the sub-nav bar.
 *  Single-tool hubs return null (no sub-tabs needed). */
export function hubForPath(relPath: string): { label: string; items: NavItem[] } | null {
  const hub = _allHubs.find((h) => h.paths.some((p) => relPath === p || relPath.startsWith(p + "/")));
  if (!hub || hub.paths.length < 2) return null;
  return { label: hub.label, items: hub.paths.map((p) => _featByPath.get(p)).filter((x): x is NavItem => !!x) };
}

export const ALL_NAV: NavItem[] = [...TOP_LINKS, ...FEATURES];
export const NAV_GROUPS: NavGroup[] = ["Markets", "Strategies", "Research"];
export const JOBS: Job[] = ["Track the market", "Find ideas", "Research a name", "Income strategies"];
export const JOB_BLURB: Record<Job, string> = {
  "Track the market": "See what's happening right now across the market.",
  "Find ideas": "Surface interesting names and setups to look into.",
  "Research a name": "Dig into a single company in depth.",
  "Income strategies": "Options and fund screens for generating yield.",
};
