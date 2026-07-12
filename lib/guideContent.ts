/**
 * The Guide’s content — a plain-English manual for every feature in Tape, written for someone who’s
 * taken one intro finance course. GUIDE_CONCEPTS is the cross-cutting “Concepts 101” primer; each
 * GUIDE_GROUPS entry documents a cluster of features with the question it answers, how to read it, and
 * every on-screen metric defined. Client-safe (pure data). GENERATED from the real code via the
 * build-guide workflow (draft → adversarial verify against each view) — regenerate when a feature or a
 * board metric changes; hand-edits are fine for small fixes.
 */

export interface GuideMetric { term: string; plain: string }
export interface GuideFeature { path: string; title: string; question: string; how: string; metrics: GuideMetric[]; usOnly?: boolean }
export interface GuideGroup { key: string; title: string; blurb?: string; features: GuideFeature[] }
export interface GuideConcept { term: string; plain: string }

export const GUIDE_CONCEPTS: GuideConcept[] = [
  {
    "term": "Valuation multiples (P/E, EV/EBITDA, P/S, P/B)",
    "plain": "You already know P/E — share price divided by earnings per share, i.e. the dollars you pay for $1 of annual profit. A \"multiple\" generalizes that idea: the price of a business divided by some measure of what it produces, so a $5 stock and a $500 stock can be compared on equal footing. P/S swaps in sales (useful when a company barely earns yet), P/B uses book value (assets minus liabilities), and EV/EBITDA divides enterprise value — market cap plus debt minus cash, the cost to buy the whole business — by a rough cash-operating-profit number, so debt-heavy and debt-free firms compare fairly. A lower multiple means you pay less per unit of profit, sales, or assets (\"cheap\"); higher means you pay more (\"expensive\"), usually because faster growth is expected. Cheap isn't automatically good — a multiple only has meaning next to the company's own history or its peers, which is exactly how Tape presents it."
  },
  {
    "term": "What an option is — call vs put, strike, expiry, premium, in/out-of-the-money",
    "plain": "An option is a contract giving you the right — not the obligation — to trade 100 shares at a fixed price by a fixed date. A call is the right to BUY at that fixed price (the strike); a put is the right to SELL at the strike. The expiry is the date the right ends, and the premium is the up-front cash the buyer pays and the seller collects for taking the other side. A call is in-the-money when the stock is above the strike (you could buy cheap, sell high) and out-of-the-money when below (worthless right now); a put is the reverse. Two everyday uses Tape screens for: selling a covered call against stock you own to collect income, or selling a cash-secured put — agreeing to buy lower while holding the cash to do so."
  },
  {
    "term": "The option greeks — delta, gamma, theta, vega",
    "plain": "The \"greeks\" measure how an option's price reacts to the things that move it, each labeled with a Greek letter. Delta is how much the option moves per $1 move in the stock, and it doubles as a rough probability the option finishes in-the-money (a \"16-delta\" put has about a 16% chance). Gamma is how fast that delta itself changes as the stock moves — largest for at-the-money options near expiry, and the key to the dealer-hedging idea below. Theta is the value an option quietly loses each day just from time passing (the decay a seller collects and a buyer pays), and vega is how much the option's price changes when the market's volatility estimate moves by one point. You don't need the math — just the intuition that price, time, and volatility each have a dial, and the greeks are those dials."
  },
  {
    "term": "Implied vs realized volatility and the \"implied move\"",
    "plain": "Volatility just means how much a stock bounces around, stated as an annualized percentage. Realized (or historical) volatility is how much the stock ACTUALLY moved over a recent window — a fact you can measure. Implied volatility is how much future movement option prices are currently baking in — a forecast backed out of what people will pay for options, where a higher number means pricier options. From implied volatility you can read an implied move: the up-or-down range priced in by a given date, which around an event like earnings is roughly the cost of the at-the-money call-plus-put divided by the share price. Comparing the two — what options price versus what the stock has done — is the backbone of most of Tape's options screens."
  },
  {
    "term": "Rich vs cheap options and the variance premium",
    "plain": "Because implied volatility is a forecast and realized volatility is the outcome, you can ask whether options are over- or under-pricing the actual movement. When implied sits well above what the stock tends to realize, options are rich (expensive) — favorable to the seller collecting premium; when implied is below, options are cheap — favorable to the buyer paying for the move. On average across the market, implied runs a little higher than realized, a persistent gap called the variance premium — essentially the compensation option sellers earn for insuring others against big moves. Tape quantifies this with ratios like implied-vol divided by realized-vol (above roughly 1.4 flags \"rich,\" near or below 1 flags \"cheap\"), framed as a read on pricing, never a prediction of direction."
  },
  {
    "term": "Options skew and term structure",
    "plain": "Not every option on the same stock carries the same implied volatility, and the pattern is informative. Skew is the gap between the implied volatility of downside puts and upside calls at the same distance from the price: puts usually cost more because investors pay up for crash protection, so \"steep skew\" means fear of a drop is richly priced. Term structure is how implied volatility differs across expiry DATES rather than strikes — when near-dated options are pricier than longer-dated ones (called backwardation), the market is usually flagging a specific event coming soon, like earnings or an FDA decision. Read together, skew and term structure tell you not just how much movement is priced, but which direction and when the market is most worried."
  },
  {
    "term": "Dealer/market-maker hedging and gamma exposure (GEX)",
    "plain": "When you trade an option a dealer (market maker) usually takes the other side, and they don't want a directional bet — so they hedge by buying or selling the underlying stock, re-adjusting as it moves. How much they must re-trade depends on gamma, and the aggregate is gamma exposure (GEX): the dollars of stock dealers must trade to stay hedged for a 1% move. When dealers are net LONG gamma they trade against the move — buying dips, selling rallies — which dampens and \"pins\" volatility; when net SHORT gamma they trade WITH the move — selling as it falls, buying as it rises — which amplifies swings, and the price where they flip between the two is the gamma flip. Heavy option strikes act as \"walls\" that can behave like magnets or barriers near expiry. Tape computes this from end-of-day open interest using the standard convention that dealers are long call gamma and short put gamma — a widely used positioning heuristic, explicitly not a fact about any real dealer's book, so it is decision support, never a signal."
  },
  {
    "term": "Dispersion and implied correlation",
    "plain": "An index like the S&P 500 is calmer than its average member because the members don't all move together — winners and losers partly cancel out. Dispersion compares the volatility priced into index options against the cap-weighted average volatility priced into the individual stocks' options; a big gap means the market expects lots of stock-specific, offsetting movement. Backing that gap out gives an implied correlation: low correlation means the market is paying up for single-name movement (the classic \"dispersion trade\" sells index volatility and buys the components), high correlation means everything is expected to move as a block. Tape approximates the index leg with the VIX and the single-name leg with the ~1-month at-the-money implied vols it solves nightly for large-caps, so its correlation figure is a regime read — directionally useful — rather than an index-desk-exact number."
  },
  {
    "term": "13F filings and institutional / \"smart-money\" ownership",
    "plain": "Large investment managers (over $100M in U.S. equities) must disclose their long stock holdings every quarter in an SEC filing called a 13F, filed up to 45 days after the quarter ends. Reading these lets you see what respected funds — value managers, activists, hedge funds — own, added, and sold, quarter over quarter. The caveats matter: 13Fs are delayed by weeks, show only U.S. long positions (no shorts, bonds, or foreign lines), and a stale filing can misrepresent a fund that has since moved on. Tape tracks a curated set of about 33 managers with verified filer IDs and maps their reported holdings back to tickers, presenting \"smart-money\" ownership as context on who is positioned where — not as an endorsement to follow the trade."
  },
  {
    "term": "Short interest, days-to-cover, borrow fee, and the squeeze",
    "plain": "To bet against a stock you short it: borrow shares, sell them, and hope to buy them back cheaper later. Short interest is the percentage of a company's shares currently sold short — a gauge of how much money is betting on a decline. Days-to-cover divides that short position by average daily volume to estimate how many days of buying it would take shorts to exit, and the borrow fee is the annual percentage cost to borrow the shares (a high fee means the stock is hard and expensive to short). When a heavily shorted stock starts rising, shorts may be forced to buy back to cap their losses, and that buying pushes the price higher still — a self-reinforcing short squeeze. These numbers describe crowded positioning and risk; they are not a forecast that a squeeze will happen."
  },
  {
    "term": "Beta, factors (value/momentum/quality), diversification, and crowding",
    "plain": "You likely met beta already: how much a stock tends to move relative to the overall market, where 1 moves in line, above 1 is more volatile, below 1 less. Factors extend that idea to style exposures that explain returns across many stocks — value (cheap multiples), momentum (recently outperforming), quality (profitable, well-financed), and size. Diversification is the familiar principle that mixing uncorrelated holdings lowers overall risk — but only if the holdings are genuinely uncorrelated. Crowding is the hidden trap: a book that looks spread across sectors can still be one bet if its names all lean the same factor and move together, so Tape measures factor tilts (in standard deviations from the market) and average correlation to surface concentration you can't see from a position list."
  },
  {
    "term": "Catalysts and event-driven investing",
    "plain": "A catalyst is a scheduled or expected event that can re-rate a stock quickly, and event-driven investing organizes around those dates rather than long-run fundamentals. Common catalysts: quarterly earnings reports; a PDUFA date — the FDA's target decision day on a drug, where approval sends a biotech up and a Complete Response Letter (a rejection) sends it down; a spin-off, where a company splits a division into a separately traded stock; and activism, where an investor takes a large stake (disclosed in a \"13D\" filing above a 5% threshold) to push for change. What these share is a known-ish date and a binary-ish outcome, which is precisely why the options market prices extra volatility into them. That is why Tape's calendars and event screens line those dates up against how richly the options are priced."
  },
  {
    "term": "Merger arbitrage and IPO lockups",
    "plain": "Two more event types deserve their own note. In a merger, an acquirer agrees to buy a target at a set price, but the target usually trades a bit BELOW that price until the deal closes — the gap is the merger-arb spread, the return you capture if it completes, and a wide spread signals the market's doubt it will (regulators, financing, a rival bid). An IPO lockup is the roughly 180-day stretch after a company goes public when insiders and early backers are contractually barred from selling; when it expires, a wave of new shares can hit the market and pressure the price. Both are calendar-driven, mechanical setups — Tape surfaces the dates and the spreads as context, and the risk in each (a deal breaking, supply flooding in) is the whole point, not a footnote."
  },
  {
    "term": "Closed-end-fund and holdco discounts to NAV",
    "plain": "A fund's net asset value (NAV) is simply what its holdings are worth per share — add up everything it owns, divide by shares. Most mutual funds and ETFs trade right at NAV, but a closed-end fund has a fixed share count that trades on an exchange like a stock, so supply and demand can push its price BELOW (a discount) or above (a premium) the value of what it holds — a discount means you buy $1 of assets for less than $1. The same logic applies to a holding company (holdco) such as an investment conglomerate, whose stock often trades below the summed value of its stakes — the \"holdco discount.\" A persistent discount versus its own history can flag value or a structural reason the gap won't close, so Tape tracks these discounts and their z-scores (how unusual the discount is versus normal) rather than treating any gap as free money."
  },
  {
    "term": "Analyst estimates, revisions, and guidance",
    "plain": "Wall Street analysts publish estimates — forecasts of a company's future revenue and earnings per share — and their average (the \"consensus\") is the bar a company is measured against when it reports. What the estimate IS often matters less than which way it is MOVING: revisions, analysts collectively raising or cutting their numbers, are among the more informative signals because they tend to cluster and persist. Distinct from analyst estimates is guidance — management's OWN forecast for the coming quarter or year, where whether the latest guide raised, held, or cut the prior outlook is a fast read on business momentum. Tape tracks all three, including a company's record of beating its own guide, so you can tell a habitual sandbagger (guides low, beats) from an over-promiser (guides high, misses)."
  },
  {
    "term": "How Tape sources and grounds its data — and its honest limits",
    "plain": "Tape's governing rule is \"code computes, the model only narrates.\" Every number — a valuation multiple, an implied move, a gamma level — is calculated in code from vendor data or SEC filings; a language model is used only to write the plain-English summary AROUND those numbers, and it is fenced in so it cannot invent a figure, a quote, or a ticker (its output is checked against the source text and the known-symbol list before you ever see it). So when a sentence cites a number, that number came from the computation, not the model's imagination. The honest limits are stated up front: options data is end-of-day snapshots (not live), the options feeds are U.S.-only, and constructs like dealer gamma, dispersion correlation, and \"rich/cheap\" thresholds are model heuristics built on standard conventions — useful for framing and comparison, explicitly decision support, never a buy/sell signal or advice."
  }
];

export const GUIDE_GROUPS: GuideGroup[] = [
  {
    "key": "markets",
    "title": "Markets, Macro & the Daily Desk",
    "blurb": "The tape at a glance — what is moving right now, the macro backdrop, and the AI daily brief.",
    "features": [
      {
        "path": "",
        "title": "Home (Market Overview)",
        "question": "How is my market doing right now, which sectors and stocks are moving, and why?",
        "how": "This is the dashboard for whichever index (universe) you've selected. The big number at the top is the whole index's return over the timeframe you pick, computed as a market-cap-weighted average of its members (bigger companies count more, the way a real index works). Below it a breadth strip counts how many names are up vs down and how many sit near their yearly high or low; a price chart shows the index itself; and a grid of sector tiles, each colored (not sized) by its return, shows the sector's stock count plus how many members are near a 52-week high or low. A Movers list gives the biggest gainers and losers with a one-line 'why,' and an analyst-actions feed lists recent Wall Street rating changes. On international universes the sector grid is replaced by a treemap whose tiles are individual stocks sized by market cap. It's a read-the-room screen, not a signal.",
        "metrics": [
          {
            "term": "Timeframe (1D, 1W, 1M, …)",
            "plain": "The look-back period every return on the page is measured over; you toggle it, and 1D means today's move."
          },
          {
            "term": "Index return (cap-weighted)",
            "plain": "The universe's average price move for the timeframe, weighting each company by its size (market cap) so giants move it more."
          },
          {
            "term": "Advancing / Declining",
            "plain": "How many constituent stocks are up vs down over the chosen timeframe — a quick sense of how broad the move is."
          },
          {
            "term": "Near 52-week high / low",
            "plain": "Count of names within a set percentage (you choose the threshold) of their highest/lowest price of the past year."
          },
          {
            "term": "Sector return",
            "plain": "Each sector tile's cap-weighted price move over the timeframe (green up, red down), with the tile's stock count and how many members are near a 52-week high or low."
          },
          {
            "term": "Movers (gainers / losers) + 'Why'",
            "plain": "The biggest up and down stocks for the timeframe, each with a short plain-language reason for the move when one is known."
          },
          {
            "term": "Analyst actions (Upgrade / Downgrade / Initiate / Maintain / Reiterate)",
            "plain": "A Wall Street firm's recent change to its rating or price target on a stock — shown with the firm, the old→new rating, and any target change."
          },
          {
            "term": "Market cap",
            "plain": "A company's total stock-market value = share price times number of shares; used to size tiles and weight the index."
          }
        ]
      },
      {
        "path": "/morning-desk",
        "title": "Daily Desk",
        "question": "What actually happened overnight (or during the day) across the market, and what should I watch next?",
        "how": "An AI model reads the night's already-collected data — the biggest stock moves and their catalysts, material SEC filings, unusually large options trades, and analyst rating changes — and writes a plain-language brief twice each weekday (a pre-open 'morning run' and a post-close 'evening run'). Each item is two layers: the fact (what happened) plus the read (why it might matter), and it's tagged by type. The code picks the inputs; the model only summarizes and never gives a buy/sell call. A second tab, the News Wire, shows the day's Reuters newsletters (Morning News Call and The Day Ahead) parsed into readable market tables and an earnings schedule; that tab is password-protected.",
        "metrics": [
          {
            "term": "Morning run / Evening run",
            "plain": "Which of the two daily generations you're reading — one written before the US open, one after the close, so the framing fits the time of day."
          },
          {
            "term": "TL;DR",
            "plain": "A two-to-three-sentence overview at the top: the state of the market plus the single most important thing."
          },
          {
            "term": "Tag: Deal",
            "plain": "The item concerns a merger, acquisition, buyout, or other corporate transaction."
          },
          {
            "term": "Tag: Catalyst",
            "plain": "A specific dated or one-off event driving a stock (an approval, a product launch, a legal ruling, etc.)."
          },
          {
            "term": "Tag: Positioning",
            "plain": "The item is about options-flow or trader positioning — where big directional bets are being placed."
          },
          {
            "term": "Tag: Unexplained",
            "plain": "A large move with no obvious public reason yet — flagged so you know the cause is unknown."
          },
          {
            "term": "Tag: Trend / Analyst / Earnings ahead",
            "plain": "A multi-day price trend; a Wall Street rating change; or a company scheduled to report earnings soon."
          },
          {
            "term": "What to watch today",
            "plain": "A short forward list of concrete upcoming events — earnings tonight, a deal vote, an FDA date, an options expiry."
          },
          {
            "term": "News Wire (Reuters)",
            "plain": "The parsed Reuters Morning News Call and The Day Ahead newsletters — market snapshot tables plus the earnings calendar; password-gated."
          },
          {
            "term": "BMO / AMC",
            "plain": "In the earnings table, 'before market open' vs 'after market close' — when a company reports, which sets the session the reaction lands in."
          }
        ]
      },
      {
        "path": "/watchlist",
        "title": "Watchlist",
        "question": "How are the specific stocks I care about doing, at a glance and in near-real-time?",
        "how": "You star names anywhere in the app; this page collects them into one table with live-ish prices (refreshed on an interval from Yahoo, overriding the nightly snapshot) plus valuation and technical context. The 'Signals' column flags simple current-state conditions from the data — proximity to the 52-week high/low and where the price sits relative to its 50- and 200-day moving averages (a moving average is just the average closing price over the last N trading days, a smoothed trend line). An optional AI digest (one click) reads your names' recent moves plus current news and summarizes what happened. Your list is saved in your browser, so names outside the current index are noted as not-shown until you switch universes.",
        "metrics": [
          {
            "term": "Live state (Live / Pre-market / After hours / Market closed)",
            "plain": "Whether the shown prices are updating in real time and which trading session they reflect."
          },
          {
            "term": "Price",
            "plain": "The latest share price — live when the market is open, otherwise the most recent snapshot value."
          },
          {
            "term": "Timeframe % change",
            "plain": "The stock's return over the timeframe you selected (today's move when set to 1D)."
          },
          {
            "term": "% from High / % from Low",
            "plain": "How far the price sits below its highest, and above its lowest, close of the past 52 weeks."
          },
          {
            "term": "Mkt Cap",
            "plain": "Market capitalization — the company's total stock-market value (share price times shares outstanding)."
          },
          {
            "term": "P/E",
            "plain": "Price-to-earnings: share price divided by yearly earnings per share — dollars paid for $1 of annual profit; lower is cheaper."
          },
          {
            "term": "Signal: 52wH / 52wL",
            "plain": "The stock is at or near its 52-week high (52wH) or low (52wL)."
          },
          {
            "term": "Signal: 200-day MA (↑200d / ↓200d / ~200d)",
            "plain": "Price above, below, or right near its average close of the last 200 trading days — a common long-term trend line."
          },
          {
            "term": "Signal: golden cross (50>200) / death cross (50<200)",
            "plain": "The 50-day average is above (golden, bullish) or below (death, bearish) the 200-day average — a widely watched trend flip."
          }
        ]
      },
      {
        "path": "/heatmap",
        "title": "Market Heatmap",
        "question": "Where is the money moving across the whole market, visually, in one picture?",
        "how": "A treemap turns the index into rectangles: each tile is a stock, its size is the company's market cap (bigger company = bigger tile), and its color is the stock's return over the timeframe you pick (green up, red down). Tiles are grouped by sector so you can see whole neighborhoods of the market glow or bleed at once. Click a sector or sub-industry label to zoom in — that re-scales the map so smaller companies get readable tiles — and click any tile to open that stock.",
        "metrics": [
          {
            "term": "Tile size = market cap",
            "plain": "Each rectangle's area is proportional to the company's total stock-market value, so the biggest firms dominate the view."
          },
          {
            "term": "Tile color = return",
            "plain": "Green means the stock is up over the chosen timeframe, red means down; deeper color = bigger move."
          },
          {
            "term": "Sector / sub-industry grouping",
            "plain": "Tiles are clustered by the company's business category so you can see which parts of the market are moving together."
          },
          {
            "term": "Timeframe",
            "plain": "The look-back period the colors reflect (today, a week, a month, etc.); you choose it."
          }
        ]
      },
      {
        "path": "/market",
        "title": "Cross-Asset Monitor",
        "question": "What are stocks, bonds, currencies, commodities, and crypto all doing right now, on one screen?",
        "how": "A grid of quote tiles across five asset groups, so you can see the whole macro backdrop at once rather than one market in isolation. Each tile shows the latest level and the day's change (in percent for most things, but in basis points for bond yields, since that's how the bond market talks — a basis point is one hundredth of a percentage point). Quotes come from Yahoo and may be slightly delayed; click any tile for its history chart. Below the tiles is a market-headlines news feed.",
        "metrics": [
          {
            "term": "Equity indices (S&P 500, Nasdaq, Dow, Russell 2000, plus intl)",
            "plain": "Baskets tracking whole stock markets or market segments; the number is the index level and its daily percent change."
          },
          {
            "term": "S&P 500 Equal Weight (RSP)",
            "plain": "The same 500 companies but each counted equally instead of by size — shows breadth when it diverges from the cap-weighted index."
          },
          {
            "term": "VIX",
            "plain": "The 'fear gauge': how much movement options traders expect in the S&P 500 over the next month; higher = more nervous."
          },
          {
            "term": "Rates & bonds (3M–30Y yields)",
            "plain": "The annual interest rate the US government pays to borrow for that length of time; change shown in basis points."
          },
          {
            "term": "Basis point (bp)",
            "plain": "One hundredth of a percentage point (0.01%); bond and rate moves are quoted this way."
          },
          {
            "term": "US Dollar Index & FX pairs",
            "plain": "The dollar's strength vs a basket of currencies, plus individual exchange rates like euro-per-dollar; percent change shown."
          },
          {
            "term": "Commodities (crude, gold, silver, copper, nat gas)",
            "plain": "Raw-material futures prices — WTI and Brent crude oil, gold, silver, copper, and natural gas; oil and copper read as growth gauges, gold as a safe haven."
          },
          {
            "term": "Crypto (BTC, ETH, SOL, BNB)",
            "plain": "Prices of the largest cryptocurrencies, shown for a full cross-asset picture."
          }
        ]
      },
      {
        "path": "/rotation",
        "title": "Sector Rotation (RRG)",
        "question": "Which sectors of the market are leading, which are lagging, and which way is each one heading?",
        "how": "This is a Relative Rotation Graph (RRG) of the 11 S&P sector funds measured against the overall market (SPY). Every sector gets two numbers: how it's performing relative to the market (the horizontal axis), and whether that relative performance is speeding up or slowing down (the vertical axis). Those two place each sector in one of four quadrants, and the little tail behind each dot traces its last ~6 weeks of travel. Sectors tend to rotate clockwise (Improving → Leading → Weakening → Lagging). It's context for positioning — favor the leading/improving side — not a standalone buy signal.",
        "metrics": [
          {
            "term": "RS-Ratio (x-axis)",
            "plain": "A sector's price versus the market (SPY) over ~60 trading days, scaled so 100 = moving in line; above 100 = outperforming."
          },
          {
            "term": "RS-Momentum (y-axis)",
            "plain": "The 10-day rate of change of that relative strength; above 100 = the outperformance is accelerating, below = fading."
          },
          {
            "term": "Quadrant: Leading",
            "plain": "Strong and still strengthening relative to the market (top-right)."
          },
          {
            "term": "Quadrant: Weakening",
            "plain": "Still strong but losing relative momentum (bottom-right) — often the next to roll over."
          },
          {
            "term": "Quadrant: Lagging",
            "plain": "Weak and still weakening relative to the market (bottom-left)."
          },
          {
            "term": "Quadrant: Improving",
            "plain": "Weak but turning up — early movers that may be starting to lead (top-left)."
          },
          {
            "term": "Tail",
            "plain": "The line behind each dot showing its path over the last ~6 weeks, so you can see the direction of travel."
          }
        ]
      },
      {
        "path": "/leaders",
        "title": "Leaders Board",
        "question": "Which stocks are the strongest performers in this market, and which are breaking out?",
        "how": "Every name is scored on relative strength (RS): its blended return across several timeframes (1 week, 3, 6, and 12 months, with longer horizons weighted more) is ranked against every other name in the universe and expressed as a 1–99 percentile — 99 means it has outrun almost everything. Each stock is also placed in a momentum quadrant (Leading/Improving/Weakening/Lagging) based on its RS level versus whether that strength is accelerating; a strip along the top tallies how many names fall in each quadrant, so you can read whether leadership is broad or narrow. A rocket 'Breakout' tag flags names that are near a 52-week high AND trending up (50-day average above the 200-day average, price above the 200-day). Filter by quadrant, sector, or breakouts-only.",
        "metrics": [
          {
            "term": "RS (relative strength, 1–99)",
            "plain": "Percentile rank of a stock's blended multi-timeframe return against the whole universe; 99 = stronger than 99% of names."
          },
          {
            "term": "Trend quadrant + arrow",
            "plain": "Leading/Improving/Weakening/Lagging from RS level vs whether strength is rising; the arrow shows recent-vs-longer momentum direction."
          },
          {
            "term": "3M / 6M / 1Y",
            "plain": "The stock's plain price return over the past 3 months, 6 months, and 1 year."
          },
          {
            "term": "% from 52wH",
            "plain": "How far below its highest price of the past year the stock currently trades."
          },
          {
            "term": "Breakout 🚀",
            "plain": "Near a 52-week high and in an uptrend (50-day average above the 200-day, and price above the 200-day) — a technical strength flag."
          }
        ]
      },
      {
        "path": "/flow",
        "title": "Options Flow",
        "question": "Where are traders placing unusually large options bets across the big US stocks, and are they bullish or bearish?",
        "how": "First, the basics: an option is a contract on a stock. A call is the right to BUY at a set price (the strike) before a date, so call buyers profit if the stock rises; a put is the right to SELL at the strike, so put buyers profit if it falls (or use it as insurance). The cash paid for the contract is the premium. This board scans the biggest S&P 500 optionable names and lists the largest trades by dollars spent, so you can see where big money is leaning. A green/red bar sums call premium vs put premium as a rough bullish/bearish read. Because mega-caps have options expiring almost daily, expiry-length filters let you separate same-day lottery bets from real multi-week positioning.",
        "metrics": [
          {
            "term": "Call / Put",
            "plain": "Call = a bet the stock rises (right to buy at the strike); Put = a bet it falls or a hedge (right to sell at the strike)."
          },
          {
            "term": "Strike",
            "plain": "The fixed price written into the option contract at which the stock can be bought (call) or sold (put)."
          },
          {
            "term": "Expiry / DTE",
            "plain": "The date the contract expires and 'days to expiration' — how long the bet has to play out."
          },
          {
            "term": "Volume",
            "plain": "How many of these contracts changed hands today — the activity in that specific option."
          },
          {
            "term": "Open interest (OI)",
            "plain": "How many of these contracts are currently outstanding (still held) — a gauge of existing depth at that strike."
          },
          {
            "term": "Vol/OI (unusual)",
            "plain": "Today's volume divided by open interest; above 1 (amber) means more traded today than existed before — fresh positioning, not old bets."
          },
          {
            "term": "Premium",
            "plain": "The dollar value traded = contract volume times the mid price times 100; the board's headline 'how big is this bet' number."
          },
          {
            "term": "IV (implied volatility)",
            "plain": "How much movement the option's price implies, annualized; higher IV = the option is pricier / more move expected."
          },
          {
            "term": "Underlying (+ change %)",
            "plain": "The stock's own current price and its move today, for context on the option bet."
          },
          {
            "term": "Call vs put sentiment bar",
            "plain": "Total call premium vs put premium over the shown slice; call-heavy reads bullish, put-heavy reads bearish or hedging."
          }
        ]
      },
      {
        "path": "/reddit-buzz",
        "title": "Reddit Buzz",
        "question": "Which stocks is the retail crowd suddenly talking about the most?",
        "how": "It counts how often each ticker is mentioned across investing subreddits (r/wallstreetbets, r/stocks, r/investing, and others) over the trailing 24 hours, via ApeWisdom, and tracks how that count and the ticker's rank have changed versus a day earlier. Crucially this is ATTENTION, not sentiment — a spike means the crowd is watching, which flags crowding and possible volatility, but says nothing about whether they're bullish or bearish. Only the roughly 800 most-mentioned names appear; most stocks won't show up at all, which is itself the point. Sort by raw mentions, biggest surge, or fastest climbers.",
        "metrics": [
          {
            "term": "Mentions",
            "plain": "How many times the ticker was mentioned across the tracked subreddits in the last 24 hours."
          },
          {
            "term": "24h Δ",
            "plain": "The percent change in mention count versus 24 hours earlier — how fast attention is rising or falling."
          },
          {
            "term": "Rank Δ",
            "plain": "How many spots the ticker moved up or down the overall buzz leaderboard versus a day ago (▲ = climbing)."
          },
          {
            "term": "Upvotes",
            "plain": "Total upvotes on those Reddit posts — a rough measure of how much the mentions resonated."
          },
          {
            "term": "Rank (#)",
            "plain": "The ticker's current position on the most-mentioned board; 1 = most-talked-about across Reddit right now."
          }
        ]
      },
      {
        "path": "/earnings",
        "title": "Earnings Calendar",
        "question": "Which companies report earnings soon, and how big a move are options pricing in for each?",
        "how": "A day-by-day calendar of upcoming earnings reports for the current index over your chosen window (1 week to 1 month), showing when each company reports (before the open or after the close) with size, consensus EPS (a forward full-year estimate), and year-to-date performance. For US names with a listed options market, it also shows the options-implied move: the up-or-down percentage swing the options market is pricing for the reaction to the report. That implied move is compared to how much the stock has actually tended to move on past earnings, and tagged rich (options look expensive vs history), cheap (look light), or fair. Click a name for the full earnings workup.",
        "metrics": [
          {
            "term": "Session (Before open / After close / TBD)",
            "plain": "Whether the company reports before the market opens, after it closes, or at a time not yet confirmed — this sets which session the reaction hits."
          },
          {
            "term": "Mkt cap",
            "plain": "The company's total stock-market value — used to gauge how important the report is to the index."
          },
          {
            "term": "EPS est",
            "plain": "The Wall Street consensus for the company's earnings per share over the coming year — a forward, full-year figure, not the single quarter being reported."
          },
          {
            "term": "YTD",
            "plain": "The stock's price return so far this calendar year."
          },
          {
            "term": "Implied move (±%)",
            "plain": "The up-or-down swing the options market prices for the earnings reaction — roughly an at-the-money straddle's cost divided by the share price. US optionable names only."
          },
          {
            "term": "Straddle",
            "plain": "A matching call (right to buy) and put (right to sell) at the same strike price — a bet on a big move either way; its cost implies the move."
          },
          {
            "term": "Rich / Cheap / Fair",
            "plain": "Whether the implied move is higher (rich), lower (cheap), or in line (fair) versus the stock's average past earnings-day move."
          }
        ]
      },
      {
        "path": "/macro",
        "title": "Economy (Macro & Rates)",
        "question": "What are US interest rates, inflation, growth, and credit conditions doing — the backdrop for every stock?",
        "how": "A US-macro dashboard built from official Federal Reserve data (FRED), organized into tabs. Rates & Curves plots the Treasury yield curve (the interest rate the government pays across maturities) as it stands now, a month ago, and a year ago, plus the VIX volatility curve and the oil-futures curve. Indicators are cards of key economic readings (inflation, jobs, growth) each openable to a ~5-year history. Credit shows how much extra yield corporate bonds pay over Treasuries — a stress gauge. Calendar lists upcoming US data releases with the economists' consensus and, for GDP, the Atlanta Fed's live nowcast; click a release to see its recent prints.",
        "metrics": [
          {
            "term": "Treasury yield curve (now / 1mo / 1yr)",
            "plain": "The government's borrowing rate at each maturity, drawn as a line; comparing the three lines shows how rates have shifted."
          },
          {
            "term": "Yield",
            "plain": "The annual interest rate a bond pays, in percent."
          },
          {
            "term": "10Y–2Y (curve inversion)",
            "plain": "The 10-year yield minus the 2-year; negative (inverted) means short rates exceed long rates, historically a recession warning."
          },
          {
            "term": "VIX term structure",
            "plain": "Expected S&P 500 volatility priced across time horizons (9 days to 1 year) — the market's near vs far nervousness."
          },
          {
            "term": "WTI crude futures curve",
            "plain": "Oil prices for delivery in successive future months — the shape signals tight vs oversupplied energy markets."
          },
          {
            "term": "Credit spread / OAS",
            "plain": "The extra yield corporate bonds pay over Treasuries (option-adjusted spread); wider = the market pricing more default risk."
          },
          {
            "term": "Investment-grade vs high-yield OAS",
            "plain": "Spreads on safer (investment-grade) vs riskier (high-yield / 'junk') company bonds — the latter is the market's risk-appetite gauge."
          },
          {
            "term": "Consensus estimate",
            "plain": "Economists' average forecast for an upcoming data release, shown so you can gauge the surprise when it prints."
          },
          {
            "term": "GDPNow nowcast",
            "plain": "The Atlanta Fed's running real-time estimate of current-quarter GDP growth, updated as data arrives."
          },
          {
            "term": "Percentage points (pp) vs percent",
            "plain": "Spreads and curve gaps are quoted in percentage points (differences between two rates), not as a percent change."
          }
        ]
      },
      {
        "path": "/rates",
        "title": "Fixed Income (Rates & Credit)",
        "question": "What shape is the bond market in — is the yield curve inverted, and is credit stress building?",
        "how": "A focused bond desk. It draws the US Treasury yield curve (the government's borrowing rate at each maturity) for now versus a month and a year ago, then distills it into a few key spreads — the gaps between yields at different maturities. The headline is 2s10s (the 10-year yield minus the 2-year): when it's negative the curve is 'inverted,' meaning short-term rates are higher than long-term ones, which has historically preceded recessions. A verdict badge labels the curve inverted, flat, or upward-sloping. A maturity table shows each tenor's current yield and how it's changed, and credit-spread charts track how much extra yield corporate bonds pay over Treasuries.",
        "metrics": [
          {
            "term": "Yield curve (now / 1mo / 1yr)",
            "plain": "The government's borrowing rate plotted across maturities, for three dates, so you can see how the whole curve shifted."
          },
          {
            "term": "2s10s (10Y − 2Y)",
            "plain": "The 10-year yield minus the 2-year; negative = inverted (short rates above long), a classic recession lead indicator."
          },
          {
            "term": "3m10y (10Y − 3M)",
            "plain": "The 10-year yield minus the 3-month; another closely watched recession-signal spread."
          },
          {
            "term": "5s30s (30Y − 5Y)",
            "plain": "The 30-year yield minus the 5-year; measures the steepness of the long end of the curve."
          },
          {
            "term": "Inversion verdict",
            "plain": "A plain label — Inverted, Flat, or Upward-sloping — summarizing the curve's shape and what it typically implies."
          },
          {
            "term": "Tenor",
            "plain": "The maturity of a bond (3-month, 2-year, 10-year, etc.)."
          },
          {
            "term": "Δ 1mo / Δ 1yr (bps)",
            "plain": "How much each yield has changed over the past month and year, in basis points (hundredths of a percentage point)."
          },
          {
            "term": "Credit spread / OAS (IG, HY, Baa–10Y)",
            "plain": "Extra yield corporate bonds pay over Treasuries; investment-grade, high-yield, and Moody's Baa versions — wider means more perceived risk."
          }
        ]
      },
      {
        "path": "/fed",
        "title": "Fed Watch",
        "question": "Is the Federal Reserve leaning toward raising or cutting interest rates, and what just changed in their messaging?",
        "how": "The Fed sets short-term interest rates, so its tone moves every market. This page collects the Fed's communications — FOMC policy statements and minutes, speeches by Fed officials, and the Beige Book economic survey — and has an AI read each one and score it on a hawkish-to-dovish scale. Hawkish means leaning toward higher rates to fight inflation; dovish means leaning toward cuts to support growth. A top card shows the latest FOMC statement's stance plus a tally of how recent speeches lean, and each item carries a one-line takeaway and a 'what changed' note versus the prior comparable. It's the policy narrative to sit alongside the raw macro numbers.",
        "metrics": [
          {
            "term": "Hawkish / Dovish / Neutral (bias)",
            "plain": "Hawkish = leaning toward higher rates to curb inflation; dovish = leaning toward cuts to support growth; neutral = balanced."
          },
          {
            "term": "Latest FOMC stance",
            "plain": "The AI-scored lean of the most recent Federal Open Market Committee policy statement — the Fed's official rate decision and message."
          },
          {
            "term": "Speech tally (H / D / N)",
            "plain": "How many recent individual Fed-official speeches read hawkish, dovish, or neutral — the chorus around the official line."
          },
          {
            "term": "Kind (Statement / Minutes / Speech / Beige Book)",
            "plain": "The document type: the rate decision, its detailed meeting notes, an official's speech, or the regional-economy survey."
          },
          {
            "term": "Headline",
            "plain": "A one-sentence AI summary of the policy signal in that specific communication."
          },
          {
            "term": "What changed",
            "plain": "How this statement differs from the previous comparable one — the key edit markets react to."
          }
        ]
      },
      {
        "path": "/breadth",
        "title": "Breadth & Regime",
        "question": "Is this rally (or selloff) broad-based, or is a handful of names carrying the whole market?",
        "how": "'Breadth' measures participation — whether most stocks are joining the move or just a few giants are masking a weak market underneath. This page counts how many names sit above their moving averages (a moving average is the average price over the last N days, a trend line), how many are at new highs vs new lows, and what share are positive over each timeframe, then gives a one-line verdict (broad, mixed, or narrow). A macro-regime strip adds the risk backdrop — volatility gauges and credit and rate conditions — each shown against its own history so you know if today's reading is extreme. A sector table breaks participation down by industry.",
        "metrics": [
          {
            "term": "% above 200-day / 50-day MA",
            "plain": "Share of names trading above their average price of the last 200 (or 50) days — the headline gauge of how many are in an uptrend."
          },
          {
            "term": "Golden cross (50>200)",
            "plain": "Share of names whose 50-day average sits above their 200-day average — a broad measure of established uptrends."
          },
          {
            "term": "Within 3% of 52-week high",
            "plain": "Share of names trading near their yearly high (with the count near the yearly low shown alongside)."
          },
          {
            "term": "Advancers vs decliners",
            "plain": "How many stocks rose vs fell today — the simplest daily breadth reading."
          },
          {
            "term": "New highs vs new lows",
            "plain": "How many names hit a fresh 52-week high vs a fresh 52-week low; a net negative reading warns of internal weakness."
          },
          {
            "term": "% positive over 1W/3M/6M/1Y",
            "plain": "The share of names with a positive return over each period — broad strength shows up as high percentages across the board."
          },
          {
            "term": "VIX / VXN / RVX",
            "plain": "Expected volatility of the S&P 500, Nasdaq, and Russell 2000 respectively — the 'fear gauges'; higher = more stress priced in."
          },
          {
            "term": "HY credit (OAS)",
            "plain": "The extra yield high-yield ('junk') company bonds pay over Treasuries — a risk-appetite gauge that widens under stress."
          },
          {
            "term": "10Y–2Y curve",
            "plain": "The 10-year minus 2-year Treasury yield; negative (inverted) is a classic recession warning shown here for context."
          },
          {
            "term": "Financial conditions (NFCI)",
            "plain": "A Fed index of how loose or tight overall money/credit conditions are; below zero = looser than average, above = tighter."
          },
          {
            "term": "Percentile vs history",
            "plain": "Where each regime reading sits against its own past — 90th percentile means higher than 90% of historical readings."
          },
          {
            "term": "Sector breadth (% above 200d/50d, avg 1D)",
            "plain": "The same participation gauges plus average daily move, broken out per sector to show which groups are strong or weak."
          }
        ]
      }
    ]
  },
  {
    "key": "vol-positioning",
    "title": "Options — Volatility & Dealer Positioning",
    "blurb": "How a name’s options are priced across strikes and expiries, and where option dealers are positioned to amplify or dampen the next move.",
    "features": [
      {
        "path": "/vol-cone",
        "title": "Realized-Vol Cone",
        "question": "Is this stock unusually calm or unusually jumpy right now, judged only against its own past?",
        "how": "'Volatility' just means how much a stock's price bounces around, and 'realized' volatility measures how much it actually moved recently. This board compares each stock's current movement only to its own past — never to other stocks — so a sleepy utility and a wild growth name are each graded on their own scale. The 'cone' is that stock's full historical range, from its calmest to its wildest, at each time horizon. Sitting near the bottom of the range (a low percentile) means it is unusually quiet right now — often a coiled, compressed state before a big move; sitting near the top means unusually wild, which tends to settle back down over time. The default view sorts the quietest ('coiled') names to the top.",
        "metrics": [
          {
            "term": "Realized volatility (RV)",
            "plain": "How much the stock actually moved recently, expressed as a yearly percentage. Bigger = choppier price action."
          },
          {
            "term": "RV 21d",
            "plain": "Realized volatility over the last ~21 trading days (about one month) — the headline reading."
          },
          {
            "term": "RV 63d / RV 1y",
            "plain": "The same movement measure over ~63 days (a quarter) and ~252 days (a year) — the longer-run backdrop."
          },
          {
            "term": "Volatility cone",
            "plain": "The full range, low to high, that this stock's own realized volatility has spanned in the past, at each time horizon."
          },
          {
            "term": "Percentile (Pct)",
            "plain": "Where today's reading ranks within that history: 0% = the calmest this stock has ever been, 100% = the wildest."
          },
          {
            "term": "Coiled",
            "plain": "Bottom of the cone (low percentile): historically quiet — a compressed state that often precedes a big move."
          },
          {
            "term": "Blown out",
            "plain": "Top of the cone (high percentile): historically wild; such stretches usually calm back down over time."
          },
          {
            "term": "Position-in-cone bar",
            "plain": "A picture of the same thing — the dot is today, the tick marks the median (typical) level, the band spans the historical low-to-high."
          },
          {
            "term": "Term",
            "plain": "Short-horizon volatility (21 days) divided by longer-horizon (126 days), minus one: up-arrow = movement expanding after a recent shock, down-arrow = calming."
          }
        ]
      },
      {
        "path": "/vol-dislocation",
        "title": "Vol Dislocation",
        "question": "Across the market, which stocks' options look expensive (worth selling) or cheap (worth buying) versus how much the stock actually moves?",
        "how": "An option is a contract to buy or sell a stock at a preset price by a preset date, and the price you pay for it — the 'premium' — rises with how much movement the market expects. That expectation, written as a yearly percentage, is called implied volatility. This board divides each stock's implied volatility by its realized (actual recent) volatility. A ratio well above 1 means options are pricing in far more movement than the stock actually delivers — 'rich,' a candidate list for selling options; a ratio near or below 1 means options look cheap relative to the stock's real moves. Stocks reporting earnings soon are flagged, because a known event ahead makes their options expected to be rich, not genuinely mispriced.",
        "metrics": [
          {
            "term": "Implied volatility (IV)",
            "plain": "How much movement the options market is pricing in, as a yearly percentage. Higher = pricier options."
          },
          {
            "term": "ATM",
            "plain": "At-the-money — the option whose strike (its preset price) is closest to today's share price; its price is the cleanest read on expected movement."
          },
          {
            "term": "ATM IV",
            "plain": "The implied volatility of that at-the-money option — the headline 'how much movement is priced in' number."
          },
          {
            "term": "Realized",
            "plain": "Realized volatility — how much the stock actually moved recently. The reality check against implied volatility."
          },
          {
            "term": "IV / RV (variance premium)",
            "plain": "Implied volatility divided by realized volatility. At or above ~1.4 = options look rich (worth selling); at or below ~1.1 = cheap (worth buying)."
          },
          {
            "term": "vs sector",
            "plain": "How much richer (+) or cheaper (−) this name's IV/RV ratio is than the median of its sector peers."
          },
          {
            "term": "Term",
            "plain": "Near-dated IV divided by longer-dated IV. Above 1 means near-term options are extra-pricey, usually because an event is close."
          },
          {
            "term": "Skew",
            "plain": "How much more the market pays to protect against a fall than to bet on a rise (downside 'put' IV minus upside 'call' IV, in volatility points). Positive = crash protection is bid up."
          },
          {
            "term": "IV-rk (IV rank)",
            "plain": "Where today's implied vol sits versus its own recent history (roughly the past year, building up over time), 0–100. High = options historically expensive now."
          },
          {
            "term": "Rich / Cheap",
            "plain": "Rich = IV at least 1.4x realized (a list to consider selling); Cheap = IV at most 1.1x realized (a list to consider buying)."
          },
          {
            "term": "earnings Nd tag",
            "plain": "The company reports earnings in ~N days, inside the option's life — so rich vol is expected event pricing, not a mispricing."
          },
          {
            "term": "thin tag",
            "plain": "Options are lightly traded (little open interest — few contracts outstanding), so this implied-vol reading is less reliable."
          },
          {
            "term": "catalyst (lightning bolt)",
            "plain": "An AI one-line read of recent headlines suggesting why vol may be rich — context, not a recommendation."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/skew",
        "title": "Skew Screener",
        "question": "For which stocks is the options market paying up for downside protection versus, unusually, betting on the upside?",
        "how": "Options come in two types: puts pay off if a stock falls, calls pay off if it rises. Normally investors pay more for downside puts than upside calls — everyone wants crash insurance — so 'skew' (put implied volatility minus call implied volatility) is usually positive. This board ranks that gap. The rare, interesting case is negative skew: calls cost more than puts, meaning the options market is leaning bullish — often speculation about a takeover, a short squeeze (when traders betting against the stock are forced to buy it back, pushing it up), or another positive catalyst. Because it is unusual, pair it with the news before drawing conclusions.",
        "metrics": [
          {
            "term": "Skew",
            "plain": "Out-of-the-money put IV minus out-of-the-money call IV, in volatility points. Positive = downside protection costs more; negative = upside bets do."
          },
          {
            "term": "OTM (out-of-the-money)",
            "plain": "A strike away from today's price — a put below it or a call above it; a pure bet on direction rather than a stock substitute."
          },
          {
            "term": "ATM IV",
            "plain": "Implied volatility at the strike nearest today's price — the baseline 'how much movement is priced in.'"
          },
          {
            "term": "Call skew (negative)",
            "plain": "Calls priced richer than puts — an unusual upside lean, often takeover, squeeze, or positive-catalyst speculation."
          },
          {
            "term": "Put skew",
            "plain": "Puts priced richer than calls — the normal state; 'heavy' (≥15 points) means aggressive downside hedging."
          },
          {
            "term": "Read",
            "plain": "A plain-language label of the skew: 'call skew — upside bid,' 'put skew (normal),' or 'heavy put skew.'"
          },
          {
            "term": "IV / RV",
            "plain": "Implied volatility divided by realized volatility — whether the stock's options are broadly rich (>1.4) or cheap (<1.1)."
          },
          {
            "term": "Risk reversal",
            "plain": "The trade this screens for — selling a put to help pay for buying a call (or the reverse) to lean directionally."
          },
          {
            "term": "Next earnings",
            "plain": "Days until the company reports; a report inside the nearest expiry is flagged, because events distort the skew reading."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/term-structure",
        "title": "Term Structure",
        "question": "For which stocks are near-dated options unusually expensive versus longer-dated ones — a sign an event is looming?",
        "how": "The same stock has options expiring on different dates, and each carries its own implied volatility (the market's forecast of movement). Normally the longer-dated options price in more movement — more can happen over more time — so near-dated options are cheaper; that gentle upward slope is called 'contango.' When near-dated options are instead pricier than longer-dated ones ('backwardation'), the market is bracing for something soon, usually earnings or another catalyst inside the near window. This board ranks that front-versus-back ratio.",
        "metrics": [
          {
            "term": "Term (term crush)",
            "plain": "Near-dated (~1-month) IV divided by longer-dated (~3-month) IV. Above 1 = near-term richer, event-loaded; below 1 = normal."
          },
          {
            "term": "Backwardated",
            "plain": "Near-dated options priced higher than longer-dated ones (ratio at least 1.1) — the market expects a near-term event."
          },
          {
            "term": "Contango",
            "plain": "Near-dated options cheaper than longer-dated ones (ratio at most 0.95) — the normal, calm upward slope."
          },
          {
            "term": "Calendar spread",
            "plain": "The trade this screens for — selling the rich near-dated option while owning a longer-dated one."
          },
          {
            "term": "ATM IV",
            "plain": "Implied volatility at the strike nearest today's price — the baseline expected-movement reading."
          },
          {
            "term": "IV / RV",
            "plain": "Implied volatility divided by realized volatility — whether the name's options are broadly rich (>1.4) or cheap (<1.1)."
          },
          {
            "term": "Setup",
            "plain": "A plain-language label — 'sell front / calendar,' 'own front / reverse,' or 'flat term structure.'"
          },
          {
            "term": "Next earnings",
            "plain": "Days to the earnings report; steep backwardation is usually this event sitting inside the near window."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/dispersion",
        "title": "Dispersion",
        "question": "Is the whole index expected to move calmly while its individual stocks are pricing in big, independent swings — the classic dispersion setup?",
        "how": "There are two kinds of volatility here: the whole index's expected movement (the VIX, a 30-day forecast for the S&P 500) and the average expected movement of its big individual members. If single stocks price in far more movement than the index does, the market expects them to move in different directions and largely cancel out at the index level — that is called low 'implied correlation.' That is exactly when the classic 'dispersion' trade sells index volatility and buys the individual components. When the index and its members price similarly (high correlation), the setup is reversed. All figures approximate the real index, so read them as a regime gauge rather than exact numbers.",
        "metrics": [
          {
            "term": "Index IV (VIX)",
            "plain": "The options market's 30-day expected movement for the S&P 500 index as a whole."
          },
          {
            "term": "VIX",
            "plain": "The common name for that index-level implied-volatility gauge — often called 'the market's fear index.'"
          },
          {
            "term": "Single-name IV",
            "plain": "The average ~1-month expected movement of the index's biggest stocks, weighted by company size."
          },
          {
            "term": "Cap-weighted",
            "plain": "Averaged so bigger companies count more, in proportion to their total market value."
          },
          {
            "term": "Vol spread",
            "plain": "Single-name IV minus index IV, in points. Large positive = stocks price in far more movement than the index."
          },
          {
            "term": "Implied correlation",
            "plain": "How tightly the stocks are expected to move together, backed out of the two volatility numbers. Low = independent moves."
          },
          {
            "term": "Dispersion trade",
            "plain": "Selling index volatility while buying the components — profits if the stocks move independently (low correlation)."
          },
          {
            "term": "Cap-weighted IV by sector",
            "plain": "Each sector's size-weighted expected movement, the number of names in it, and its share of total market value (Cap %)."
          },
          {
            "term": "Highest single-name IV",
            "plain": "The individual stocks pricing in the most movement — the names driving the index's dispersion."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/gamma-board",
        "title": "Dealer Gamma Board",
        "question": "For the most heavily-optioned stocks, are the dealers who hedge those options set up to amplify price moves or to calm them?",
        "how": "When you buy or sell an option, a dealer (a market-making firm) usually takes the other side, then trades the underlying stock to keep its own position neutral — this is 'hedging.' 'Gamma' describes how much that required hedge changes as the stock moves. When dealers are 'short gamma,' their hedging forces them to buy as the stock rises and sell as it falls — chasing and amplifying the move (breakout risk); when they are 'long gamma,' they do the opposite, damping and 'pinning' the stock. The 'flip' is the price where they switch between the two, so sitting right on it means a small move can change the whole regime. It is an end-of-day estimate — a positioning gauge, not a precise measurement.",
        "metrics": [
          {
            "term": "Dealer gamma (GEX)",
            "plain": "The dollars of stock dealers must buy or sell to stay hedged (market-neutral) per 1% move — the size of their hedging footprint."
          },
          {
            "term": "Short gamma (regime)",
            "plain": "Dealers' hedging chases price — buying rallies, selling drops — amplifying moves. Trend / breakout risk."
          },
          {
            "term": "Long gamma (regime)",
            "plain": "Dealers fade price — selling rallies, buying drops — damping and 'pinning' the stock. Calmer, mean-reverting."
          },
          {
            "term": "Net gamma /1%",
            "plain": "Signed dealer gamma per 1% move. Negative = short (amplifies moves); positive = long (damps them)."
          },
          {
            "term": "Gross gamma",
            "plain": "Total gamma to hedge regardless of direction — how big the dealer positioning is overall."
          },
          {
            "term": "Spot",
            "plain": "The stock's current share price."
          },
          {
            "term": "Flip",
            "plain": "The price level where net dealer gamma crosses zero — the boundary between the damping and amplifying regimes."
          },
          {
            "term": "Delta-flip",
            "plain": "How far spot sits from the flip, as a % of price. Near 0 = on the regime boundary, where a small move flips it."
          },
          {
            "term": "P/C (put/call ratio)",
            "plain": "Puts outstanding divided by calls outstanding (open interest). At least 1.3 = put-heavy (defensive); at most 0.7 = call-heavy (speculative)."
          },
          {
            "term": "Call wall",
            "plain": "The strike with the most call options outstanding (open interest) — usually above the current price; can act as a ceiling into expiry."
          },
          {
            "term": "Put wall",
            "plain": "The strike with the most put options outstanding — usually below the current price; can act as a floor / support."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/positioning",
        "title": "Positioning Radar",
        "question": "Which individual stocks are seeing the biggest directional options bets today, and which of those sit right in front of a known upcoming event?",
        "how": "Every day, large options trades cross the tape, and 'premium' is the dollar amount changing hands on each. This board rolls those trades up per stock, so you see which names are being bet on rather than a raw list of contracts. It separates out-of-the-money trades — pure directional bets that the stock rises (calls) or falls (puts) — from deep in-the-money premium, which is often just a stock substitute and not a real opinion. It also flags 'new' positioning (trades whose volume today ran past the contracts already outstanding, so the bet is fresh) and tags any name with a dated catalyst ahead. It is an end-of-day snapshot, so buyer-versus-seller direction is inferred, not confirmed.",
        "metrics": [
          {
            "term": "Premium",
            "plain": "The dollar value of options changing hands — how much money is behind a trade or a name."
          },
          {
            "term": "Lean",
            "plain": "The stock's directional tilt from its out-of-the-money bets — Calls (bullish), Puts (bearish), or Mixed."
          },
          {
            "term": "Total flow",
            "plain": "All option premium traded in the name today — calls and puts, every strike combined (with the trade and strike counts)."
          },
          {
            "term": "Directional (up/down)",
            "plain": "Out-of-the-money premium only — up = calls (upside bets), down = puts (downside bets / hedges) — the cleaner conviction read."
          },
          {
            "term": "OTM (out-of-the-money)",
            "plain": "Strikes away from the price — a bet the stock moves, not a stock substitute; the real directional signal."
          },
          {
            "term": "New",
            "plain": "Premium in contracts where today's volume topped the prior open interest (contracts outstanding) — genuinely new positioning, not churn."
          },
          {
            "term": "Open interest",
            "plain": "The number of a contract still outstanding — the baseline that 'new' positioning is measured against."
          },
          {
            "term": "Catalyst",
            "plain": "A dated event ahead — earnings (within 14d), FDA decision or trial readout (within 45d), or investor day (within 30d), with any implied move."
          },
          {
            "term": "Biggest trade",
            "plain": "The single largest trade in the name — call or put, strike, expiry date, and dollar premium."
          },
          {
            "term": "mkt flow P/C",
            "plain": "Market-wide put premium divided by call premium today — a quick bullish/bearish gauge of the whole tape."
          },
          {
            "term": "chgPct",
            "plain": "The stock's percentage price change on the day, shown under its name."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/coiled",
        "title": "Coiled Springs",
        "question": "Which stocks are both unusually quiet (cheap options) AND positioned for dealers to amplify the next move — a setup for an outsized break?",
        "how": "This board fuses two others. From the vol cone it takes how quiet a stock is versus its own history (quiet = its options are historically cheap). From the gamma board it takes how the dealers hedging those options are positioned: 'short gamma' means their hedging will amplify the next move, 'long gamma' means it will dampen it. A 'coiled spring' is the combination — cheap movement plus an amplifier — so a move would be both inexpensive to bet on and likely to run. It also flags 'pinned' names (quiet but dampened, favoring premium selling) and 'blown' names (already wild and being amplified).",
        "metrics": [
          {
            "term": "Coiled spring",
            "plain": "A stock unusually quiet (cheap options) whose dealers are set to amplify the next move — primed for an outsized break."
          },
          {
            "term": "Setup",
            "plain": "The classification — Coiled (cheap + amplifier), Pinned (quiet + dampened), or Blown (already wild + amplified)."
          },
          {
            "term": "Score",
            "plain": "0–150 gauge: coiled-ness (100 minus vol percentile) + 25 if dealers are short gamma + 25 if spot is near the flip."
          },
          {
            "term": "RV in cone",
            "plain": "A bar showing where current realized volatility sits between the stock's own historical low and high."
          },
          {
            "term": "RV %ile",
            "plain": "Percentile of current realized volatility in the stock's own history — low (at most 25) = quiet/coiled, high (at least 75) = blown out."
          },
          {
            "term": "RV 21d",
            "plain": "Realized volatility over the last ~21 trading days (about a month) — how much the stock has actually moved."
          },
          {
            "term": "Dealer gamma",
            "plain": "Whether the options dealers are short gamma (hedging amplifies moves) or long gamma (hedging dampens them)."
          },
          {
            "term": "Delta-flip",
            "plain": "How far the price sits from the dealer-gamma 'flip' level, as a % — near 0 = on the amplify/dampen boundary."
          },
          {
            "term": "P/C (put/call ratio)",
            "plain": "Puts outstanding divided by calls outstanding — a rough gauge of defensive (high) versus speculative (low) positioning."
          }
        ],
        "usOnly": true
      }
    ]
  },
  {
    "key": "earnings-catalyst",
    "title": "Options — Earnings, Catalysts & the Desks",
    "blurb": "Trading around dated events — earnings prints, FDA decisions, investor days — where options can over- or under-price the move.",
    "features": [
      {
        "path": "/earnings-week",
        "title": "Earnings This Week — the expected moves",
        "question": "Which companies report earnings in the next couple of weeks, and are their options pricing a bigger or smaller move than the stock usually makes on earnings day?",
        "how": "An option is a contract: a call is the right to buy a stock at a set 'strike' price, a put is the right to sell at one, and the 'premium' is what that right costs. Buying the call and put whose strike sits nearest today's share price (a 'straddle') costs a certain amount, and that cost divided by the share price is the expected move — the up-or-down swing the options market charges to hold a position through the report. The board lists every reporter by day and compares that expected move to the stock's own average past earnings-day move: when options price MORE than the stock usually delivers it is tagged 'rich' (favors selling that premium), when they price LESS it is 'cheap' (favors buying the move). Read it as a map of where the options market may be over- or under-charging for the print, not as a buy/sell call.",
        "metrics": [
          {
            "term": "Expected move (±%)",
            "plain": "The up-or-down swing options price for the report: the cost of the call+put struck nearest today's price (the straddle) divided by the share price."
          },
          {
            "term": "Typical (±%, n)",
            "plain": "The stock's average one-day price move on its own past earnings days; n = how many past reports the average uses (under 3 is low-confidence)."
          },
          {
            "term": "Rich / cheap",
            "plain": "Expected move divided by typical move: 1.15x or more is rich (options overpay vs history), 0.85x or less is cheap (options underprice it). Only shown once there are 3+ past reports."
          },
          {
            "term": "When (BMO / AMC)",
            "plain": "Whether the company reports before the market opens (BMO) or after it closes (AMC), inferred from the report's time of day."
          },
          {
            "term": "est badge",
            "plain": "The report date is Yahoo's estimate, not confirmed by the company yet."
          },
          {
            "term": "Sector",
            "plain": "The company's broad industry group."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/earnings-move",
        "title": "Earnings Expected-Move Screener",
        "question": "Across everything reporting soon, where are options pricing the earnings move richer or cheaper than the stock has actually moved — and has buying or selling that move paid off historically?",
        "how": "This is the full, sortable table behind the earnings-week view. The core number is the implied move: the price of the straddle (a paired call + put at the strike nearest the share price) at the option expiry just after the report, divided by the share price — the ± swing the options market charges for the print. It is compared to the stock's historical average earnings-day move; their ratio ('richness') above 1 means options are dearer than history (an edge for selling that premium), below 1 means cheaper (an edge for buying the move). Two backward-looking columns add context: 'cleared' shows how often past moves actually beat what options priced, and 'beat->up' flags names that tend to fall even on good news.",
        "metrics": [
          {
            "term": "Implied move (±%)",
            "plain": "The options-priced earnings swing: the straddle (call+put struck nearest the price) divided by the share price."
          },
          {
            "term": "Implied IV",
            "plain": "Implied volatility — the annualized (roughly one-year) percentage swing implied by the straddle's price. Volatility just means how much a stock tends to move; this reads it off the options themselves rather than a vendor feed."
          },
          {
            "term": "Hist avg (±%)",
            "plain": "The stock's average absolute one-day move over its last several (up to 8) earnings reports."
          },
          {
            "term": "Hist max (±%)",
            "plain": "The single largest one-day earnings move in that historical sample."
          },
          {
            "term": "Richness",
            "plain": "Implied move divided by historical average. Above 1 = options pricing more than the stock has moved (sell-premium edge); below 1 = less (buy-the-move edge)."
          },
          {
            "term": "Cleared",
            "plain": "Of past reports (needs 3+), how often the actual move was bigger than today's implied move — the win rate for buying the straddle. High = buying paid off."
          },
          {
            "term": "Beat->up",
            "plain": "Of past quarters where reported earnings-per-share beat estimates, how often the stock actually rose; 50% or less signals a 'sell-the-news' tendency."
          },
          {
            "term": "Implied range",
            "plain": "The share-price band the options imply by the report: current price plus and minus the implied move."
          },
          {
            "term": "Reports / Exp",
            "plain": "The report date and calendar days away; and the option expiry used plus its days-to-expiry (dte)."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/earnings-setup",
        "title": "Earnings Setup Cards",
        "question": "For names reporting soon, at a glance: is the options-priced earnings move rich or cheap versus how much the stock has actually moved on past reports?",
        "how": "Same math as the earnings screener, shown as one card per upcoming reporter instead of a table. Each card prints the implied move (the straddle — a call and put struck nearest the share price — divided by the share price, the swing options charge for the print) next to the stock's average past earnings move, with a bar whose fill grows as the options look richer relative to that past move. A verdict pill reads it: 'Rich — options dear' (1.15x or more of history, a premium to sell), 'Cheap — options light' (0.85x or less, the market may be underpricing the move), or 'Fair'. It is a fast triage deck, not advice.",
        "metrics": [
          {
            "term": "Implied move (±%)",
            "plain": "The options-priced earnings swing: the straddle (call+put struck nearest the price) divided by the share price."
          },
          {
            "term": "Avg past move (n) / max",
            "plain": "The stock's average one-day move over its last n earnings reports, and the biggest single one."
          },
          {
            "term": "Verdict (Rich / Cheap / Fair)",
            "plain": "Implied move divided by average past move: 1.15x or more is rich (sell premium), 0.85x or less is cheap (buy the move), between is fair."
          },
          {
            "term": "in Nd / today / reported",
            "plain": "Calendar days until the report, computed live from the date so a day-old snapshot doesn't mislabel it."
          },
          {
            "term": "market cap / sector",
            "plain": "Company size (share price times shares) and industry group."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/pead",
        "title": "Post-Earnings Drift",
        "question": "Among stocks that reported recently, which are still drifting in the same direction as their earnings-day reaction — the classic post-earnings-drift momentum?",
        "how": "Post-earnings drift (PEAD) is a long-documented tendency for a stock to keep moving the way it first reacted to an earnings surprise for days afterward, as the news gets fully absorbed. This board lists names that reported in the last 1–12 calendar days and, from the plain daily price series, measures two things: the 'gap' (the earnings-day reaction) and the 'drift' since. When the drift continues the gap's direction it flags 'continuing' (the momentum setup); when it reverses, 'fading'. It is decision support — PEAD is a tendency, not a guarantee.",
        "metrics": [
          {
            "term": "Gap",
            "plain": "The earnings-day reaction: the larger of the report-day or next-morning close-to-close percent move, so before- and after-close reports are treated fairly."
          },
          {
            "term": "Drift since",
            "plain": "The cumulative percent move from the reaction day's close to the latest close — what the stock has done since the market's first verdict."
          },
          {
            "term": "Read (continues / fading)",
            "plain": "Whether the drift is in the same direction as the gap (continuing, the PEAD momentum) or the opposite (fading it)."
          },
          {
            "term": "Reported (Nd ago)",
            "plain": "Calendar days since the report; a name appears the day after its print and drops off after day 12."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/guidance",
        "title": "Guidance — the standing outlook & who beats their own guide",
        "question": "What forward outlook has each company given, did it just raise or cut that outlook, and does it have a habit of guiding low then beating (or over-promising then missing)?",
        "how": "Guidance is a company's own forecast of its coming revenue and earnings-per-share — its number, not an analyst's. Because there's no standard data feed for it, each guide is read by an AI from the company's earnings filing (an 8-K) and re-checked nightly. The board shows the current guide, whether the latest one raised/held/cut versus before, and — where there are at least two comparable quarters — a track record that lines up each quarter's actual result against the guide the company gave a quarter earlier. 'Sandbaggers' habitually guide low then beat (so the guide is effectively a floor); 'over-promisers' reliably miss; 'steady' names are neither.",
        "metrics": [
          {
            "term": "Guide period",
            "plain": "The period the current guidance covers, e.g. FY2026 (full year) or a specific quarter."
          },
          {
            "term": "EPS guide",
            "plain": "The forecast range for earnings-per-share (company profit divided by number of shares)."
          },
          {
            "term": "Revenue guide",
            "plain": "The forecast range for total sales."
          },
          {
            "term": "Action (raise / reaffirm / cut)",
            "plain": "Whether the latest guide lifted, held, or lowered the outlook versus last time — or, less often, started a first guide (initiate) or was mixed. A quick read on momentum."
          },
          {
            "term": "Track record tag",
            "plain": "Sandbagger = guides low and reliably beats; over-promiser = reliably misses; steady = neither. Needs 2+ comparable quarters, so it fills in over time."
          },
          {
            "term": "beats / total",
            "plain": "Of the tracked quarters (beats out of total), how many the company's actual EPS met or beat the guide it had given a quarter earlier."
          },
          {
            "term": "avg vs guide (%)",
            "plain": "The average of actual EPS versus the midpoint of the guide — positive means it tends to come in above its own guidance."
          },
          {
            "term": "Next",
            "plain": "Calendar days until the next earnings report."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/track-record",
        "title": "Earnings Play — Track Record",
        "question": "How have the earnings-prep card's suggested option trades actually done once the companies reported — an honest, forward-logged scorecard?",
        "how": "Every night the app logs the exact option structure its earnings-prep card would suggest for each name about to report — the specific legs, the entry premiums, and the expiry — then grades it the morning after the print, repricing it with the earnings 'event volatility' removed (because an earnings play is a bet on the print itself, not on where the stock drifts weeks later). A 'credit' trade collects premium up front (a sell); a 'debit' pays premium (a buy). The top scorecard aggregates the graded plays into a win rate and average profit/loss; pre-print rows are logged and still awaiting their report. It only accrues forward, so it is a real, unretouched record rather than a backtest.",
        "metrics": [
          {
            "term": "Play / structure",
            "plain": "The specific option trade the card suggested (e.g. sell the straddle) and its legs — the individual call/put positions that make it up."
          },
          {
            "term": "Entry (credit / debit)",
            "plain": "Net cash at entry per share: a credit (+) is premium collected by selling options; a debit (−) is premium paid to buy them."
          },
          {
            "term": "Implied ±",
            "plain": "The options-priced earnings move at the time the play was logged."
          },
          {
            "term": "Realized (+ ✓)",
            "plain": "The actual one-day move after the report; a ✓ means it exceeded the implied move — a win for whoever bought the move."
          },
          {
            "term": "P&L",
            "plain": "Profit or loss per share (times 100 per contract), graded the morning after the print with earnings volatility stripped out."
          },
          {
            "term": "Outcome",
            "plain": "WIN / LOSS / scratch once graded, or PRE-PRINT when logged but still awaiting the report."
          },
          {
            "term": "Win rate / Avg P&L / Total P&L",
            "plain": "The aggregate scorecard across all graded plays."
          },
          {
            "term": "Sell-premium / Buy-premium",
            "plain": "The record split by whether the play sold the move (options were rich) or bought it (options were cheap)."
          },
          {
            "term": "Expiry / dte",
            "plain": "The option expiry used and days to it."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/catalyst-vol",
        "title": "Catalyst Vol — cheap options into an event",
        "question": "Which companies have a scheduled investor or analyst day where the options market isn't charging any extra premium for the event — cheap optionality into a known date?",
        "how": "An investor/analyst/capital-markets day is a scheduled company event (announced in an SEC 8-K filing) that can move the stock. This board prices the straddle (a call + put at the strike nearest the share price) over the expiry that brackets that date — the 'implied' move — and compares it to the stock's own 'baseline': how much it normally swings over the same span based on its recent realized (actual) volatility, meaning how much it has actually been moving lately. A ratio below 1 means the options are pricing LESS movement than the stock's ordinary behavior — no catalyst premium at all. Sourcing a catalyst calendar is genuinely hard, so this covers days announced via 8-K and grows as more are filed.",
        "metrics": [
          {
            "term": "Event",
            "plain": "The type of scheduled catalyst — investor day, analyst day, or capital-markets day — announced in an SEC 8-K filing."
          },
          {
            "term": "Implied ± (move)",
            "plain": "The options-implied move to the expiry bracketing the event: the straddle (call+put struck nearest the price) divided by the share price."
          },
          {
            "term": "Baseline ±",
            "plain": "The stock's own recent realized (actual) volatility — how much it normally moves — projected over the same window; the yardstick for an ordinary, no-event span."
          },
          {
            "term": "Ratio",
            "plain": "Implied divided by baseline. Below ~1 = options underpricing the event (cheap); around 1.35 or more = the event looks already priced in."
          },
          {
            "term": "Date / days / Expiry",
            "plain": "The event date and calendar days away, and the option expiry (plus its days-to-expiry) used to price it."
          },
          {
            "term": "8-K link",
            "plain": "The SEC filing where the event was announced."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/biotech-vol",
        "title": "Biotech Event Vol",
        "question": "For upcoming biotech make-or-break events — FDA decisions and clinical-trial readouts — how heavily are the options loading each event relative to the rest of the biotech field?",
        "how": "A biotech 'binary' is a dated event with a discrete, potentially make-or-break outcome: a PDUFA date (the FDA's scheduled deadline to decide on a drug's approval) or a trial readout (a Phase 2/3 result release). Each is priced against the options chain — the straddle (a call + put struck nearest the share price) over the bracketing expiry (the 'implied' move) versus the stock's baseline from its ordinary realized volatility (how much it has actually been moving lately, with no event). Unlike a routine investor day, a real binary is EXPECTED to move big, so the read is relative: the event premium (implied ÷ baseline) is ranked against the whole biotech cohort. 'Options light' means the market is loading this binary the least (cheap optionality if you believe it's decisive); 'fully loaded' means it's richly priced. The signal is sharpest on single-drug small-caps — a mega-cap pharma will always look light.",
        "metrics": [
          {
            "term": "PDUFA",
            "plain": "The FDA's scheduled target date to decide whether to approve a drug — a hard yes/no catalyst."
          },
          {
            "term": "Readout",
            "plain": "The scheduled release of a clinical trial's results (Phase 2 or 3) — the make-or-break data drop."
          },
          {
            "term": "Implied ±",
            "plain": "The options-implied move to the expiry bracketing the event: the straddle (call+put struck nearest the price) divided by the share price."
          },
          {
            "term": "Baseline ±",
            "plain": "The stock's ordinary move over the same window from its realized (actual) volatility — how much it normally moves, with no event; the yardstick."
          },
          {
            "term": "Premium (ratio)",
            "plain": "Implied divided by baseline: how many multiples of the stock's ordinary movement the options are pricing for the event."
          },
          {
            "term": "Read (options light / fair / fully loaded)",
            "plain": "Where the event premium ranks against the whole biotech field — light = bottom third (least loaded), loaded = top third (richest)."
          },
          {
            "term": "drug · condition · phase",
            "plain": "The drug, the disease it targets, and the trial phase or FDA application type."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/earnings-desk",
        "title": "Earnings Season Desk",
        "question": "Everything that matters for earnings season on one page — who reports this week, where their options are mispriced, who's still drifting, and the standing setups?",
        "how": "A dashboard that digests the individual earnings/options boards into linked widgets; each panel's corner link opens the full board. The number running through everything is the implied move — the straddle (call + put struck nearest the share price) at the expiry bracketing the report, divided by the price — read against the stock's historical average earnings move. That ratio is the verdict: rich (1.15x or more, options overpay — sell premium) or cheap (0.85x or less, options underprice — buy the move). The hero strip shows this week's prints; the widgets below cover mispriced vol, who's still drifting, guidance sandbaggers, and cheap options into scheduled events. All numbers are code-computed from the chain and filings; the AI widget only narrates.",
        "metrics": [
          {
            "term": "d-chip (dN)",
            "plain": "Calendar days until the report (or the event). Note: the board's tooltip mislabels this as 'trading days'."
          },
          {
            "term": "implied vs hist (±%)",
            "plain": "The options-priced earnings move versus the stock's average past earnings move."
          },
          {
            "term": "Rich / Fair / Cheap",
            "plain": "Implied divided by historical: 1.15x or more rich (sell), 0.85x or less cheap (buy), else fair."
          },
          {
            "term": "IV/RV",
            "plain": "Implied vol (the movement options price) divided by 20-day realized vol (the movement the stock actually delivered lately); above ~1.6x, options price far more than reality."
          },
          {
            "term": "skew (▲/▾)",
            "plain": "Which side of options demand leans: ▲ = downside puts (crash protection) bid up, ▾ = upside calls bid up. Puts/calls are the rights to sell/buy at a set price."
          },
          {
            "term": "term / crush",
            "plain": "'Crush' flags when near-term implied vol sits far above later-dated months (event-loaded) — vol likely to collapse once the event passes."
          },
          {
            "term": "day-1 / drift / cont.",
            "plain": "Post-earnings drift: the earnings-day reaction, the move since, and whether it continues (✓) or fades (✗)."
          },
          {
            "term": "beats (x/total) + guide chip",
            "plain": "A sandbagger's record of beating its own guide, plus its latest guidance action (raise/cut)."
          },
          {
            "term": "implied vs base (catalyst)",
            "plain": "For a scheduled event, the options-implied move versus the stock's normal-vol baseline; CHEAP when well below it."
          },
          {
            "term": "AI picks (side / structure / conviction / ⚠)",
            "plain": "The Trade Desk's shortlist: trade direction, option structure, AI confidence, and a ⚠ trap flag."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/trade-desk",
        "title": "Trade Desk — this week's option mispricings",
        "question": "What are this week's handful of clearest option mispricings, found and priced by code and explained in plain English by AI?",
        "how": "Every night the code scans three feeds: names reporting within ~16 days whose options price far more or less movement than the stock's own earnings history, scheduled catalysts (investor days and the like) with cheap straddles, and standing volatility dislocations (options pricing at least 1.6x as much, or 0.9x or less, movement than the stock actually delivers). Candidates that clear those hard filters are scored deterministically and pooled; the AI then narrates the top few — writing the thesis, the key risk, and a conviction, but never inventing a number. 'Sell vol' means options look expensive (sell premium), 'buy vol' means cheap (buy it), 'buy event vol' means cheap options into a specific catalyst. The list is short by design: it's the survivors of the filters, not a ranking of everything.",
        "metrics": [
          {
            "term": "Side (Sell vol / Buy vol / Buy event vol)",
            "plain": "Whether the edge is to sell options (expensive), buy options (cheap), or buy them into a specific catalyst. 'Vol' = expected movement, the main thing an option's price reflects."
          },
          {
            "term": "Structure",
            "plain": "The specific option trade the code picked, e.g. 'sell the at-the-money straddle' (the call and put struck nearest the price)."
          },
          {
            "term": "Stat",
            "plain": "The code-computed hard number behind the edge, e.g. '±6.2% implied vs ±3.1% historical'."
          },
          {
            "term": "Conviction",
            "plain": "The AI's confidence in the setup: low, medium, or high."
          },
          {
            "term": "⚠ trap",
            "plain": "The 'cheap' edge may just reflect a known pending event already priced elsewhere — not a free mispricing."
          },
          {
            "term": "Thesis / Risk",
            "plain": "The AI's plain-English rationale and the single biggest risk — grounded only in the code's numbers."
          },
          {
            "term": "Event",
            "plain": "The catalyst and date driving the idea, where there is one."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/catalyst-calendar",
        "title": "Catalyst Calendar",
        "question": "What dated events are coming up across the market — earnings, investor days, clinical readouts, IPO lockup expiries — on one chronological timeline?",
        "how": "A pure aggregation of the app's forward-dated feeds onto a single calendar, grouped by date, with no new data pipeline. You can filter by event type and by horizon (2 weeks, 1 month, 3 months). Where a feed already has an options-implied move (earnings, investor days) it shows in the detail line. It answers 'what's on the schedule and when', so you can see clusters of events without checking several boards.",
        "metrics": [
          {
            "term": "Earnings",
            "plain": "The company's scheduled quarterly results date."
          },
          {
            "term": "Investor day",
            "plain": "A scheduled analyst / investor / capital-markets day."
          },
          {
            "term": "Biotech readout",
            "plain": "An FDA decision date (PDUFA) or a clinical-trial result date."
          },
          {
            "term": "IPO lockup",
            "plain": "The date insiders of a newly-public company are first allowed to sell shares — often adds selling pressure."
          },
          {
            "term": "detail",
            "plain": "Extra context on the row: the implied move where priced, the drug and disease for biotech, or the IPO date and offering size for a lockup."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/binary-week",
        "title": "Binary Events This Week",
        "question": "In the next week or so, which dated events could move a stock hard — ranked biggest-potential-mover first?",
        "how": "One ranked list joining the app's forward feeds (earnings, biotech FDA decisions and readouts, investor days, IPO lockups) so you don't have to check six boards. Events are ranked by the options-implied move where the market prices one; where nothing prices the event (many small-cap readouts), it's ranked on a type prior — an FDA decision or trial readout is treated as high-impact by nature. 'Hard binaries' — FDA decisions and clinical readouts, which have discrete make-or-break outcomes — are flagged with a ◆ and can be isolated with the Binaries filter. Horizon is adjustable (7 / 14 / 30 days).",
        "metrics": [
          {
            "term": "Implied ±",
            "plain": "The options-implied move where the market prices one; a dash means no options price the event and it's ranked on its type instead."
          },
          {
            "term": "Hard binary (◆)",
            "plain": "A discrete, potentially make-or-break outcome — an FDA decision or a clinical readout."
          },
          {
            "term": "Event kind",
            "plain": "FDA decision, clinical readout, earnings, investor day, or IPO lockup — each color-tagged."
          },
          {
            "term": "When",
            "plain": "The event date and how soon it is (today / tomorrow / in N days)."
          }
        ],
        "usOnly": true
      }
    ]
  },
  {
    "key": "income-eventdriven",
    "title": "Options Income & Event-Driven",
    "blurb": "Selling option premium on quality names, plus the classic event-driven playbook: spin-offs, activism, IPOs, and deals.",
    "features": [
      {
        "path": "/put-writing",
        "title": "Put-Writing Screener",
        "question": "Among quality US stocks I'd be happy to own, which are paying the richest premium right now to sell downside insurance (cash-secured puts)?",
        "how": "A put option is a contract; selling one is a promise to buy 100 shares at a set 'strike' price if the stock falls to it, and you're paid cash ('premium') up front for that promise. 'Cash-secured' means you park enough cash to actually buy the shares if forced to. This screen starts from quality large caps (market value >$1B, return-on-equity >15%, P/E under 25 — names you'd want to own anyway) and, for each, picks a put whose strike sits about one standard deviation below today's price — a '16-delta' put, meaning roughly a one-in-six (about 16%) chance the stock finishes below it and you're assigned — expiring in about a month, plus a further-out, lower-odds 3-month version. It then ranks by the annualized income you'd collect. Read it as: a high annualized yield plus a big cushion (room to fall before you're on the hook), on a name not reporting earnings before the put expires, means the market is paying you well to take a risk you'd accept anyway.",
        "metrics": [
          {
            "term": "Price",
            "plain": "Current share price."
          },
          {
            "term": "Mkt cap",
            "plain": "Total value of all the company's shares (price times share count)."
          },
          {
            "term": "ROE",
            "plain": "Return on equity — annual profit as a percent of shareholder money; the screen keeps only names above 15% (a quality filter)."
          },
          {
            "term": "P/E",
            "plain": "Price divided by yearly per-share earnings — dollars paid per $1 of profit; screened to 0–25 (not too pricey)."
          },
          {
            "term": "Vol rank",
            "plain": "Where the stock's recent price-swing size sits in its own past year, 0–100; 50+ means swings are unusually large now, so options pay more. A small superscript 'r' means it's measured from actual past price moves (realized volatility) until enough options-implied history builds up."
          },
          {
            "term": "ATM IV",
            "plain": "Implied volatility of the at-the-money option (the one whose strike sits nearest today's price). Implied volatility is the size of the yearly price swing the options market is pricing in; higher means pricier options and fatter premiums to collect."
          },
          {
            "term": "16Δ put (strike + Δ)",
            "plain": "The strike price you'd be obligated to buy at, shown with its delta (~0.16). Delta doubles as a rough assignment probability, so ~0.16 means about a one-in-six chance you actually end up buying the shares. (The 3-month tab uses a lower-odds ~10-delta strike, further from today's price.)"
          },
          {
            "term": "Exp / DTE",
            "plain": "The option's expiry date and the number of days until it expires (DTE = days to expiry)."
          },
          {
            "term": "Earnings",
            "plain": "Next earnings-report date and days away; an amber warning flags a report landing before the put expires, meaning you'd hold through an event that can gap the stock."
          },
          {
            "term": "Premium",
            "plain": "Cash collected per share for selling the put (multiply by 100 for one contract)."
          },
          {
            "term": "Ann. yield",
            "plain": "The premium expressed as a yearly percent return on the cash you set aside (roughly the strike times 100), so trades of different lengths compare fairly."
          },
          {
            "term": "Cushion",
            "plain": "How far the stock can fall before it reaches the strike — your margin of safety."
          },
          {
            "term": "Breakeven",
            "plain": "The effective purchase price if you're assigned the shares (strike minus the premium you were paid); below it you start losing money."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/covered-call",
        "title": "Covered-Call Screener",
        "question": "On quality stocks I already own (or would buy), which pay the most to sell away some upside via covered calls?",
        "how": "A call option is a contract; selling one against 100 shares you own is a promise to sell them at a set strike price if the stock rises to it, in exchange for cash premium now — that caps your gains above the strike but pays income today. From the same quality pool as put-writing (market value >$1B, ROE >15%, P/E under 25), this prices a call with about a one-in-three chance of being called (a 30-delta call, whose strike sits above today's price) expiring in a month, plus a lower-odds 3-month version that leaves more room to run. It shows the plain income you keep if the stock stays below the strike, the total return if the stock rises through and your shares get sold, and how much upside you're capping. Read it as: a high income yield with a generous upside cap is attractive income — but an earnings report before expiry can gap the stock through your strike and call away a winner.",
        "metrics": [
          {
            "term": "Price",
            "plain": "Current share price."
          },
          {
            "term": "Mkt cap",
            "plain": "Total market value of the company's shares."
          },
          {
            "term": "ROE",
            "plain": "Return on equity — annual profit as a percent of shareholder money; a quality filter (>15%)."
          },
          {
            "term": "P/E",
            "plain": "Price divided by per-share earnings; dollars paid per $1 of annual profit."
          },
          {
            "term": "Vol rank",
            "plain": "Where the stock's recent swing size sits in its own past year (0–100); higher means richer option premiums. A superscript 'r' means it's measured from actual past moves (realized volatility) until enough options-implied history accrues."
          },
          {
            "term": "ATM IV",
            "plain": "Implied volatility of the at-the-money option (strike nearest today's price) — the size of the yearly price move the options market is pricing in; higher means pricier options."
          },
          {
            "term": "30Δ call (strike + Δ)",
            "plain": "The strike above today's price where your shares would be sold if the stock rises there, shown with its delta (~0.30). Delta doubles as a rough probability, so ~0.30 means about a 30% chance of being called away. (The 3-month tab uses a lower-odds ~20-delta strike, further out.)"
          },
          {
            "term": "Exp / DTE",
            "plain": "The call's expiry date and days until it expires (DTE = days to expiry)."
          },
          {
            "term": "Earnings",
            "plain": "Next earnings date; amber-flagged if it falls before the call expires (an earnings gap can call away a winner or eat your premium cushion)."
          },
          {
            "term": "Premium",
            "plain": "Cash collected per share for selling the call (times 100 per contract)."
          },
          {
            "term": "Income yield",
            "plain": "Premium divided by share price, annualized — the repeatable income you keep each cycle if the stock stays below the strike."
          },
          {
            "term": "If-called",
            "plain": "The one-time total return to expiry if your shares are sold at the strike (premium plus the price gain up to the strike, over today's price); a period return, not annualized."
          },
          {
            "term": "Upside cap",
            "plain": "How far the stock can rise before your shares are called away (strike minus price, over price)."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/credit-spreads",
        "title": "Credit-Spread Screener",
        "question": "Which quality names offer the best defined-risk premium-selling trades — income without locking up a big pile of cash?",
        "how": "A credit spread sells one option and buys a cheaper, further-away one as built-in insurance, so your worst-case loss is capped ('defined risk') and you don't need to set aside the full purchase price like a cash-secured put. Two structures: a Bull-Put Spread (sell a put with about a one-in-six chance of being assigned — a '16-delta' put — and buy a cheaper, further-out put below it as insurance; profits if the stock stays flat-to-up) and an Iron Condor (a bull-put plus a mirror-image bear-call above the price — collects premium on both sides, profits if the stock stays inside a range). Rows are ranked by return-on-risk: the cash collected divided by the most you could lose. Read it as a tradeoff between return-on-risk and probability-of-profit (the odds the strikes you sold are never breached) — pushing for higher odds usually means accepting a lower payoff.",
        "metrics": [
          {
            "term": "Price",
            "plain": "Current share price."
          },
          {
            "term": "Vol rank",
            "plain": "Where recent price-swing size sits in the stock's own past year (0–100); higher means richer premium to sell. A superscript 'r' means it's from actual past moves (realized volatility) until options-implied history builds up."
          },
          {
            "term": "ATM IV",
            "plain": "Implied volatility of the at-the-money option (strike nearest today's price) — the yearly move the options market is pricing in."
          },
          {
            "term": "Short / Long (or Put·Call wings)",
            "plain": "The strikes: the option you sell (short) and the cheaper protective one you buy (long); an iron condor shows a put pair and a call pair."
          },
          {
            "term": "Exp / DTE",
            "plain": "Expiry date and days until expiry (DTE)."
          },
          {
            "term": "Earnings",
            "plain": "Next earnings date; amber-flagged if before expiry, since an earnings gap can blow through a strike you sold."
          },
          {
            "term": "Credit",
            "plain": "Net cash collected up front per share (times 100 per spread)."
          },
          {
            "term": "Max loss",
            "plain": "The most you can lose — the gap between the two strikes (the 'width') minus the credit; this is your defined risk."
          },
          {
            "term": "RoR",
            "plain": "Return on risk — credit divided by max loss; the payoff relative to what's at stake, to expiry."
          },
          {
            "term": "POP",
            "plain": "Probability of profit — the modeled odds the options you sold expire worthless (the stock never reaches them), so the trade wins; roughly 1 minus the sold option's assignment probability."
          },
          {
            "term": "Break-even",
            "plain": "The price where the trade flips from profit to loss (short strike minus credit for a bull-put; a low-to-high range for a condor)."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/spinoffs",
        "title": "Spin-offs",
        "question": "Which spin-offs are coming down the pipe, and among those already trading, which have seen enough forced selling exhaust that the stock may be near a bottom?",
        "how": "Two sections covering the separation lifecycle. UPCOMING: companies that have filed a Form 10 (the SEC registration a subsidiary files to become an independent public company — the canonical, months-ahead signal a spin is coming) are surfaced with the parent, what's being separated, and the expected timing where the filing states it; a 'stage' tag reads the registration age and amendment count (a Form 10 that's been amended and pending a while is usually close to completing). COMPLETED: once a spin is trading, the 'share-register turnover clock' tracks total volume since the spin (including 'when-issued' trading) as a percent of shares outstanding — index funds and parent holders who never chose the new stock dump it, and that forced selling exhausts as the register turns over. A 2020–24 backtest of 28 spins found the old '~50% turned = the bottom' rule now fires too early; the zone that worked was roughly 100–150% turned (median +12% over the next six months). Read it as: coming spins to research early, then names near/through the 100–150% zone that have likely worked off the forced selling.",
        "metrics": [
          {
            "term": "Upcoming — SpinCo / Parent",
            "plain": "A subsidiary registering to be spun off (from its Form 10 filing) and the parent doing the spin. The parent is verified against the filing text; timing and distribution ratio are shown only where the filing states them."
          },
          {
            "term": "Stage (Newly filed / Progressing / Late-stage)",
            "plain": "How far along the registration is, from the days since the first Form 10 and the number of amendments — later-stage filings are typically closer to actually distributing."
          },
          {
            "term": "Briefing →",
            "plain": "A generalist's primer drilled from the SpinCo's Form 10 — what the business is and why it's being spun, how the industry works, the specifically-named competitors, the customer and supplier base, key risks, and a financial snapshot. It's the issuer's own account (its framing of its rivals), pulled from the filing with nothing added from outside — a fast way to get up to speed on an unfamiliar industry."
          },
          {
            "term": "Spinco",
            "plain": "The newly independent company created by the spin-off (ticker and name)."
          },
          {
            "term": "Parent",
            "plain": "The company it was spun out of (name and ticker shown)."
          },
          {
            "term": "Spun / days since",
            "plain": "The date the spin completed and how many days ago that was."
          },
          {
            "term": "Since spin",
            "plain": "The spinco's percent price return from the spin date to now (green up, red down)."
          },
          {
            "term": "Register turned",
            "plain": "Cumulative volume since the spin divided by shares outstanding, as a percent, shown as a bar spanning 0–200% with marks at 100% and 150%; a 'register turned' tag appears once it clears the zone. Because a single share can trade many times, it can exceed 100%."
          },
          {
            "term": "Shares out",
            "plain": "Shares outstanding — the denominator of the turnover calculation."
          },
          {
            "term": "WI vol",
            "plain": "'When-issued' volume — trading in the spinco before its official spin date, where the data vendor carries that line (blank if not)."
          }
        ]
      },
      {
        "path": "/campaigns",
        "title": "Activism & Short Campaigns",
        "question": "Which public companies are being publicly pressured by activist investors or bet against by short-sellers, and how has the stock moved since?",
        "how": "This board pulls three kinds of public campaigns from SEC filings and published research. Activist stakes come from a '13D' — the filing an investor must make after buying more than 5% of a company with intent to push for change (board seats, a sale, cost cuts). Proxy fights are contested attempts to sway a shareholder vote against management (filed as DEFC14A/DFAN14A). Short reports are published bearish research from investors betting the stock falls (they profit if it drops). Each card carries an AI-extracted 'ask' (what an activist wants) or allegation (what a short claims) plus the stock's return since; note that for a short, a positive 'since' means the stock rose, so the short is losing so far. It's a public-disclosure tracker, not a recommendation.",
        "metrics": [
          {
            "term": "Type",
            "plain": "Which campaign it is: an activist stake (13D), a proxy fight, or a published short-seller report."
          },
          {
            "term": "Ticker / Company",
            "plain": "The company being targeted."
          },
          {
            "term": "Campaigner",
            "plain": "The investor or short-selling firm running the campaign."
          },
          {
            "term": "Ask / allegation",
            "plain": "The one-line summary of what the activist is pushing for, or what the short claims is wrong — pulled from the filing or report by AI."
          },
          {
            "term": "Summary",
            "plain": "A short AI-written recap of the campaign or report, shown beneath the headline ask."
          },
          {
            "term": "Since",
            "plain": "The stock's percent return from the filing/report date to now; for shorts, a positive number means the stock rose (the bet is offside so far)."
          },
          {
            "term": "Date",
            "plain": "When the filing or report was made public."
          },
          {
            "term": "Form",
            "plain": "The SEC form type behind it (e.g. SC 13D, DEFC14A) or 'short report'; links to the source."
          }
        ]
      },
      {
        "path": "/corp-events",
        "title": "Corporate Events",
        "question": "Which companies just announced a one-off corporate catalyst — a buyback, spin-off, strategic review, stock split, or CEO/CFO change?",
        "how": "This runs a full-text search over recent SEC 8-K filings — the form companies must file to disclose material events — across EDGAR, and uses AI to extract five catalyst types. Buybacks are a company repurchasing its own shares, which shrinks the share count and can support the price. Strategic alternatives means management is publicly exploring a sale or breakup. Spin-offs here are announced (not yet completed — they later graduate to the Spinoff Turnover board). Splits divide shares into more or fewer units (cosmetic, but sometimes a sentiment cue), and leadership changes are new CEOs/CFOs. Each card shows an AI headline and the stock's move since the filing; read it as a feed of fresh, discrete catalysts to investigate, not a buy/sell signal.",
        "metrics": [
          {
            "term": "Type",
            "plain": "The catalyst category: buyback, strategic alternatives, spin-off, split, or leadership change."
          },
          {
            "term": "Ticker",
            "plain": "The company that filed the 8-K."
          },
          {
            "term": "Headline",
            "plain": "A one-line AI-written description of the event, taken from the 8-K."
          },
          {
            "term": "Since",
            "plain": "The stock's percent return from the filing date to now."
          },
          {
            "term": "Date",
            "plain": "The 8-K filing date; a link opens the original filing."
          }
        ]
      },
      {
        "path": "/ipos",
        "title": "IPOs & Lockups",
        "question": "What companies are about to go public, which recently listed and how are they trading, and when do post-IPO lockups expire (a potential wave of insider selling)?",
        "how": "Built from SEC filings in three tabs. Upcoming IPOs are companies that filed an S-1/F-1 registration to go public — the pipeline; they aren't trading yet and a ticker may be provisional. Recent IPOs are newly listed names (from the 424B4 final prospectus), shown with their return from the offer price. Lockups are the calendar of when the roughly 180-day post-IPO 'lockup' expires — the point where early insiders and venture backers can finally sell, which adds share supply and can pressure names that ran up after listing. Each row links to an AI summary of the prospectus (business, sector, underwriters, deal size); lockup dates assume the standard ~180 days and actual terms vary.",
        "metrics": [
          {
            "term": "Company / Ticker",
            "plain": "The issuer; upcoming deals may show only a proposed ticker."
          },
          {
            "term": "Filed / IPO date",
            "plain": "When it filed to go public (upcoming) or its listing date (recent)."
          },
          {
            "term": "Sector",
            "plain": "The company's business sector, read from the prospectus by AI."
          },
          {
            "term": "Proposed / Offer price",
            "plain": "The expected (upcoming) or final (recent) per-share offering price."
          },
          {
            "term": "Size",
            "plain": "Dollars raised in the offering."
          },
          {
            "term": "Since IPO",
            "plain": "Percent return from the offer price to now (recent IPOs and lockups only)."
          },
          {
            "term": "Lockup expiry",
            "plain": "The ~180-day date insiders can first sell, with a countdown that turns amber inside 14 days (recent IPOs and lockups only). Terms assumed standard; actual terms vary."
          },
          {
            "term": "Underwriters",
            "plain": "The investment banks running the offering."
          }
        ]
      },
      {
        "path": "/biotech-catalysts",
        "title": "Biotech Catalysts",
        "question": "Which drug and biotech stocks have a make-or-break binary event coming — a trial readout, an FDA decision date, or a fresh rejection?",
        "how": "A 'binary event' is a scheduled yes/no outcome that can violently move a small drug stock in a single day — a clinical-trial result or a regulator's ruling. This radar pulls recent status changes on Phase 2/3 trials from ClinicalTrials.gov (enrollment finished means a readout is ahead; completed means results are pending; terminated or suspended usually means failure) and, from company 8-K filings, two dated FDA events: PDUFA dates (the FDA's target decision day on a drug application — a hard, dated catalyst) and Complete Response Letters (a CRL is the FDA declining to approve, the negative outcome). Each is mapped to the public ticker with a countdown clock; filter by kind and sort by soonest readout. Trial dates are estimates — a completion date is not the same as the results-announcement date — so treat this as a watchlist, not advice.",
        "metrics": [
          {
            "term": "Ticker / Company",
            "plain": "The drug developer and its stock ticker."
          },
          {
            "term": "Phase",
            "plain": "The trial stage (Phase 2 or 3); later phases are bigger, more decisive tests of whether the drug works."
          },
          {
            "term": "Status",
            "plain": "Enrollment complete (readout ahead), completed (results pending), failed (terminated/suspended), PDUFA (FDA decision date), or CRL (FDA rejection)."
          },
          {
            "term": "PDUFA",
            "plain": "The FDA's target decision date on a drug application — a dated, binary catalyst for the stock."
          },
          {
            "term": "CRL",
            "plain": "Complete Response Letter — the FDA declining to approve an application in its current form; the bad outcome of an FDA review."
          },
          {
            "term": "Readout / PDUFA date + clock",
            "plain": "The estimated results date or FDA decision date, with an 'in N days' / 'N days ago' countdown that turns amber within 90 days."
          },
          {
            "term": "Catalyst",
            "plain": "A plain-language description of the specific event."
          },
          {
            "term": "Condition",
            "plain": "The disease or indication the drug is aimed at."
          },
          {
            "term": "Updated",
            "plain": "When the trial's status last changed."
          }
        ]
      },
      {
        "path": "/policy",
        "title": "Policy & Contracts",
        "question": "Which public companies are helped or hurt by a new federal rule, and who just won a large government contract?",
        "how": "Two feeds, each tied back to public companies. Rules are new federal regulations from the Federal Register — tariffs, EPA, drug-pricing, FAA, FTC actions — that AI maps to the companies they most affect, tagging each stock with a positive or negative impact. Contracts are large government awards from USAspending.gov, mapped to the public contractor that won them, with the dollar value. Read it as: a contract award is a concrete revenue event, while the rule-to-company mapping is a directional, AI-inferred signal rather than a precise read. Not advice.",
        "metrics": [
          {
            "term": "Kind",
            "plain": "Whether the item is a federal rule or a government contract award."
          },
          {
            "term": "Tickers",
            "plain": "The public companies affected, color-coded by impact (positive or negative for a rule; the winner for a contract)."
          },
          {
            "term": "Amount",
            "plain": "The dollar value of the contract award (contracts only)."
          },
          {
            "term": "Summary",
            "plain": "An AI-written description of the rule or the award."
          },
          {
            "term": "Agency",
            "plain": "The federal agency behind the rule or contract."
          },
          {
            "term": "Date",
            "plain": "When the rule was published or the contract awarded; links to the source."
          }
        ]
      },
      {
        "path": "https://arb.bondstreetcp.com/",
        "title": "Merger Arb",
        "question": "On pending takeover deals, how wide is the gap between the target's stock price and the agreed deal value — the return you'd earn if the deal closes?",
        "how": "This is an external link to a dedicated arbitrage desk (arb.bondstreetcp.com), not an in-app board, so the metrics below are the concepts you'll meet there. Merger arbitrage is an event-driven strategy: when Company A agrees to buy Company B, B's shares usually trade a little below the agreed price because there's a chance the deal breaks (regulators block it, financing falls through, shareholders vote no). That gap is the 'spread'; buying the target captures it if the deal closes, but you lose if the deal collapses and the stock falls back toward its pre-deal price. Read it as: a wide spread pays more but signals the market's greater doubt the deal completes — the return compensates you for deal-break risk.",
        "metrics": [
          {
            "term": "Merger-arb spread",
            "plain": "How far the target trades below the agreed deal value; the raw return earned if the deal closes. Wide means the market doubts completion."
          },
          {
            "term": "Annualized return",
            "plain": "The spread scaled to a yearly rate using the expected time to closing, so deals of different lengths can be compared fairly."
          },
          {
            "term": "Cash / exchange ratio",
            "plain": "Cash deals pay a fixed dollar amount per share; stock deals pay a set number of acquirer shares per target share (the 'exchange ratio')."
          },
          {
            "term": "CVR",
            "plain": "Contingent value right — an extra payout to target holders if a future milestone is met, on top of the headline deal price."
          },
          {
            "term": "Break price",
            "plain": "The estimated price the target would fall back to if the deal collapses — your downside at risk."
          }
        ]
      }
    ]
  },
  {
    "key": "screens",
    "title": "Screens & Value",
    "blurb": "Filter the whole market — build-your-own screens, signal-fusion idea scanners, and value boards.",
    "features": [
      {
        "path": "/screener",
        "title": "Screener",
        "question": "Which stocks in this universe match the fundamental, valuation, and technical filters — or the famous investing strategy — I care about?",
        "how": "A sortable table of every company in the chosen universe (e.g. the S&P 500). You stack plain filters — market cap, sector, a P/E ceiling, a dividend-yield or ROE floor, revenue growth, near a 52-week high, price above its 200-day average — and/or switch on one or more preset 'screens': named value/quality strategies, some popularized by famous investors (Greenblatt's Magic Formula, Graham's Net-Net), others standard factor recipes (Rule of 40, Dividend Safety). Turn on two or more screens and a stock must pass ALL of them (an intersection), ranked by its combined standing across them; the Top-N selector sets how many show. Each active screen also pins its own signature column to the table (F-Score for Piotroski, ROIC for Moat, Mkt/NCAV for Net-Net, and so on), so several columns below appear only when their screen is on; otherwise columns switch between a valuation view and a fundamentals view. Click any header to sort, click a row to open the stock; there's also a plain-English search box at the top that turns a typed request into filters. Fundamentals are annual — the most recently reported fiscal year vs the year before.",
        "metrics": [
          {
            "term": "P/E (price-to-earnings)",
            "plain": "Share price divided by earnings per share — dollars paid for one dollar of annual profit. Lower looks cheaper."
          },
          {
            "term": "Fwd P/E",
            "plain": "Same ratio but using analysts' forecast of next year's earnings instead of the last reported year."
          },
          {
            "term": "P/B (price-to-book)",
            "plain": "Price divided by book value (assets minus liabilities) per share; under 1 means priced below accounting net worth."
          },
          {
            "term": "Div Yld (dividend yield)",
            "plain": "Annual dividend per share as a percent of price — the cash income rate from owning it."
          },
          {
            "term": "% fr High / % fr Low",
            "plain": "How far today's price sits below its highest / above its lowest point over the past year."
          },
          {
            "term": "Rev Gr (revenue growth)",
            "plain": "Percent change in yearly sales versus the prior fiscal year."
          },
          {
            "term": "Op Mgn (operating margin)",
            "plain": "Operating profit as a percent of sales — how much of each sales dollar survives running the business."
          },
          {
            "term": "Δ Op Mgn",
            "plain": "Year-over-year change in operating margin, in percentage points; positive means margins widening."
          },
          {
            "term": "Net Mgn (net margin)",
            "plain": "Bottom-line profit, after all costs and taxes, as a percent of sales."
          },
          {
            "term": "DSO (days sales outstanding)",
            "plain": "Average days the company waits to collect cash from customers; a jump can signal strained or aggressive sales."
          },
          {
            "term": "Δ DSO",
            "plain": "Change in that collection period versus a year ago, in days; rising is flagged red (receivables outrunning sales)."
          },
          {
            "term": "FCF Mgn (free-cash-flow margin)",
            "plain": "Cash left after operating costs and capital spending, as a percent of sales."
          },
          {
            "term": "ROE (return on equity)",
            "plain": "Yearly profit divided by shareholders' equity — profit earned on owners' money."
          },
          {
            "term": "ROIC (return on invested capital)",
            "plain": "Profit earned per dollar of all capital (debt plus equity) in the business — a core quality gauge. Shown when a Moat/Quality screen is on."
          },
          {
            "term": "FCF Yld (free-cash-flow yield)",
            "plain": "Free cash flow divided by market value — the cash-return rate if you owned the whole company."
          },
          {
            "term": "F-Score (Piotroski, 0-9)",
            "plain": "A 9-point checklist of financial health (profits, cash flow, debt, margins); 8-9 strengthening, 0-3 deteriorating."
          },
          {
            "term": "Sh. Yield (shareholder yield)",
            "plain": "All cash returned to owners — dividends plus net buybacks (the company repurchasing its own shares) plus debt paydown — as a percent of market value."
          },
          {
            "term": "Nd/EBITDA (net debt to EBITDA)",
            "plain": "Debt minus cash, divided by yearly operating cash earnings — years of earnings to repay debt; 'net cash' means more cash than debt."
          },
          {
            "term": "Mkt / NCAV (Net-Net)",
            "plain": "Net current asset value = current assets minus all liabilities; a 'net-net' trades below that near-liquidation value (Graham deep value)."
          },
          {
            "term": "Rule 40",
            "plain": "Revenue growth % plus free-cash-flow margin %; clearing 40 signals a healthy growth-versus-profit balance."
          },
          {
            "term": "Magic Formula screen",
            "plain": "Greenblatt's rank combining cheapness (earnings yield) and quality (return on capital, proxied by ROE), best names first."
          },
          {
            "term": "ERP5 screen",
            "plain": "A deeper four-factor value rank — earnings yield, return on capital, price-to-book, and cash-flow yield."
          },
          {
            "term": "Quality+Value screen",
            "plain": "One blended rank mixing three cheapness factors (earnings yield, cash-flow yield, low P/B) with three quality factors (ROIC, operating margin, low debt)."
          },
          {
            "term": "Moat screen",
            "plain": "Filter for durable high-return firms (ROIC ≥15%, operating margin ≥20%, low debt) — Buffett-style quality."
          },
          {
            "term": "Quality screen",
            "plain": "Ranks businesses purely on quality — return on capital, margins, cash generation, low debt — blended into one score, ignoring price."
          },
          {
            "term": "M&A Target screen",
            "plain": "Heuristic for a clean, cash-generative mid-cap at a modest multiple an acquirer could buy — attractiveness, not a bid."
          },
          {
            "term": "Cheap vs Peers screen",
            "plain": "Names trading cheap versus their own sector's typical valuation right now (not versus their own past)."
          },
          {
            "term": "Margin Turn screen",
            "plain": "Operating margin widening while sales growth re-accelerates — an early fundamental inflection."
          },
          {
            "term": "Div Safety screen",
            "plain": "Meaningful dividend (yield ≥2%) whose payout looks covered by earnings or cash flow and isn't over-levered."
          }
        ]
      },
      {
        "path": "/backtest",
        "title": "Backtest",
        "question": "If I had held a given price strategy or screen basket over the available history, how would it have performed versus the market?",
        "how": "Pick a price-based strategy — Momentum (hold the strongest recent risers), Trend (hold names above their 10-month average), Low volatility, or Equal-weight everything — or toggle the same preset screens as the Screener to hold that basket. It rebalances monthly, equal-weight, and plots 'growth of 100' against the cap-weighted group as a benchmark. Read the summary tiles for total return, annualized growth, worst drawdown, and risk-adjusted return. Two caveats are printed on the page and matter: screen baskets apply today's fundamentals to past dates (look-ahead bias), and the test only includes names that still exist today (survivorship bias) — treat it as indicative, not a track record.",
        "metrics": [
          {
            "term": "Strategy total",
            "plain": "Total percent gain or loss of the chosen strategy over the whole test period."
          },
          {
            "term": "Benchmark total",
            "plain": "The same total return for the cap-weighted group, shown for comparison."
          },
          {
            "term": "CAGR",
            "plain": "Compound annual growth rate — the smoothed yearly return that would produce that total."
          },
          {
            "term": "Max drawdown",
            "plain": "The largest peak-to-trough drop along the way — the worst decline you'd have sat through."
          },
          {
            "term": "Sharpe",
            "plain": "Annualized return divided by volatility — return earned per unit of risk; higher means steadier."
          },
          {
            "term": "Momentum / Trend / Low volatility / Equal-weight",
            "plain": "The four price-only strategies: hold recent winners / hold uptrends / hold calmest names / hold everything equally."
          },
          {
            "term": "Growth of 100",
            "plain": "Both lines rebased to start at 100 so you compare shapes and relative performance, not dollar amounts."
          },
          {
            "term": "Look-ahead bias",
            "plain": "Using information (today's fundamentals) that wasn't known at the past dates being tested — it flatters results."
          },
          {
            "term": "Survivorship bias",
            "plain": "Testing only companies that still exist, silently dropping ones that went bust or were acquired — also flatters results."
          }
        ]
      },
      {
        "path": "/confluence",
        "title": "Confluence Engine",
        "question": "Which stocks have several unrelated bullish signals stacking up at the same time?",
        "how": "Each night it gathers the independent positive signals the app already tracks and surfaces names where several agree. The premise: one signal is noise, but three unrelated ones pointing the same way is a setup worth investigating. Every name shows a score (more and higher-quality signals lift it), colored chips for which signals fired with a one-line detail each, and for the top names an AI-written thesis / risk / what-to-watch. The legend at the top doubles as a filter. Built across the Russell 3000 (the same US board whatever universe you're browsing). Decision-support, not advice.",
        "metrics": [
          {
            "term": "Confluence score",
            "plain": "Weighted tally of how many independent bullish signals a name carries and how strong each is; higher is more."
          },
          {
            "term": "Value signal",
            "plain": "Trading cheap versus its own 10-year valuation history."
          },
          {
            "term": "Smart money signal",
            "plain": "A well-known professional investor added or newly bought it last quarter, per their 13F filing."
          },
          {
            "term": "13F",
            "plain": "A quarterly SEC filing where large investment managers must disclose the US stocks they hold."
          },
          {
            "term": "Insider buying signal",
            "plain": "Company executives or directors bought shares on the open market with their own cash (SEC Form 4)."
          },
          {
            "term": "Congress signal",
            "plain": "A member of Congress recently bought it (a net buyer), per required trade disclosures."
          },
          {
            "term": "Activist signal",
            "plain": "An activist investor holds a stake and is publicly pushing for change (board seats, a sale, capital return) — a live 13D campaign or open letter."
          },
          {
            "term": "Buyback signal",
            "plain": "The company is genuinely shrinking its share count (a real buyback, not just offsetting stock-based pay), often with a high total shareholder yield — a sign of capital-return discipline."
          },
          {
            "term": "Guidance signal",
            "plain": "Management raised its own forward outlook, or habitually beats its own guide (a 'sandbagger' — so the current guide is probably conservative too)."
          },
          {
            "term": "Estimates rising signal",
            "plain": "Wall Street analysts are raising their earnings-per-share forecasts."
          },
          {
            "term": "Analyst signal",
            "plain": "A recent sell-side upgrade — an analyst raised their rating on the stock."
          },
          {
            "term": "Call flow signal",
            "plain": "Unusually heavy trading in call options (contracts that profit if the stock rises), a bullish tilt."
          },
          {
            "term": "Squeeze fuel signal",
            "plain": "Heavily shorted, so a rise could force bearish traders to buy back and push the price higher."
          },
          {
            "term": "Catalyst signal",
            "plain": "A dated near-term event — often an FDA drug-approval decision (PDUFA) or a trial result — that could unlock the thesis."
          },
          {
            "term": "Spin exhausted signal",
            "plain": "A recently spun-off company whose entire share register has traded ~1–2 times since separation — the point where forced and disinterested sellers are historically done."
          },
          {
            "term": "Thesis / Risk / Watch",
            "plain": "AI-written bull case, what could break it, and the concrete thing that would confirm or refute the setup."
          },
          {
            "term": "YTD · vs high",
            "plain": "Context on each card: the stock's year-to-date price return and how far it trades below its 52-week high."
          },
          {
            "term": "Since flagged / New",
            "plain": "Accountability on each card: the stock's raw price move since the Signal Track Record first logged it on this board, and a New badge for names that appeared on the latest run. The S&P-adjusted grade lives on the Track Record page."
          }
        ]
      },
      {
        "path": "/warnings",
        "title": "Warning Signs",
        "question": "Which stocks have several unrelated bearish signals stacking up — potential value traps or short candidates?",
        "how": "The mirror image of the Confluence Engine: it stacks the independent NEGATIVE signals. A name needs at least two to appear, so it's a pattern rather than a lone flag. The sharpest warnings pair 'Expensive' (still richly valued) with deteriorating fundamentals — a name priced for perfection while its numbers and informed money turn down. Each card shows a warning score, the signal chips with detail lines, and an AI-written bear case / what-would-invalidate-it / what-to-watch. Explicitly a 'reasons for caution are stacking up' board, not a short list — every signal has innocent explanations. Built across the Russell 3000.",
        "metrics": [
          {
            "term": "Warning score",
            "plain": "Weighted tally of stacked bearish signals; higher means more caution flags on the same name."
          },
          {
            "term": "Expensive signal",
            "plain": "Trading rich versus its own 10-year valuation — 'priced for perfection'."
          },
          {
            "term": "Estimates falling signal",
            "plain": "Analysts are cutting their earnings-per-share forecasts (negative revision momentum)."
          },
          {
            "term": "Smart-money exit signal",
            "plain": "Well-known professional investors sold out or sharply trimmed the position last quarter, per their 13F filing — the quarterly SEC disclosure where large managers list their US holdings."
          },
          {
            "term": "Short report signal",
            "plain": "A short-seller published a public research report arguing the stock should fall — the most direct bear signal there is."
          },
          {
            "term": "Guidance cut signal",
            "plain": "Management lowered its own forward outlook for sales or profit."
          },
          {
            "term": "Downgrade signal",
            "plain": "A recent sell-side rating cut."
          },
          {
            "term": "Put-heavy flow signal",
            "plain": "Unusually heavy trading in put options (contracts that profit if the stock falls), a bearish or hedging tilt."
          },
          {
            "term": "Bear case / What invalidates it / Watch",
            "plain": "AI-written: the bear thesis, what would prove it wrong, and the concrete thing to watch."
          },
          {
            "term": "YTD · vs high",
            "plain": "Context on each card: the stock's year-to-date price return and how far it trades below its 52-week high."
          },
          {
            "term": "Since flagged / New",
            "plain": "Accountability on each card: the stock's raw price move since the Signal Track Record first logged it here (on a warning, a FALL is the signal working — shown green), and a New badge for names that appeared on the latest run."
          }
        ]
      },
      {
        "path": "/signal-record",
        "title": "Signal Track Record",
        "question": "Do the idea boards actually work — what happened to their picks after they appeared?",
        "how": "Every night, the moment a name first shows up on an idea board (Confluence, Warning Signs, Short-Squeeze, Leaders breakouts, Insider Buying, Smart-Money, Distribution, Coiled Springs, or the Positioning Radar), it is logged with that day’s price. The record then checks back at fixed horizons — one week, one month, three months — and compares the stock’s return to the S&P 500 over the same window. Bullish boards are graded on beating the index, bearish boards on the stock falling or lagging, and Coiled Springs (a bet on a big move in either direction) on whether the stock moved more than the index did. The log is forward-only: it starts the day tracking began, with no back-filled history — so early numbers are small samples, and the record gets more meaningful every week.",
        "metrics": [
          {
            "term": "Edge",
            "plain": "The one bigger-is-better number: return in excess of the S&P for bullish boards, the inverse for bearish ones, extra movement vs the index for Coiled Springs."
          },
          {
            "term": "Hit rate",
            "plain": "Share of wins — a bullish pick rose, a bearish pick fell, a big-move pick out-moved the index."
          },
          {
            "term": "Logged / Open",
            "plain": "Total entries recorded for a signal, and how many haven’t reached their final three-month check yet."
          },
          {
            "term": "1w / 1m / 3m",
            "plain": "The raw price return from the day a name appeared to roughly one week, one month, and three months later (marked on the first weekday after each boundary)."
          },
          {
            "term": "Entry",
            "plain": "The stock’s price on the day it was logged — the baseline every return is measured from."
          },
          {
            "term": "Seed",
            "plain": "An entry logged on a board’s very first tracked night (the whole board at once, rather than a fresh appearance that day)."
          },
          {
            "term": "Backtest tab (~5y, price signals)",
            "plain": "Replays the signals that can be recomputed purely from past prices (Leaders RS, breakout tag, 12−1 momentum, RSI oversold) at every month-end over ~5 years, grading picks against the same day's equal-weight pool. Boards needing options/positioning/filings history stay forward-only — replaying them would peek at the future. Uses today's index members, so treat the edges as upper bounds."
          },
          {
            "term": "Confluence / Warnings mix",
            "plain": "Attribution within the two fusion boards: each entry records which signal kinds it carried (value, insider buying, buyback… / expensive, short report…), so as grades mature these tables show which kinds actually carry the edge. A name with several kinds counts toward each — conditional performance, not an isolated factor return."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/smart-money",
        "title": "Smart-Money Radar",
        "question": "Which stocks are professional investors and members of Congress quietly accumulating right now?",
        "how": "Cross-references two 'follow the money' sources: super-investor 13F filings (the quarterly disclosures where large managers reveal their US holdings) and congressional trade disclosures. A name appears if well-known managers initiated or added it and/or Congress members are net buyers over the last ~150 days. A conviction score weights brand-new positions most heavily, with adds and Congress buying stacking on. A '⤓ buying the dip' badge flags names being accumulated while they're down. Tabs filter to each source. No AI — a transparent tally, not advice.",
        "metrics": [
          {
            "term": "Conviction score",
            "plain": "Weighted count of informed buying — new positions count most, adds and net Congress buying add on top."
          },
          {
            "term": "initiated / added +X%",
            "plain": "A manager opened a brand-new position, or increased an existing one by that percent, last quarter."
          },
          {
            "term": "13F",
            "plain": "A quarterly SEC filing where large investment managers must disclose the US stocks they hold."
          },
          {
            "term": "Congress buys vs sells · members",
            "plain": "Count of purchase versus sale disclosures by Congress over ~150 days, and how many distinct members traded it."
          },
          {
            "term": "buying the dip",
            "plain": "The informed buying happened while the stock was down year-to-date or well off (≥15% below) its highs."
          },
          {
            "term": "YTD / vs high",
            "plain": "Year-to-date price return and distance below the 52-week high."
          }
        ]
      },
      {
        "path": "/insiders",
        "title": "Insider Cluster-Buying",
        "question": "At which companies are corporate insiders buying their own stock with their own cash — especially several at once?",
        "how": "Ranks the universe by recent open-market insider BUYS from SEC Form 4 filings (transaction code P = an actual purchase, not a stock grant or option exercise) over a trailing window. Executives and directors buying with their own cash — especially on weakness — is a high-conviction accumulation tell. The cluster score blends how many distinct insiders bought (half the weight), dollars spent relative to market cap, and how recent the buying was. 'Clusters' of two-plus buyers rank highest. Open-market buying is rare in mega-caps, so this board is far richer on broad or small-cap universes. US filers only.",
        "metrics": [
          {
            "term": "N× buyers",
            "plain": "How many distinct insiders bought during the window; two or more is a 'cluster' (a stronger signal)."
          },
          {
            "term": "Cluster score (0-100)",
            "plain": "Percentile blend of number of buyers (50%), dollars bought ÷ market cap (30%), and recency (20%)."
          },
          {
            "term": "$ bought",
            "plain": "Total disclosed dollar value of the open-market purchases."
          },
          {
            "term": "Form 4 / code P",
            "plain": "The SEC insider-transaction filing; code P specifically marks an open-market purchase."
          },
          {
            "term": "off 52wH",
            "plain": "Distance below the 52-week high — buying while the stock is down is treated as higher-conviction."
          },
          {
            "term": "insider · role · shares @ price",
            "plain": "Each buyer's name and title, plus the shares, price, dollar value, and date of their purchase."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/revisions",
        "title": "Revisions Momentum",
        "question": "Where is Wall Street quietly raising (or cutting) its earnings forecasts before the next report?",
        "how": "Snapshots each company's consensus earnings-per-share (EPS) estimate now versus 30 and 90 days ago, plus how many analysts revised up versus down, then ranks the universe by 'estimate drift' plus 'revision breadth'. Rising estimates ahead of a report is one of the most durable public-market signals (the post-earnings-drift, or PEAD, factor). A sector strip shows which industries are being marked up. Toggle the downside lens to surface the biggest cuts instead. Coverage is US names first.",
        "metrics": [
          {
            "term": "Momentum (0-100)",
            "plain": "Percentile blend of 90-day EPS estimate drift (60%) and net analyst up-versus-down revisions (40%)."
          },
          {
            "term": "EPS Δ 90d / 30d",
            "plain": "Percent change in this fiscal year's consensus earnings-per-share estimate over the last 90 / 30 days."
          },
          {
            "term": "Revisions ↑X ↓Y",
            "plain": "Number of analysts raising versus lowering their estimate over the last 30 days."
          },
          {
            "term": "Next-yr Δ",
            "plain": "Percent change in next fiscal year's consensus EPS estimate over the last 90 days."
          },
          {
            "term": "Upside",
            "plain": "Average analyst price target versus the current price, as a percent."
          },
          {
            "term": "Sector revision breadth",
            "plain": "Per sector: the average 90-day EPS drift and the share of names that are net-upgraded."
          },
          {
            "term": "PEAD",
            "plain": "Post-earnings-announcement drift — the tendency of stocks with rising estimates or beats to keep drifting that way."
          }
        ]
      },
      {
        "path": "/analyst-upside",
        "title": "Analyst Upside",
        "question": "Where does Wall Street's consensus see the most room between the current price and its price target?",
        "how": "Ranks every covered name by mean price-target upside — the average analyst target divided by the current price, minus one. Alongside it shows the consensus Buy/Hold/Sell rating and the high-to-low spread of individual targets (how much analysts disagree). Read upside WITH the rating: a big upside on a Hold-rated name usually means stale targets or a falling price, not conviction. Only names with at least three covering analysts appear. Price targets are sell-side opinion and often lag the actual price — not advice.",
        "metrics": [
          {
            "term": "Upside",
            "plain": "Mean analyst price target ÷ current price − 1, in percent — the implied room to the target."
          },
          {
            "term": "Target (low-high)",
            "plain": "The consensus (average) analyst price target — conventionally a 12-month view — with the range of individual targets in parentheses."
          },
          {
            "term": "Rating",
            "plain": "The consensus recommendation, from Strong Buy / Buy / Hold down through Underperform / Sell / Strong Sell."
          },
          {
            "term": "# An.",
            "plain": "Number of analysts covering the name (a minimum of three is required to appear)."
          },
          {
            "term": "Average target upside by sector",
            "plain": "Mean upside across each sector, for context on where the Street is most bullish."
          }
        ]
      },
      {
        "path": "/squeeze",
        "title": "Short-Squeeze Radar",
        "question": "Which stocks have the classic short-squeeze setup — heavily shorted, hard to cover, and still being pressed?",
        "how": "First the plain terms: 'short selling' is borrowing shares to sell now, hoping to buy them back cheaper later; a 'squeeze' is when a rising price forces those short sellers to buy back to cap their losses, which pushes the price up further. This board ranks names by three ingredients — short interest as a percent of tradable float, days-to-cover (days of normal volume shorts would need to buy back), and whether shorts are still rising. Crowded plus hard-to-cover plus still-being-pressed scores highest. Tiers bucket names by short percent. Open a candidate's stock page for its live borrow cost. Short-interest data covers US names only.",
        "metrics": [
          {
            "term": "Squeeze score (0-100)",
            "plain": "Percentile blend of short % of float (50%), days-to-cover (30%), and rising short interest (20%)."
          },
          {
            "term": "% Float",
            "plain": "Shares sold short as a percent of the freely-tradable share count — how crowded the short position is."
          },
          {
            "term": "DTC (days to cover)",
            "plain": "Shares short ÷ average daily trading volume — days of normal buying it would take shorts to exit."
          },
          {
            "term": "Shorts MoM",
            "plain": "Month-over-month change in shares short; rising (red) = more squeeze fuel but also more conviction against the name."
          },
          {
            "term": "% from 52wH",
            "plain": "Distance below the 52-week high."
          },
          {
            "term": "Tiers (Extreme/High/Elevated/Moderate)",
            "plain": "Buckets by short % of float: ≥20% / ≥10% / ≥5% / 2-5%."
          },
          {
            "term": "Borrow cost",
            "plain": "The annual fee to borrow the shares to short them (shown on the stock page); high or rising fees signal a tight, squeezable short."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/factor-overlap",
        "title": "Factor-Screen Overlap",
        "question": "Which stocks land near the top of several classic value/quality screens at once?",
        "how": "Runs every one of the Screener's named value/quality screens — thirteen in all (Magic Formula, ERP5, Quality+Value, Net-Net, Piotroski, Shareholder Yield, Moat, Rule of 40, M&A Target, Quality, Cheap vs Peers, Margin Turn, Dividend Safety) — takes the top 50 names of each, and surfaces the ones appearing in two or more. The idea: a business that is cheap AND high-quality AND improving shows up across several different lenses — the all-round profile a single screen can miss. Each card shows how many screens the name hit and its rank within each. Filter by minimum overlap or by a specific lens (the strip lists every screen).",
        "metrics": [
          {
            "term": "N× (overlap count)",
            "plain": "How many of the thirteen screens the name lands in the top 50 of — the breadth of agreement."
          },
          {
            "term": "Screen chip #rank",
            "plain": "Which screens it hit and its position within each one (e.g. 'Moat #4' = 4th-best on the moat screen)."
          },
          {
            "term": "Passes ≥ 2 / 3 / 4",
            "plain": "Filter for the minimum number of screens a name must appear in to be listed."
          },
          {
            "term": "P/E · YTD",
            "plain": "The valuation multiple and year-to-date return shown on each card for quick context."
          },
          {
            "term": "The named screens",
            "plain": "Thirteen preset value/quality strategies (Magic Formula, Net-Net, Piotroski, Moat, Quality, Dividend Safety, etc.) — each defined in the Screener guide."
          }
        ]
      },
      {
        "path": "/comps",
        "title": "Same-Store Sales (Comps) Board",
        "question": "Which restaurants and retailers are posting the strongest same-store sales, and is that strength accelerating or fading?",
        "how": "Same-store sales (also called comparable sales, comps, or like-for-like) strip out newly opened locations to show how a chain's EXISTING stores are doing — the cleanest read on underlying demand. This board ranks every restaurant and retailer that discloses one by its latest comp %, extracted from the earnings release. Watch sequential acceleration (versus last quarter) and the 2-year stack (this comp plus last year's) to separate durable strength from a flattering easy comparison. Each company defines its own comp differently, so compare trends and direction, not absolute levels across names.",
        "metrics": [
          {
            "term": "Comp",
            "plain": "The latest quarter's same-store / comparable sales percent — growth from existing locations only."
          },
          {
            "term": "Δ seq",
            "plain": "Change versus the prior quarter's comp; ▲ = accelerating, ▼ = decelerating."
          },
          {
            "term": "2-yr stack",
            "plain": "This comp plus the comp a year ago — rewards durable strength and defends against an easy prior-year comparison."
          },
          {
            "term": "Traffic · Ticket",
            "plain": "The split of the comp between more customers/visits (traffic) and higher spend per visit (average check/ticket)."
          },
          {
            "term": "Quarter",
            "plain": "The fiscal period the comp is from, linking out to the source earnings filing."
          },
          {
            "term": "Region",
            "plain": "Where the company files: US (SEC 8-K) versus UK/Europe (trading statements / RNS); shown once the list spans more than one region."
          }
        ]
      },
      {
        "path": "/valuation-history",
        "title": "Discount to Own History",
        "question": "Is a stock cheap or expensive versus its OWN typical valuation over the past decade?",
        "how": "For each name it rebuilds a 10-year (up to 40-quarter) history of a valuation multiple from SEC filings and split-adjusted prices, then compares today's multiple to that name's own median. Below its median = 'on sale versus history' (green); above = rich (red). A sparkline shows the path with the middle-half (25th-to-75th-percentile) band shaded and the median dashed. Switch between P/E, EV/EBITDA, P/S, and P/B (financials use P/E and P/B only). An AI 'Genuine / Trap risk / Mixed' tag flags whether a discount reflects stable fundamentals or real deterioration. This is name-relative, not an absolute cheap call — a structurally declining business can sit below its own median for years.",
        "metrics": [
          {
            "term": "[Multiple] now",
            "plain": "The current value of the selected valuation multiple (P/E, EV/EBITDA, P/S, or P/B)."
          },
          {
            "term": "10yr median",
            "plain": "The name's own middle multiple over the past ~10 years — its 'normal' level."
          },
          {
            "term": "vs history (discount)",
            "plain": "Current multiple versus that median, in percent; negative (green) = cheaper than its own usual."
          },
          {
            "term": "z (z-score)",
            "plain": "How many standard deviations the current multiple sits from its own median; −1 is a full step below normal."
          },
          {
            "term": "History band (p25-p75)",
            "plain": "Sparkline of the multiple over time with the middle-half range shaded and the median dashed."
          },
          {
            "term": "n",
            "plain": "How many valid quarters are behind the statistics (at least 8 required)."
          },
          {
            "term": "EV/EBITDA",
            "plain": "Enterprise value (market cap + debt − cash) ÷ operating cash earnings — a valuation multiple that neutralizes how much debt a company carries."
          },
          {
            "term": "P/S (price-to-sales)",
            "plain": "Market value per dollar of annual revenue — useful when profits are thin or negative."
          },
          {
            "term": "Genuine / Trap risk / Mixed",
            "plain": "AI verdict on whether the discount is a real bargain or a 'value trap' where the market is correctly pricing decline."
          }
        ]
      },
      {
        "path": "/buybacks",
        "title": "Buyback & Capital Return",
        "question": "How much does each company hand back to shareholders through buybacks and dividends — and is the buyback actually shrinking the share count, or just offsetting the stock it gives employees?",
        "how": "For every S&P 500 company, one pull of its SEC filings (XBRL) gives the cash it spent repurchasing stock, the dividends it paid, its free cash flow, and its share count — all straight from the filings, nothing estimated. From those: buyback yield (repurchases ÷ market value), total shareholder yield (buybacks + dividends), and the number that separates real buybacks from theatre — the year-over-year change in shares outstanding. A company can spend billions repurchasing stock and still have a flat or rising share count because it hands so much stock to employees; only when the count actually falls do you, the owner, get a bigger slice. Buyback figures are trailing-twelve-months where the quarters are cleanly filed, else the latest full fiscal year; a de-spike drops obvious filing errors (an authorization amount mis-tagged as cash spent). US filers only.",
        "metrics": [
          { "term": "Total yield", "plain": "Buyback yield + dividend yield — all the cash returned to shareholders in a year as a % of the company's market value." },
          { "term": "Buyback yield", "plain": "Cash spent repurchasing shares over the past year ÷ market value. How much of itself the company bought back." },
          { "term": "Net Δ shares", "plain": "The year-over-year change in shares outstanding. Green/negative = the count really shrank (accretive to you); red/positive = the buyback is losing to stock-based-comp dilution. The truth serum of this board." },
          { "term": "Buyback $", "plain": "The actual cash spent on repurchases over the trailing year, from the cash-flow statement." },
          { "term": "Accel", "plain": "The latest quarter's repurchase pace vs the trailing-year run-rate. Above 1 = the company is stepping up buybacks." },
          { "term": "Pay/FCF", "plain": "(Buybacks + dividends) ÷ free cash flow. Above 1 means it's returning more than it earns — funded from the balance sheet or debt, so watch sustainability." },
          { "term": "Flags", "plain": "Shrinking count (real reduction ≥1%), High total yield (≥5%), Accelerating, Over-distributing (returning >FCF)." }
        ],
        "usOnly": true
      },
      {
        "path": "/expectations",
        "title": "Expectations (Reverse-DCF)",
        "question": "What future growth is baked into a stock's price, and is that more or less than the business has actually delivered?",
        "how": "A reverse discounted-cash-flow (DCF): instead of guessing a growth rate to value the company, it solves for the free-cash-flow growth rate the current price already implies, then compares that to what the business has delivered (its 3-year revenue growth rate). Priced for far LESS growth than it delivers = cheap expectations (possible mispricing); far MORE = priced for perfection. It uses a uniform 9% discount rate so every name is comparable and covers only positive-cash-flow non-financials. Approximate by design — a screen, not a price target.",
        "metrics": [
          {
            "term": "FCF yld (free-cash-flow yield)",
            "plain": "Free cash flow (the cash left after operating costs and capital spending) ÷ market value — the cash-return rate at today's price."
          },
          {
            "term": "Implied gr.",
            "plain": "The yearly free-cash-flow growth rate the current price implies, solved for by the reverse-DCF."
          },
          {
            "term": "Delivered",
            "plain": "The growth the business has actually produced — its 3-year revenue growth rate (a proxy for sustainable cash-flow growth)."
          },
          {
            "term": "Gap",
            "plain": "Implied minus delivered; negative (green) = priced below what it delivers (cheap expectations)."
          },
          {
            "term": "DCF upside",
            "plain": "Estimated fair value if the company merely keeps growing at its delivered rate, versus the current price."
          },
          {
            "term": "Reverse-DCF",
            "plain": "Solving for the growth assumption hidden inside today's price, rather than assuming a growth rate to derive a value."
          },
          {
            "term": "Discount rate / terminal growth",
            "plain": "9% used to value future cash for comparability; 2.5% assumed long-run growth after the first 5 years."
          }
        ]
      }
    ]
  },
  {
    "key": "research-ownership",
    "title": "Research, Ownership & Portfolio",
    "blurb": "Dig into one company, see who owns and trades it, and X-ray your own book.",
    "features": [
      {
        "path": "/cef",
        "title": "Closed-End Fund Screener",
        "question": "Which closed-end funds and investment trusts are trading furthest below (or above) the value of the assets they actually hold?",
        "how": "A closed-end fund has a fixed number of shares that trade on an exchange like a stock, so its price can drift away from the per-share value of what it owns (its NAV). This board lists ~360 US funds and ~320 UK trusts and shows each one's gap between price and NAV; a negative gap (a discount) means you buy a dollar of assets for less than a dollar. Green = cheap (discount), red = rich (premium). Filter by region, asset class, and minimum discount, or flag funds whose discount is unusually wide versus their own past year (a z-score of −1 or lower); the top strip shows which whole asset class is out of favor.",
        "metrics": [
          {
            "term": "Disc/Prem (discount/premium)",
            "plain": "Price vs NAV as a %. Negative = discount (price below asset value, cheap); positive = premium (price above asset value)."
          },
          {
            "term": "NAV (net asset value)",
            "plain": "The per-share value of everything the fund holds — what its assets are actually worth."
          },
          {
            "term": "Z 1Y (z-score)",
            "plain": "How far today's discount sits from the fund's own trailing-1-year average, in standard deviations. −1 = about one std cheaper than its norm. Shown for US funds only."
          },
          {
            "term": "52w Avg",
            "plain": "The fund's average premium/discount over the past 52 weeks — its recent normal."
          },
          {
            "term": "Distr Yld (distribution rate)",
            "plain": "Annual cash payout as a % of price. Not guaranteed and can include return of your own capital."
          },
          {
            "term": "Lev (leverage)",
            "plain": "How much the fund borrows to invest, as a % of assets — borrowing amplifies both gains and losses. Shown for US funds only."
          },
          {
            "term": "Price / NAV / Mkt Cap",
            "plain": "Fund share price, per-share asset value, and total market value, shown in the fund's own currency."
          },
          {
            "term": "Category / Mkt (region)",
            "plain": "Morningstar asset-class bucket (e.g. High Yield) and whether the fund is US- or UK-listed."
          }
        ]
      },
      {
        "path": "/cef-hunter",
        "title": "CEF Discount Hunter",
        "question": "Of all US closed-end funds, which are the most stretched bargains right now — cheap versus their own history, not just carrying a big headline discount?",
        "how": "This is the scored shortlist behind the full CEF screener, US funds only. It keeps only US funds above ~$50M that trade at a real discount (price at least 3% below NAV, the per-share value of their holdings) and ranks them by a hunter score blending three things: how deep the discount is, how unusual that discount is versus the fund's own past year, and the distribution yield you collect while waiting for the gap to close. A 'stretched' tag marks funds a full standard deviation or more below their own norm (z ≤ −1). Higher score = a wider-than-usual discount that pays you more to wait.",
        "metrics": [
          {
            "term": "Discount",
            "plain": "Price below NAV, %. NAV is the per-share value of the fund's holdings, so a discount means buying assets for less than they're worth."
          },
          {
            "term": "z",
            "plain": "How unusual today's discount is vs the fund's own past year, in standard deviations; −1 = a standard deviation cheaper than normal (flagged 'stretched')."
          },
          {
            "term": "Yield (distribution rate)",
            "plain": "Annual cash payout as a % of price; can include return of capital and is not guaranteed."
          },
          {
            "term": "Lev. (leverage)",
            "plain": "Borrowing as a % of assets — magnifies both gains and losses."
          },
          {
            "term": "Exp. (expense ratio)",
            "plain": "Annual running cost as a % of assets, including interest on any borrowing."
          },
          {
            "term": "Score",
            "plain": "Composite rank blending discount depth, how stretched the z-score is, and the yield paid while waiting. Higher = a better-scoring bargain."
          }
        ],
        "usOnly": true
      },
      {
        "path": "/holdco-nav",
        "title": "Holdco NAV / Discount Tracker",
        "question": "Which holding companies trade below the combined value of the stakes and assets they own, and how wide is that gap versus their own history?",
        "how": "A holding company (holdco) is a company whose main assets are stakes in other companies. Its 'look-through NAV' is the sum of its listed stakes' market values plus private assets, minus its net debt; comparing that per share to the holdco's own share price gives a discount or premium. Stake prices and FX are pulled live, but net debt, private-asset value, and share counts are hand-entered seed estimates you should verify. A 'stretched' tag flags a discount unusually wide versus the holdco's own recent history (z ≤ −1), and '% mark-to-market' tells you how much of NAV is live listed value versus static estimates. Sort by deepest discount, most stretched, or best coverage.",
        "metrics": [
          {
            "term": "Discount / premium to NAV",
            "plain": "Holdco price vs its look-through per-share asset value, %. Negative = the market values it below the sum of what it owns."
          },
          {
            "term": "Look-through NAV",
            "plain": "Σ(listed stakes) + private/other assets − net debt — an estimate of what the holdco is really worth."
          },
          {
            "term": "Stretched · z",
            "plain": "Z-score of today's discount vs the holdco's own ~1-year history; ≤ −1 = unusually wide (flagged)."
          },
          {
            "term": "vs own history (pctile / z 1y / 3y)",
            "plain": "Where today's discount sits in the holdco's past range; a low percentile or negative z = cheap versus itself."
          },
          {
            "term": "% mark-to-market (coverage)",
            "plain": "Share of NAV that is live listed value vs static private/cash estimates. Higher = less estimate risk in the discount."
          },
          {
            "term": "net debt / cash",
            "plain": "Borrowings minus cash; subtracted from asset value in the NAV. 'Net cash' means more cash than debt."
          },
          {
            "term": "stakes / % of NAV",
            "plain": "Each holding's live value and share of total NAV; a stake that is itself a tracked holdco shows a 'double discount' badge."
          }
        ]
      },
      {
        "path": "/compare-stocks",
        "title": "Compare stocks",
        "question": "How do 2–5 specific companies stack up head-to-head on valuation, quality, growth, and returns?",
        "how": "Pick 2–5 tickers and it lays them side by side across four groups of standard metrics, overlays their margin and revenue-growth trajectories on a chart, and can generate an optional AI head-to-head verdict. The best value in each row is highlighted green — 'best' means lower for P/E, P/B, and leverage (cheaper / less indebted) and higher for margins, growth, yield, and returns. Valuation comes from the latest price snapshot; quality and growth from annual fundamentals. The picked tickers sit in the URL, so a comparison is shareable.",
        "metrics": [
          {
            "term": "P/E",
            "plain": "Price ÷ earnings per share — dollars paid per dollar of annual profit. Lower = cheaper."
          },
          {
            "term": "Fwd P/E",
            "plain": "Same as P/E but on next-year forecast earnings instead of trailing profit."
          },
          {
            "term": "P/B (price-to-book)",
            "plain": "Price ÷ book value (net assets on the balance sheet). Lower = cheaper relative to accounting worth."
          },
          {
            "term": "Div yield",
            "plain": "Annual dividend paid as a % of the share price."
          },
          {
            "term": "ROIC / ROE",
            "plain": "Return on invested capital / on equity — profit generated per dollar of capital or shareholder equity. Higher = more efficient."
          },
          {
            "term": "Gross margin / Operating margin",
            "plain": "Profit left after cost of goods / after operating costs, as a % of revenue."
          },
          {
            "term": "FCF yield",
            "plain": "Free cash flow (cash profit after capital spending) as a % of market value. Higher = more cash return per dollar."
          },
          {
            "term": "Net debt / EBITDA",
            "plain": "Debt minus cash vs annual pre-tax cash earnings (EBITDA) — a leverage multiple. Lower = safer; shows 'net cash' if debt is below cash."
          },
          {
            "term": "Revenue growth (YoY)",
            "plain": "Sales growth versus the same period a year ago."
          },
          {
            "term": "Return · YTD / 1Y",
            "plain": "Share-price return year-to-date and over the trailing one year."
          }
        ]
      },
      {
        "path": "/ratio",
        "title": "Ratio, Spread & Formula Charts",
        "question": "How has one security performed relative to another over time — as a ratio, a spread, or any custom formula?",
        "how": "Plot two securities against each other over time in one of four modes. Ratio (A÷B) shows relative strength — a rising line means A is beating B. Spread (A−B) is the raw price gap. Rebased takes that same A÷B ratio and sets it to 100 at the start of the window, so the single line reads as A's cumulative percentage out- or under-performance versus B (110 means A has beaten B by about 10% over the window). Formula mode evaluates any arithmetic of tickers and numbers (e.g. MDT − 0.19 MMED to estimate the leftover 'stub' value of core Medtronic after subtracting the value of a stake it holds in another listed company). Any Yahoo symbol works, including indices (^GSPC) and ETFs; daily closing prices are aligned by calendar day over your chosen window.",
        "metrics": [
          {
            "term": "Ratio · A ÷ B",
            "plain": "Relative strength — a rising line means the numerator (A) is outperforming the denominator (B)."
          },
          {
            "term": "Spread · A − B",
            "plain": "The raw price difference between the two securities, in their price units (usually dollars)."
          },
          {
            "term": "Rebased · 100",
            "plain": "The A÷B ratio set to 100 at the start of the window, so the single line reads as A's cumulative % out- or under-performance vs B — above 100 = A ahead, below 100 = A behind."
          },
          {
            "term": "Formula ƒ(x)",
            "plain": "Any +, −, ×, ÷ of tickers and numbers, evaluated over the overlap of their price histories — e.g. a spinoff 'stub' value."
          },
          {
            "term": "Hover readout",
            "plain": "Hover any date to see that date and the line's value; in the two-security modes (ratio/spread/rebased) it also shows each underlying leg's closing price that day."
          }
        ]
      },
      {
        "path": "/compare",
        "title": "Sector relative performance",
        "question": "Which market sectors are leading or lagging over a chosen timeframe?",
        "how": "It charts the sector SPDR ETFs — each an exchange-traded basket tracking one sector such as Technology or Energy — rebased to a common 0% start, so every line shows its percentage move over the selected window. The side legend ranks sectors by return over that timeframe, colored green (up) / red (down); click a row to hide or show it, hover to highlight, and use the arrow to open that sector. Choose the timeframe (YTD, 1M, 1Y, etc.) at the top right.",
        "metrics": [
          {
            "term": "Sector ETF",
            "plain": "An exchange-traded basket holding all the stocks in one sector; used as that sector's price proxy."
          },
          {
            "term": "Rebased to %",
            "plain": "Each line starts at 0% so the chart reads as cumulative return, making different sectors directly comparable."
          },
          {
            "term": "[Timeframe] performance",
            "plain": "Each sector's total return over the selected window (YTD/1M/1Y…), shown and ranked in the legend."
          }
        ]
      },
      {
        "path": "/superinvestors",
        "title": "Super-Investors",
        "question": "What are legendary value investors and activists actually holding, buying, and selling, per their latest quarterly SEC filings?",
        "how": "Large investment managers must file a 13F with the SEC each quarter, disclosing their US stock holdings about 45 days after quarter-end — a lagged, long-only snapshot (no shorts, no bonds, no foreign listings). This board curates famous managers; pick one to see their full portfolio, position sizes, new buys, and full exits, or pick 'Most owned' for the names held across the most portfolios (a high-conviction overlap list). A 'This quarter's story' panel is an AI synthesis of the roster's consensus moves. Q/Q badges show how each position changed versus the prior quarter.",
        "metrics": [
          {
            "term": "13F",
            "plain": "Quarterly SEC filing where large managers disclose their US long stock holdings; filed ~45 days after quarter-end, so it lags reality."
          },
          {
            "term": "% Port",
            "plain": "That holding's share of the manager's disclosed portfolio value — a bigger % signals higher conviction."
          },
          {
            "term": "Value",
            "plain": "Dollar market value of the position at quarter-end."
          },
          {
            "term": "Q/Q",
            "plain": "Change vs the prior quarter — NEW (fresh buy), a +/− % change in share count, or — (unchanged)."
          },
          {
            "term": "New buys / Sold out",
            "plain": "Positions opened fresh this quarter / positions fully exited this quarter."
          },
          {
            "term": "Held by (holder count)",
            "plain": "On 'Most owned', how many of the tracked managers own that same name."
          },
          {
            "term": "Top 10",
            "plain": "Share of the portfolio held in its ten largest positions — a quick concentration read."
          },
          {
            "term": "Portfolio / Positions",
            "plain": "The manager's total disclosed dollar value and number of separate holdings."
          }
        ]
      },
      {
        "path": "/distribution",
        "title": "Smart-Money Distribution",
        "question": "Which stocks are the tracked super-investors collectively exiting or sharply trimming — the sell side of their 13Fs?",
        "how": "This is the mirror of the Smart-Money Radar (which shows what gurus are buying). Across the ~56-manager roster's latest 13F filings, it surfaces names that 2 or more managers fully sold out of or sharply cut, so it reflects consensus selling rather than one fund rebalancing; a full exit weighs double a trim when ranking the list. Price context colors the read: gurus dumping a name that's down for the year reads as capitulation ('into weakness' — the thesis may have broken), while selling one that's up reads as profit-taking ('into strength', less alarming). Big caveat: a 13F sale is far noisier than a buy (redemptions and risk limits force selling), so treat this as a flag to investigate, not a short list.",
        "metrics": [
          {
            "term": "Sellers (exited / trim)",
            "plain": "How many managers fully sold out ('exited') vs sharply reduced ('trim'); a full exit weighs double a trim in the ranking."
          },
          {
            "term": "Who's leaving",
            "plain": "The specific managers exiting or trimming the name, with the cut % shown where it's a trim rather than a full exit."
          },
          {
            "term": "YTD",
            "plain": "The stock's year-to-date return — the price context that determines the 'read'."
          },
          {
            "term": "Read — into weakness (capitulation)",
            "plain": "Gurus are selling a name that's down YTD (more than ~5%); may signal the investment thesis has broken."
          },
          {
            "term": "Read — into strength (profit-taking)",
            "plain": "Gurus are selling a name that's up YTD (more than ~5%); less alarming, more likely just locking in gains."
          },
          {
            "term": "Read — mixed",
            "plain": "The stock is roughly flat YTD (within about ±5%) or its return is unknown, so the selling gives no clear directional read."
          },
          {
            "term": "13F",
            "plain": "Quarterly SEC disclosure of managers' US long holdings; lags ~45 days and shows longs only."
          }
        ]
      },
      {
        "path": "/congress",
        "title": "Congressional Trading",
        "question": "What stocks are members of Congress (and the President) buying and selling, as disclosed under the STOCK Act?",
        "how": "The STOCK Act requires members of Congress to disclose their stock trades, filed up to ~45 days after the trade, with amounts reported only as dollar ranges (brackets) rather than exact figures. This board aggregates Senate and House filings — plus the President's OGE filings as an 'Executive' chamber — with summary cards for the most-traded tickers and most-active members. Filter by buy/sell, chamber, or a member/ticker search, and sort by trade date, disclosure date, or amount. Coverage note: some House filings are scanned PDFs that can't be parsed (so House data is partial), and the President's trades are AI-extracted from a scanned filing — spot-check the source.",
        "metrics": [
          {
            "term": "Traded / Disclosed (+Nd)",
            "plain": "The date the trade happened vs the date it was reported; +Nd is the disclosure lag in days."
          },
          {
            "term": "Type (Buy / Sell / Exch)",
            "plain": "Direction of the transaction; Exch = an exchange or swap of assets."
          },
          {
            "term": "Amount",
            "plain": "The disclosed dollar range (bracket), e.g. $15K–$50K — the exact size is not reported."
          },
          {
            "term": "Chamber badge (SEN / REP / PRES)",
            "plain": "Whether the filer is a Senator, a House Representative, or the President (executive branch)."
          },
          {
            "term": "Most-traded tickers (B / S / members)",
            "plain": "For each name, the count of buys vs sells and how many distinct members traded it."
          },
          {
            "term": "Most-active members (trades / tickers)",
            "plain": "Each member's total trade count, number of distinct tickers, and last trade date."
          }
        ]
      },
      {
        "path": "/trump-stocks",
        "title": "Trump's Stock Calls",
        "question": "Which public companies has President Trump named in his Truth Social posts, and how have those stocks moved since?",
        "how": "An AI filter reads his Truth Social posts and keeps only the ones that name a specific public company, tagging each mention as bullish (praise or a helpful deal) or bearish (an attack or threat), then shows the stock's return since the post. A summary strip reports how often his bullish mentions were followed by the stock rising (a 'hit rate') and the average since-return — a scorecard of past calls, not a prediction. Filter by stance or recency, or search a ticker. It is a mention/stance tracker, explicitly not advice.",
        "metrics": [
          {
            "term": "Bullish / Bearish",
            "plain": "AI-classified tone — bullish = praise/endorsement/helpful deal; bearish = an attack or threat toward the company."
          },
          {
            "term": "Since",
            "plain": "The stock's return from the post date to now (also broken out as 1-day, 1-week, and 1-month)."
          },
          {
            "term": "Bullish → up since (hit rate)",
            "plain": "Share of his bullish mentions where the stock is up since the post — how often 'bullish' preceded a gain."
          },
          {
            "term": "Avg since (bullish)",
            "plain": "Mean return from post to now across all of his bullish mentions."
          },
          {
            "term": "Stock calls / posts scanned",
            "plain": "Number of company mentions found versus the total posts the AI filter read."
          }
        ]
      },
      {
        "path": "/research",
        "title": "Filings & Docs",
        "question": "Where in the SEC filings of any US public company does a specific theme, product, risk, or phrase appear?",
        "how": "Full-text search across every US public company's SEC filings — 10-Ks (annual reports), 10-Qs (quarterly reports), 8-Ks (event disclosures) and proxy statements — back to 2001, powered by SEC EDGAR. Type a term (wrap a phrase in quotes for an exact match) and optionally narrow to one form type; it returns matching filings newest-first, each with the matching passage highlighted, and it also surfaces hits inside the recent earnings-call transcripts of the top companies that matched. Because filings use formal wording, it may rewrite a casual term into the filing term (e.g. 'buyback' → 'repurchase') and tell you it did so.",
        "metrics": [
          {
            "term": "10-K / 10-Q / 8-K / DEF 14A",
            "plain": "Annual report / quarterly report / material-event disclosure / proxy statement — the SEC form types you can filter to."
          },
          {
            "term": "Full-text match",
            "plain": "The highlighted passage inside a filing where your search term appears."
          },
          {
            "term": "filings-mention count",
            "plain": "How many filings across the whole corpus contain your term."
          },
          {
            "term": "earnings-call matches",
            "plain": "Hits for the term inside recent earnings-call transcripts of the top matching companies, each with a count and date."
          }
        ]
      },
      {
        "path": "/research-desk",
        "title": "Research Desk",
        "question": "What do all the sell-side research PDFs I've collected on a stock actually say — and where does the Street agree, disagree, or move?",
        "how": "A private, local desk: you ingest sell-side research PDFs (broker reports) and an AI extracts each one's rating, price target, estimates, thesis, and risks into structured fields. Per ticker it builds a consensus view — the spread of ratings, the price-target range and median, and 'battlegrounds' where analysts' estimates diverge most — and can synthesize the Street or answer questions across your notes. A corpus-wide semantic search and an 'actionable' scan surface the biggest rating and price-target moves. The corpus stays private to you and is never redistributed.",
        "metrics": [
          {
            "term": "Rating",
            "plain": "The broker's call (Buy / Hold / Sell, or Overweight/Outperform etc.); green = positive, red = negative."
          },
          {
            "term": "Price target (PT)",
            "plain": "The analyst's expected share price; shown alongside the prior target when it changed."
          },
          {
            "term": "Price-target range / median",
            "plain": "The low-to-high spread of targets across your notes on the name, and the midpoint."
          },
          {
            "term": "Estimates",
            "plain": "Forecast figures (e.g. EPS, revenue) for a period, with the prior value and how they compare to consensus."
          },
          {
            "term": "Battlegrounds",
            "plain": "The metrics where analysts disagree most — where the real debate on the stock sits."
          },
          {
            "term": "Consensus (ratings mix)",
            "plain": "Count of each rating across all your ingested notes on that ticker."
          },
          {
            "term": "PT change % / rating Δ / revision",
            "plain": "On the actionable scan: the size of a target move, whether the rating changed, and the biggest estimate revision."
          },
          {
            "term": "% match",
            "plain": "Relevance score of a passage to your semantic-search query."
          }
        ]
      },
      {
        "path": "/portfolio",
        "title": "Portfolio Risk Cockpit",
        "question": "What are the real exposures and risks hidden in my portfolio — its market sensitivity, concentration, sector and style tilts, and what a market move would do to it?",
        "how": "Paste your book (one SYMBOL SHARES per line; negatives are short positions) and it computes everything live in your browser — nothing is uploaded, and the book is saved locally. It reports gross and net exposure, long/short split, portfolio beta, sector tilts, concentration, style-factor tilts, crowding (how much your names move together), and an interactive market-shock P&L, and it sizes a beta-neutral hedge. A short position (negative shares) profits when a stock falls, so it offsets your longs. Prices and betas are US-only; international tickers are listed but not priced.",
        "metrics": [
          {
            "term": "Gross exposure",
            "plain": "Long value plus short value, both counted positive — the total market you're exposed to."
          },
          {
            "term": "Net exposure",
            "plain": "Longs minus shorts — your net directional bet; also shown as a % of gross."
          },
          {
            "term": "Long / Short",
            "plain": "Total dollar value on each side of the book (owned positions vs bet-against positions)."
          },
          {
            "term": "Beta (β)",
            "plain": "How much a stock or the whole book moves vs the market; 1 = moves with it, above 1 = more, negative = opposite direction."
          },
          {
            "term": "Return (timeframe)",
            "plain": "The book's value-weighted return over the selected window (YTD, 1M, 1Y…)."
          },
          {
            "term": "Market-shock scenario",
            "plain": "Estimated dollar and % profit/loss if the S&P moves X%, computed as Σ(position × beta × move)."
          },
          {
            "term": "Sector exposure",
            "plain": "Net dollars in each sector as a % of gross; the diverging bar shows over- vs under-weights."
          },
          {
            "term": "Concentration — top name / top 5 / eff. # names",
            "plain": "Share of gross in the biggest position and top five; effective # names (1/HHI) is how many equal-weight positions the book behaves like."
          },
          {
            "term": "HHI concentration",
            "plain": "Sum of each position's squared weight; higher = more concentrated in fewer names."
          },
          {
            "term": "Factor tilts",
            "plain": "How far the book leans toward a style (value, quality, momentum, growth, yield, size, low-vol) vs the Russell 1000, in standard deviations (+σ = tilted toward it)."
          },
          {
            "term": "Crowding (avg pairwise ρ)",
            "plain": "Average return correlation among your holdings; high = names move together, i.e. hidden concentration even across different sectors."
          },
          {
            "term": "Beta-neutral hedge",
            "plain": "The dollars of index (SPY) to short or buy so the book's market beta nets to zero, leaving only stock-picking risk."
          }
        ]
      },
      {
        "path": "/portfolio-radar",
        "title": "Portfolio Catalyst Radar",
        "question": "What's about to happen in the names I actually hold — which of my positions has an earnings print, an FDA decision, an investor day, or a lockup expiry coming up, and how big a deal is it?",
        "how": "Paste the same book you use in the cockpit (it reads from the same local store, and never leaves your browser), and it filters the forward Catalyst Calendar down to only your names, soonest first. Each event carries the position side, because the same catalyst is opposite risk on a long vs a short — an FDA readout you're short into is a binary working against you. Events are grouped into this week / this month / later, and rated for impact: binary clinical or regulatory events rank highest, then earnings with a large options-implied move; IPO-lockup expiries flag insider-supply overhangs. Every date and implied move comes straight from the underlying feeds; nothing is invented. It also lists which of your names have no catalyst in the window, so you know the quiet ones. US-market catalysts.",
        "metrics": [
          { "term": "Days-to / date", "plain": "How many days until the catalyst, and the calendar date. The list is ordered soonest-first." },
          { "term": "Long / Short tag", "plain": "Which way you're positioned in that name (from the sign of your shares). A catalyst on a short is directional risk in the opposite direction from the same catalyst on a long." },
          { "term": "Event kind", "plain": "Earnings, investor/analyst day, biotech/FDA readout, or IPO-lockup expiry — colour-coded, with the underlying feed's detail (e.g. the implied move, or the drug + condition)." },
          { "term": "Impact (High / Med / Low)", "plain": "High = a binary clinical/regulatory event or earnings with a big implied move; Medium = a lockup or ordinary print; the count of high-impact events in the next 30 days is summarized up top." },
          { "term": "Quiet names", "plain": "Holdings with no forward catalyst in the next 120 days — surfaced so the absence is explicit, not just missing." }
        ],
        "usOnly": true
      },
      {
        "path": "/portfolio-income",
        "title": "Portfolio Options Income",
        "question": "How much income could I generate writing covered calls against the stocks I already own, and what would it cost me in upside?",
        "how": "A covered call means selling someone the right to buy your shares at a higher (strike) price by a certain date; you keep the cash premium no matter what, and only give up the stock if it rises through the strike. Paste your book (same local store as the Cockpit and Radar — it never leaves your browser) and for each long holding that's in the options-quality universe it shows the best out-of-the-money call at your chosen tenor, sized in real dollars for your actual share count. A ~1-month tenor sells a roughly 30-delta call (more premium, tighter cap on upside); ~3-month sells a ~20-delta call (less premium, more room to run). Short positions are excluded (you need the shares to cover), and lots under 100 shares show the per-share yield but can't write a standard 100-share contract. It flags any holding whose next earnings report lands before the call expires — writing through an earnings print collects richer premium but adds gap-and-assignment risk. Every strike, premium and yield comes from the nightly options scan; nothing is modeled beyond it. US options only.",
        "metrics": [
          { "term": "Sell call (strike · expiry · Δ)", "plain": "The suggested out-of-the-money call to write: its strike price, expiration, days to expiry, and delta (~0.30 for the 1-month, ~0.20 for the 3-month)." },
          { "term": "Premium $", "plain": "The cash you collect up front = premium per share × 100 × the number of whole contracts you can write (shares ÷ 100, rounded down)." },
          { "term": "Ann. yield", "plain": "The static income return — premium ÷ stock price — annualized. What you'd earn if the stock stays flat and you keep re-writing the call each period." },
          { "term": "If called", "plain": "The total annualized return if the stock rises through the strike and your shares are assigned away: the premium plus the gain up to the strike." },
          { "term": "Upside cap", "plain": "How far the stock can rise before your shares get called away (the strike relative to today's price) — the upside you're giving up for the premium." },
          { "term": "⚠ Earnings in window", "plain": "The holding's next earnings print falls before the call expires — extra premium, but gap and early-assignment risk. Cross-check the Catalyst Radar." }
        ],
        "usOnly": true
      },
      {
        "path": "/overnight",
        "title": "Overnight Filings",
        "question": "Which new material SEC filings dropped overnight, what changed in them versus the prior comparable filing, and which look market-moving?",
        "how": "An AI desk scans new SEC filings across US large-caps — 10-Ks/10-Qs (periodic reports), 8-Ks (event disclosures), and deal forms (mergers / stock offerings) — since the prior session, and for each writes a headline, a 'what changed' versus the last comparable filing, a plain takeaway, and key metrics. It tags each with a sentiment (bullish/bearish/neutral), an earnings beat/miss where relevant, and an impact level; high-impact filings get a red or green flag and float to the top. Filter by form, sentiment, sector, or 'movers only'. Each note is AI-generated, so treat it as a triage pointer and spot-check the actual filing.",
        "metrics": [
          {
            "term": "10-K / 10-Q / 8-K / S-4 / 425 / 424B",
            "plain": "Annual report / quarterly report / material-event disclosure / merger paperwork / a stock or securities offering — the filing form types."
          },
          {
            "term": "Sentiment (Bullish / Bearish / Neutral)",
            "plain": "The AI's read of whether the filing's contents look good, bad, or neutral for the stock."
          },
          {
            "term": "Beat / Miss / In-line",
            "plain": "For earnings filings, whether results topped, trailed, or matched expectations."
          },
          {
            "term": "Impact / Movers",
            "plain": "The AI's market-moving importance; 'high' filings get a flag and appear first, and 'Movers' filters to them."
          },
          {
            "term": "Green flag / Red flag / Notable",
            "plain": "A high-impact filing that is bullish (green), bearish (red), or neutral-but-notable."
          },
          {
            "term": "Risk factors +/−",
            "plain": "Machine-diffed count of risk-factor sentences added vs removed compared to the prior comparable filing."
          },
          {
            "term": "What changed",
            "plain": "Bulleted differences the AI found versus the last filing of the same type."
          },
          {
            "term": "Key metrics",
            "plain": "Figures pulled straight from the filing (revenue, EPS, guidance, etc.)."
          }
        ]
      }
    ]
  }
];
