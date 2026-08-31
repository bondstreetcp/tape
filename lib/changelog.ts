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
    id: "2026-08-29-rank-structures",
    date: "2026-08-29",
    title: "The strategy analyzer now ranks structures, not just models one",
    items: [
      "Any stock → Options → the strategy payoff analyzer gains a “Rank structures” scan: it scores the premium / defined-risk structures — cash-secured put, bull-put & bear-call credit spreads, iron condor, covered call, short strangle — at sensible strikes and ranks them by expected return on capital-at-risk (skew-aware, from the market's implied distribution where available). ★ marks the best; click any row to load it in and tune the strikes. Instead of only modeling the structure you picked, it tells you which one fits the name right now.",
    ],
  },
  {
    id: "2026-08-29-convertibles",
    date: "2026-08-29",
    title: "Convertible & Capped-Call Watch",
    items: [
      "New Options → Convertible Watch: recent convertible-note issuance — the trade financing the AI / data-center capex — read through a vol lens. It backs out the implied vol each note was ISSUED at and compares it to the stock's listed option IV; converts priced BELOW listed vol are the classic long-convert / short-stock cheapness. Terms are auto-extracted from the offering filings; the issue vol uses a component model with an estimated credit spread — so the cheap/rich signal is more robust than the absolute level, and note there's no live convert price, so this isn't a live arb spread.",
      "It also surfaces the dilution levels that matter: the conversion price and, where the issuer bought a capped call / call spread, the cap strike — the effective dilution ceiling, and a level where the dealers who sold it sit short gamma. Live moneyness/parity per name, sortable by the cheap-vs-listed edge.",
    ],
  },
  {
    id: "2026-08-29-skew-ev",
    date: "2026-08-29",
    title: "Skew-aware POP & EV in the strategy analyzer",
    items: [
      "The per-name strategy payoff analyzer (any stock → Options) now shows a Market-implied POP and expected value beside the lognormal ones — the same structure scored against the options market's OWN risk-neutral distribution (the fitted smile via Breeden–Litzenberger) instead of a symmetric ATM-vol bell curve. The gap between the two is the skew: equities' fat left tail trims a downside seller's EV, while rich put skew can add to a put-spread's edge — and it now says so.",
      "It also drops in the implied price distribution at expiry — red mass below today's price, green above — so you can see the asymmetry the market is pricing behind the numbers, right where you're building the trade.",
    ],
  },
  {
    id: "2026-08-29-options-risk",
    date: "2026-08-29",
    title: "Ex-div & earnings flags on the wheel queue + a vol P&L surface in Prism",
    items: [
      "The Wheel Tracker's Manage-now queue now flags two more risks per position: an ITM short call heading into an ex-dividend (early-assignment risk — roll or close to keep the shares & dividend), and any short leg whose expiry spans an earnings print. Dates come from the options calendar, so the queue sees the events, not just the strike and clock.",
      "Prism (your book) gains a 2-D P&L surface — book P&L across an S&P move AND an independent implied-vol shift, options repriced. The old market-shock ladder coupled vol to the move; this frees vol as its own axis, so a long-vega book greens the IV-spike row while a short-vega book (short strangles, cash-secured puts) shows exactly where it bleeds.",
    ],
  },
  {
    id: "2026-08-29-wheel-manage",
    date: "2026-08-29",
    title: "A “Manage now” queue on the Wheel Tracker",
    items: [
      "The Wheel Tracker now opens with a prioritized Manage-now queue across your whole book — every open short leg that needs attention, worst first: expired, in-the-money (assignment risk), inside the roll window, or pinned near the strike, each with the suggested move and a jump to that name's Wheel tab. It pulls one live-price batch so the flags reflect where the stock actually is, not just the calendar.",
      "You can now track the short-put (wheel entry) leg too — its strike and expiry — so the queue manages puts and covered calls alike, not just calls.",
    ],
  },
  {
    id: "2026-08-29-ev-analyzer",
    date: "2026-08-29",
    title: "Expected value in the strategy analyzer",
    items: [
      "Any stock → Options → the strategy payoff analyzer now shows Expected value alongside probability-of-profit — the probability-weighted P/L under a lognormal at ATM implied vol, plus its return on the capital at risk. Because each leg is priced at its own strike's IV, EV captures the vol-skew and structural edge, not just the odds.",
      "It flags the classic premium-selling trap directly: when a trade has a comfortable hit-rate but negative expectancy (the rare tail loss outweighing the frequent small win), you now get a warning instead of a reassuring high POP.",
    ],
  },
  {
    id: "2026-08-29-sell-premium",
    date: "2026-08-29",
    title: "A Sell-Premium Board — where to sell option premium now",
    items: [
      "New Options → Income → Sell-Premium Board: one ranked leaderboard of the best names to sell option premium on right now. It blends the three vol lenses you had scattered across separate screens — the variance premium (IV vs the name's own realized), IV rank (rich vs where its vol usually sits), and richness vs its sector — into a single 0–100 sell score.",
      "Crucially, it haircuts names whose rich vol is just pricing an imminent earnings event inside the front expiry — so you're not lured into selling premium you'd be short an event against. Filter to \"🛡 clear of earnings\", or to the side the skew says is the richer sell (puts for a wheel entry, calls for an overwrite). Every row links straight to that name's Wheel tab to size the strike & expiry.",
    ],
  },
  {
    id: "2026-08-29-earnings",
    date: "2026-08-29",
    title: "Sharper earnings prep — a recommended play, the comp bogey & deeper AI context",
    items: [
      "Every earnings tab now opens with an “Into the print” call — sell a cash-secured put, sell a put spread, own it, or stand aside — synthesized in code from the rich/cheap vol read, the Nielsen scanner, the comparable-sales trend and the stock’s own reaction history. Decision-support, not advice.",
      "New “Comp bogey” for restaurants & retailers: the exact comparable-sales number next quarter needs to hold the two-year stack flat — so a headline comp that looks fine but is really a 2-year deceleration gets caught (the Five Below tell). Computed from the disclosed comp history, never estimated.",
      "The AI earnings preview now reads your ingested broker/analyst research too (not just the quant signals + scanner), attributes it by firm, and flags where a note diverges from the sell-side consensus.",
      "Wider Staples Scanner coverage — Campbell’s, Conagra, Smucker, McCormick, Kellanova, Hormel, Post, Lamb Weston and more now resolve to their tickers, so their point-of-sale demand read shows up on the earnings tab and the research desk.",
      "“Earnings This Week” on the broad universes (Russell 1000 / Broad 1500 / Russell 3000) now lists every US reporter — small-caps like Ollie’s are no longer dropped by the universe filter.",
      "The earnings options-positioning card now labels the expiry its skew, max-pain and call/put walls are measured at.",
    ],
  },
  {
    id: "2026-08-28-wheel-suite",
    date: "2026-08-28",
    title: "A full theta-wheel workbench",
    items: [
      "Any stock → the new Wheel tab — reads the live options chain and names a strike + expiry for every leg: sell a covered call, sell a cash-secured put to enter, roll an open call, or build a poor-man's covered call (a capital-efficient LEAPS diagonal). Conservative / balanced / aggressive picks by delta, expiry × moneyness yield grids, a payoff diagram, a premium-rich check (current IV vs realized vol), a “does this name wheel well?” backtest, and guards for both earnings and ex-dividend dates (early-assignment risk).",
      "Alerts → Signal → “Option premium is rich” — get pinged when a name's implied vol runs rich vs its realized (the variance premium ≥ ~1.4×) — a good time to sell calls or puts. Set it on one name or your whole watchlist.",
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
