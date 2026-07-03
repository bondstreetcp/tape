/**
 * Catalyst-Vol — names with a KNOWN upcoming catalyst (an investor/analyst/capital-markets day) where
 * the options market ISN'T pricing a move: the ATM straddle over the event window vs the stock's own
 * realized-vol baseline. A low implied/baseline ratio = cheap optionality into the event. Built by
 * scripts/refresh-catalyst-vol.ts. Not advice.
 */

export interface CatalystRow {
  ticker: string;
  company: string;
  eventType: string; // "Investor Day" | "Analyst Day" | "Capital Markets Day"
  eventDate: string; // ISO date of the event
  daysToEvent: number;
  // Pricing fields are null when the options couldn't be priced THIS run (no chain, thin quotes,
  // transient Yahoo failure). Unpriced rows stay in the file so the future event isn't forgotten —
  // prior rows are the calendar's only memory once the 8-K ages out of the EDGAR scan window.
  // The view shows priced rows only; unpriced ones re-price on a later run.
  price: number | null;
  expiry: string | null; // the option expiry bracketing the event
  dte: number | null; // days to that expiry
  impliedMovePct: number | null; // ATM straddle ÷ spot, over the expiry
  baselineMovePct: number | null; // the stock's realized-vol expected move over the same window
  ratio: number | null; // implied ÷ baseline — <1 = options pricing LESS than normal vol (no catalyst premium)
  hvAnnual: number | null; // annualized realized vol
  url: string;
}

export interface CatalystVolData {
  generatedAt: string;
  scanned: number;
  rows: CatalystRow[];
}

// teal = cheap (options underpricing the catalyst), amber = rich (event already priced)
export function ratioColor(r: number): string {
  if (r <= 0.9) return "#14b8a6";
  if (r <= 1.1) return "#2dd4bf";
  if (r >= 1.6) return "#f59e0b";
  if (r >= 1.35) return "#fbbf24";
  return "var(--text-2)";
}
export const ratioVerdict = (r: number): string => (r <= 1.1 ? "cheap" : r >= 1.35 ? "priced-in" : "fair");
