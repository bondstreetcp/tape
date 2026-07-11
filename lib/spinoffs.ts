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
  // Turnover ≥ 100% — the register has genuinely turned. Our 2020-24 backtest (28 spins,
  // scripts/backtest-spinoff-turnover.ts): the classic "50%" fires at ~day 29 with a median −21%
  // still ahead (modern churn double-counts volume); at 100-150% the +6m forward return is +12%
  // median with a 71-74% hit rate.
  floatTurned: boolean;
  weekly: { d: string; pct: number }[]; // cumulative turnover milestones (~weekly) for the mini trend
}

// ── Upcoming pipeline — spins IN REGISTRATION, discovered from EDGAR Form 10 (10-12B) filings ─────
// A subsidiary registers its shares on a Form 10 (10-12B) to become an independent public company —
// the canonical, months-ahead signal that a spin is coming, upstream of the completed-turnover roster
// above and cleaner than the 8-K noise on /corp-events. scripts/refresh-spinoffs.ts discovers these
// and grounds the parent/business against the filing text.
export interface SpinPipelineRow {
  spinco: string; // the entity registering (the SpinCo-to-be)
  ticker: string | null; // spinco ticker if the registration already carries one
  parent: string | null; // the company doing the spin — grounded (must appear in the filing)
  parentTicker: string | null;
  business: string | null; // one line on what's being separated
  expectedTiming: string | null; // stated timing ("H1 2026", "third quarter of 2026"), else null
  ratio: string | null; // distribution ratio if stated ("1 SpinCo per 3 Parent")
  firstFiledDate: string; // initial 10-12B filing date (ISO)
  filedDate: string; // latest 10-12B or /A filing date (ISO)
  amendments: number; // number of /A amendments since the initial Form 10
  daysInReg: number; // days since the initial Form 10 (registration age)
  url: string;
  cik: string;
}

export interface SpinoffsData {
  generatedAt: string;
  rows: SpinoffRow[];
  pipeline?: SpinPipelineRow[]; // upcoming spins in registration (soonest-filed first)
}

export const turnoverColor = (pct: number | null): string =>
  pct == null ? "var(--text-4)" : pct >= 100 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "var(--text-2)";

/** Registration-age read: an amended Form 10 that's been in registration a while is typically CLOSE
 *  to effectiveness (spins usually distribute a few months after the initial filing). */
export function regStage(r: { amendments: number; daysInReg: number }): { label: string; color: string } {
  if (r.amendments >= 2 || r.daysInReg >= 120) return { label: "Late-stage", color: "#22c55e" };
  if (r.amendments >= 1 || r.daysInReg >= 45) return { label: "Progressing", color: "#f59e0b" };
  return { label: "Newly filed", color: "var(--text-2)" };
}
