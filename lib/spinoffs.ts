/**
 * Spinoff turnover tracker — the special-situations "seller exhaustion" read. After a spinoff,
 * index funds and parent holders receive shares they never chose to own and dump them; once
 * CUMULATIVE VOLUME since the spin (incl. any when-issued trading) reaches ~50% of shares
 * outstanding, that forced selling is typically spent and the stock has historically bottomed.
 * Roster is curated below (completed spins only — announcements live on /corp-events);
 * scripts/refresh-spinoffs.ts computes turnover nightly. CLIENT-SAFE: types + roster only.
 */

export interface SpinoffSeed {
  ticker: string; // the spinco (regular-way)
  name: string;
  parent: string;
  parentTicker: string;
  spinDate: string; // first regular-way trading day (ISO)
  wiTicker?: string; // when-issued symbol if Yahoo carries one
  ratio?: number; // spinco shares per parent share (from the distribution terms) — lets the tracker
  // derive shares outstanding from the PARENT's count while Yahoo has nothing for a days-old ticker
}

// Curated: US spinoffs completed in the last ~18 months. Add new ones at the TOP as they distribute
// (the Corp Events board's spin-off announcements are the upstream pipeline). Seeded 2026-07-02 from
// KEDM Vol.280's "Completed Domestic Spin-offs" table cross-checked against completion press releases.
export const SPINOFF_ROSTER: SpinoffSeed[] = [
  { ticker: "MBGL", name: "Mobility Global", parent: "S&P Global", parentTicker: "SPGI", spinDate: "2026-07-01", ratio: 1 }, // 1 MBGL per SPGI
  { ticker: "HONA", name: "Honeywell Aerospace", parent: "Honeywell", parentTicker: "HON", spinDate: "2026-06-29" },
  { ticker: "FDXF", name: "FedEx Freight", parent: "FedEx", parentTicker: "FDX", spinDate: "2026-05-29" },
  { ticker: "OCTV", name: "Octave Intelligence", parent: "Hexagon AB", parentTicker: "HXGBF", spinDate: "2026-05-28" },
  { ticker: "TRAX", name: "First Tracks Biotherapeutics", parent: "AnaptysBio", parentTicker: "ANAB", spinDate: "2026-04-06" },
  { ticker: "VGNT", name: "Versigent", parent: "Aptiv", parentTicker: "APTV", spinDate: "2026-04-01" },
  { ticker: "JAN", name: "Janus Living", parent: "Healthpeak Properties", parentTicker: "DOC", spinDate: "2026-03-20" },
  { ticker: "RNA", name: "Atrium Therapeutics", parent: "Novartis", parentTicker: "NVS", spinDate: "2026-02-26" },
  { ticker: "VSNT", name: "Versant Media Group", parent: "Comcast", parentTicker: "CMCSA", spinDate: "2026-01-05" },
  { ticker: "LLYVA", name: "Liberty Live Holdings", parent: "Liberty Media", parentTicker: "FWONA", spinDate: "2025-12-16" },
  { ticker: "MICC", name: "Magnum Ice Cream Company", parent: "Unilever", parentTicker: "UL", spinDate: "2025-12-08" },
  { ticker: "Q", name: "Qnity Electronics", parent: "DuPont", parentTicker: "DD", spinDate: "2025-11-03" },
  { ticker: "SOLS", name: "Solstice Advanced Materials", parent: "Honeywell", parentTicker: "HON", spinDate: "2025-10-30" },
  { ticker: "GLIBA", name: "GCI Liberty", parent: "Liberty Broadband", parentTicker: "LBRDA", spinDate: "2025-07-15" },
  { ticker: "RAL", name: "Ralliant", parent: "Fortive", parentTicker: "FTV", spinDate: "2025-06-30" },
  { ticker: "AMRZ", name: "Amrize", parent: "Holcim", parentTicker: "HCMLY", spinDate: "2025-06-23" },
  { ticker: "STRZ", name: "Starz Entertainment", parent: "Lionsgate", parentTicker: "LION", spinDate: "2025-05-07" },
  { ticker: "ANGI", name: "Angi", parent: "IAC", parentTicker: "IAC", spinDate: "2025-03-31" },
  { ticker: "SNDK", name: "Sandisk", parent: "Western Digital", parentTicker: "WDC", spinDate: "2025-02-24" },
  { ticker: "MRP", name: "Millrose Properties", parent: "Lennar", parentTicker: "LEN", spinDate: "2025-02-07" },
];

export interface SpinoffRow extends SpinoffSeed {
  daysSince: number;
  price: number | null;
  sincePct: number | null; // vs first regular-way close
  sharesOut: number | null;
  cumVol: number; // regular-way cumulative volume since the spin
  wiVol: number; // when-issued volume captured (0 if none found)
  turnoverPct: number | null; // (cumVol + wiVol) / sharesOut × 100
  floatTurned: boolean; // turnover ≥ 50% — the historical bottom zone
  weekly: { d: string; pct: number }[]; // cumulative turnover milestones (~weekly) for the mini trend
}

export interface SpinoffsData {
  generatedAt: string;
  rows: SpinoffRow[];
}

export const turnoverColor = (pct: number | null): string =>
  pct == null ? "var(--text-4)" : pct >= 50 ? "#22c55e" : pct >= 30 ? "#f59e0b" : "var(--text-2)";
