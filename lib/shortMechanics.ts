/**
 * Short-mechanics — types + pure parse/aggregate for /short-mechanics.
 *
 * The pieces of the "shorts" picture Tape did NOT have: not the borrow fee (we have that) or the
 * squeeze composite (have that), but the two official free mechanics files —
 *   • FINRA daily short-sale VOLUME (what fraction of each day's reported volume was short), and
 *   • SEC FAILS-TO-DELIVER (shares that didn't settle — a delivery-pressure / hard-to-borrow tell).
 * Both are free, official, and universe-wide (no roster). This module is the pure parsing + rollup;
 * the nightly fetch lives in scripts/refresh-short-mechanics.ts.
 *
 * HONEST FRAMING (carried into the UI): FINRA short VOLUME is daily executions reported to FINRA
 * expressed as a % of reported volume — a short-side ACTIVITY proxy, NOT the twice-monthly short
 * INTEREST (% of float) that /squeeze already uses. High short-volume % = heavy shorting THAT DAY;
 * it is not the same as a large short position.
 */

export interface FinraShortRow { symbol: string; shortVol: number; totalVol: number }
export interface FtdRow { symbol: string; fails: number; priceUsd: number }

export interface ShortMechRow {
  symbol: string;
  name: string;
  /** mean short-volume % over the window (shortVol ÷ totalVol, volume-weighted across days) */
  shortVolPct: number | null;
  /** most recent single-day short-volume % */
  latestShortVolPct: number | null;
  /** latest − window-mean, in percentage points (positive = shorting picking up) */
  shortVolTrendPp: number | null;
  daysObserved: number;
  /** latest semi-monthly FTD: shares that failed to deliver, and their $ value (qty × price) */
  ftdShares: number | null;
  ftdUsd: number | null;
  /** FTD $ change vs the prior semi-monthly file (fraction), null without both */
  ftdChangePct: number | null;
}

export interface ShortMechFile {
  generatedAt: string;
  shortVolAsOf: string | null; // latest FINRA date in the window
  ftdAsOf: string | null; // settlement month of the latest FTD file
  windowDays: number;
  rows: ShortMechRow[];
}

/** One FINRA CNMSshvol line: `Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market`. */
export function parseFinraLine(line: string): FinraShortRow | null {
  const p = line.split("|");
  if (p.length < 5 || p[0] === "Date" || !/^[A-Z]/.test(p[1] || "")) return null;
  const shortVol = +p[2] + (+p[3] || 0); // short + short-exempt = all short executions
  const totalVol = +p[4];
  if (!Number.isFinite(shortVol) || !Number.isFinite(totalVol) || totalVol <= 0) return null;
  return { symbol: p[1], shortVol, totalVol };
}

/** One SEC FTD line: `SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE`. */
export function parseFtdLine(line: string): FtdRow | null {
  const p = line.split("|");
  if (p.length < 6 || !/^\d{8}$/.test(p[0]) || !/^[A-Z]/.test(p[2] || "")) return null;
  const fails = +p[3];
  const priceUsd = +p[5];
  if (!Number.isFinite(fails) || fails <= 0) return null;
  return { symbol: p[2], fails, priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0 };
}

/** Volume-weighted short-volume % over a set of daily rows for ONE symbol, plus latest + trend. */
export function rollShortVol(daily: FinraShortRow[], latest: FinraShortRow | null): {
  shortVolPct: number | null; latestShortVolPct: number | null; shortVolTrendPp: number | null; daysObserved: number;
} {
  if (!daily.length) return { shortVolPct: null, latestShortVolPct: null, shortVolTrendPp: null, daysObserved: 0 };
  const sVol = daily.reduce((a, r) => a + r.shortVol, 0);
  const tVol = daily.reduce((a, r) => a + r.totalVol, 0);
  // Clamp to 100: FINRA's per-facility TotalVolume can be below ShortVolume+exempt on thin names
  // (a reporting artifact), producing a nonsensical >100% — cap rather than show it.
  const clamp = (x: number) => Math.min(100, x);
  const mean = tVol > 0 ? clamp((sVol / tVol) * 100) : null;
  const latestPct = latest && latest.totalVol > 0 ? clamp((latest.shortVol / latest.totalVol) * 100) : null;
  return {
    shortVolPct: mean == null ? null : +mean.toFixed(1),
    latestShortVolPct: latestPct == null ? null : +latestPct.toFixed(1),
    shortVolTrendPp: mean != null && latestPct != null ? +(latestPct - mean).toFixed(1) : null,
    daysObserved: daily.length,
  };
}
