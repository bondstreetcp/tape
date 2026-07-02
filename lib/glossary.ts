// Plain-English definitions for the finance jargon scattered across the app. Surfaced via
// <InfoDot term="…"/> next to a label, so a non-specialist (e.g. a new VA) can hover any
// metric and learn what it means. Keep each under ~22 words, no jargon-to-explain-jargon.

export const GLOSSARY: Record<string, string> = {
  // Valuation
  "P/E": "Price ÷ earnings per share — dollars paid for $1 of yearly profit. Lower is cheaper.",
  "Fwd P/E": "P/E using next year's expected earnings instead of the last reported year.",
  "EV/EBITDA": "Enterprise value ÷ core operating profit. A debt-aware valuation multiple; lower is cheaper.",
  "P/S": "Price ÷ sales per share. Useful when a company has little or no profit yet.",
  "P/B": "Price ÷ book value (assets minus liabilities) per share.",
  "PEG": "P/E divided by growth rate — values a stock relative to how fast it's growing.",
  "FCF yield": "Free cash flow ÷ market value. The cash the business throws off, as a % of price.",
  "Discount to history": "How cheap a stock is versus its own typical valuation over the past 10 years.",
  // Quality / fundamentals
  "ROE": "Return on equity — profit as a % of shareholder money. Higher means more efficient.",
  "ROIC": "Return on invested capital — profit vs. all the money (debt + equity) put into the business.",
  "Gross margin": "Sales left after the direct cost of the product, as a % of sales.",
  "Operating margin": "Profit from core operations as a % of sales, before interest and tax.",
  "Beta": "How much the stock moves vs. the market. 1 = moves with it; >1 = more volatile.",
  "Market cap": "Total value of all shares = share price × shares outstanding.",
  // Options
  "IV": "Implied volatility — how much movement the options market is pricing in. Higher = pricier options.",
  "IV rank": "Where today's implied volatility sits vs. its own past year (0–100%). High = options are expensive now.",
  "Vol rank": "Where recent realized volatility sits vs. its own history (a percentile).",
  "Delta": "Roughly the chance an option finishes in-the-money; ~16Δ ≈ a 16% chance.",
  "DTE": "Days to expiration — how long until the option contract expires.",
  "Premium": "The cash the option seller collects (or the buyer pays) up front.",
  "RoR": "Return on risk — the income collected vs. the capital you'd lose if it goes wrong.",
  "POP": "Probability of profit — the modeled odds the trade makes money.",
  "Implied move": "The up-or-down swing options are pricing in around an event like earnings.",
  "Straddle": "Buying a call + put at the same strike — a bet on a big move either direction.",
  "Covered call": "Selling a call against stock you own to collect income, capping the upside.",
  "Cash-secured put": "Selling a put while holding the cash to buy the stock if assigned.",
  // Fund / ownership / market structure
  "NAV": "Net asset value — what a fund's holdings are actually worth per share.",
  "Discount to NAV": "A fund trading below the value of what it holds — you buy $1 of assets for less.",
  "13F": "Quarterly SEC filing where large investors disclose their U.S. stock holdings.",
  "13D": "SEC filing when an investor passes 5% of a company with activist intent (13G = the passive version).",
  "Lockup": "The ~180 days after an IPO when insiders can't sell. Expiry can flood the market with new supply.",
  "Hawkish / dovish": "Hawkish = leaning toward higher rates to fight inflation; dovish = leaning toward cuts to support growth.",
  "Short interest": "The % of shares sold short — a gauge of how many are betting the stock falls.",
  "Borrow fee": "The annual % cost to borrow a stock in order to short it. High = hard to short.",
  "Z-score": "How many standard deviations from normal — e.g. −2 is unusually cheap vs. its own history.",
  "Sharpe": "Return earned per unit of risk taken. Higher is a better risk-adjusted result.",
  "Max drawdown": "The worst peak-to-trough drop over the period — the deepest loss you'd have sat through.",
};
