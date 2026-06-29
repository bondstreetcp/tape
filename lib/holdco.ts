/**
 * Holdco Arb / look-through-NAV tracker. For a curated set of holding companies, compute look-through
 * NAV = Σ(listed-stake values) + static other-NAV − net debt, vs the holdco's own market price →
 * discount/premium to NAV, with a z-score vs its own recent history (the CEF Discount-Hunter idea
 * applied to holdcos). Built offline by scripts/refresh-holdco-nav.ts → data/holdco-nav.json.
 *
 * The HOLDCOS roster below is the only hand-maintained input. Each stake is a % of a listed company
 * (value = pctOwned × the stake's live market cap) OR an absolute share count (millions). otherNavM +
 * netDebtM + sharesOutM + asOf come from each holdco's published NAV statement and are SEED ESTIMATES
 * — verify against the company's own NAV sheet before trading. Stake prices + FX are fetched live.
 */
// No fs import — this module is imported by the client view (types + discountColor + the roster).
// The page reads data/holdco-nav.json itself.

export interface Stake {
  ticker: string; // Yahoo symbol of the listed stake (e.g. 0700.HK, RACE, ATCO-A.ST)
  name: string;
  pctOwned?: number; // fraction of the listed co owned (value = pctOwned × its market cap); preferred
  sharesM?: number; // OR absolute shares held, millions (value = sharesM × price)
}
export interface Holdco {
  slug: string;
  name: string;
  ticker: string; // the holdco's own listing (e.g. PRX.AS)
  currency: string; // reporting currency (EUR/SEK/JPY/GBP/USD)
  sharesOutM: number; // holdco shares outstanding, millions
  netDebtM: number; // net debt in reporting-currency millions (negative = net cash)
  otherNavM: number; // static value of NON-listed assets (private holdings, ops) in reporting-currency millions
  asOf: string; // as-of of the net-debt / shares / other-NAV inputs
  stakes: Stake[];
  note?: string;
}

// ── Curated roster (SEED ESTIMATES — verify each holdco's stakes/net-debt against its NAV sheet) ──
export const HOLDCOS: Holdco[] = [
  {
    slug: "prosus", name: "Prosus", ticker: "PRX.AS", currency: "EUR", sharesOutM: 2420, netDebtM: -9000, otherNavM: 26000, asOf: "2026-03",
    note: "NAV dominated by its ~24% Tencent stake; the rest is other listed e-commerce + a large net-cash pile + private ops (the otherNAV line).",
    stakes: [{ ticker: "0700.HK", name: "Tencent", pctOwned: 0.24 }, { ticker: "DHER.DE", name: "Delivery Hero", pctOwned: 0.25 }],
  },
  {
    slug: "exor", name: "Exor", ticker: "EXO.AS", currency: "EUR", sharesOutM: 220, netDebtM: -3000, otherNavM: 6500, asOf: "2026-03",
    note: "Agnelli family holdco. Listed: Ferrari, Stellantis, CNH, Philips, Iveco. otherNAV = private (Christian Louboutin, reinsurance, Juventus, GEDI) + cash.",
    stakes: [
      { ticker: "RACE", name: "Ferrari", pctOwned: 0.235 },
      { ticker: "STLA", name: "Stellantis", pctOwned: 0.145 },
      { ticker: "CNH", name: "CNH Industrial", pctOwned: 0.267 },
      { ticker: "PHIA.AS", name: "Philips", pctOwned: 0.15 },
      { ticker: "IVG.MI", name: "Iveco", pctOwned: 0.27 },
    ],
  },
  {
    slug: "gbl", name: "Groupe Bruxelles Lambert", ticker: "GBLB.BR", currency: "EUR", sharesOutM: 148, netDebtM: 0, otherNavM: 9000, asOf: "2026-03",
    note: "Frère/Desmarais holdco. Listed: adidas, Pernod Ricard, SGS. otherNAV = private (Webhelp/Concentrix, Sanoptis, Affidea) + Sienna PE.",
    stakes: [
      { ticker: "ADS.DE", name: "adidas", pctOwned: 0.07 },
      { ticker: "RI.PA", name: "Pernod Ricard", pctOwned: 0.094 },
      { ticker: "SGSN.SW", name: "SGS", pctOwned: 0.19 },
    ],
  },
];

// ── Computed output (written to data/holdco-nav.json by the refresh script) ──
export interface StakeVal { ticker: string; name: string; valueM: number | null; pctOfNav: number | null }
export interface HoldcoNav {
  slug: string;
  name: string;
  ticker: string;
  currency: string;
  asOf: string;
  price: number | null; // holdco price (reporting currency)
  navPerShare: number | null;
  grossAssetM: number | null; // listed stakes + otherNAV
  listedM: number | null; // listed stakes only (for coverage)
  otherNavM: number;
  netDebtM: number;
  navM: number | null;
  discount: number | null; // price/NAVps − 1, in % (negative = trades below NAV)
  z1y: number | null;
  stretched: boolean; // z1y ≤ −1 — unusually wide vs its own recent history
  coveragePct: number | null; // listed value ÷ gross asset (how much of NAV is mark-to-market)
  stakes: StakeVal[];
  history: [string, number][]; // [date, discount%]
  note?: string;
  error?: string;
}
export interface HoldcoNavData { generatedAt: string; asOf: string | null; holdcos: HoldcoNav[] }

/** Discount color: deep discount = green (cheap), premium = red. */
export const discountColor = (d: number | null) => (d == null ? "var(--text-3)" : d <= -25 ? "#22c55e" : d <= -10 ? "#4ade80" : d < 0 ? "#a3e635" : "#ef4444");
