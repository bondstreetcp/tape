/**
 * Biotech Event Vol — every dated clinical binary (an FDA PDUFA decision or a Phase 2/3 readout) priced
 * against the options chain: the ATM straddle over the expiry bracketing the event vs the stock's own
 * realized-vol baseline. Unlike an investor day (where cheap = implied < baseline), a real biotech binary
 * is EXPECTED to price a big move — so the read here is the EVENT PREMIUM (implied ÷ baseline) ranked
 * within the biotech cohort: "options light" = the market isn't loading the binary (cheap optionality if
 * you believe it's make-or-break); "fully loaded" = the event is richly priced. Built by
 * scripts/refresh-biotech-vol.ts (pure re-pricing over data/biotech-catalysts.json). Not advice.
 */

export interface BioVolRow {
  ticker: string;
  company: string;
  drug: string;
  condition: string;
  phase: string; // "Phase 3" | application type for PDUFA ("NDA"/"BLA")
  eventKind: "pdufa" | "readout";
  eventLabel: string; // "FDA decision (PDUFA)" | "Phase 3 readout"
  eventDate: string; // ISO — PDUFA action date or est. primary-completion (readout)
  daysToEvent: number;
  // Null when the options couldn't be priced this run (no chain, no expiry reaching the event, thin
  // quotes). Unpriced rows are dropped from the view but the event still shows on the biotech radar.
  price: number | null;
  expiry: string | null; // the option expiry bracketing the event
  dte: number | null;
  impliedMovePct: number | null; // ATM straddle ÷ spot over that expiry — the move the options price
  baselineMovePct: number | null; // the stock's realized-vol expected move over the same window
  ratio: number | null; // event premium = implied ÷ baseline (how many multiples of ordinary vol)
  premiumPctile: number | null; // percentile of `ratio` within the priced cohort (self-calibrating)
  url: string;
}

export interface BiotechVolData {
  generatedAt: string;
  scanned: number;
  rows: BioVolRow[];
}

export type VolTag = "light" | "fair" | "loaded" | null;

// Cohort-relative tag from the event-premium percentile — no arbitrary absolute vol threshold, so it
// self-calibrates to the current biotech vol regime.
export function volTag(pctile: number | null): VolTag {
  if (pctile == null) return null;
  return pctile <= 33 ? "light" : pctile >= 67 ? "loaded" : "fair";
}
export const volTagColor = (t: VolTag): string => (t === "light" ? "#14b8a6" : t === "loaded" ? "#f59e0b" : "var(--text-3)");
export const volTagLabel = (t: VolTag): string => (t === "light" ? "options light" : t === "loaded" ? "fully loaded" : "fair");
