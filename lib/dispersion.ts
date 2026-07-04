/**
 * Dispersion — index implied vol vs the cap-weighted average of single-name implied vols. When single
 * names are pricing much more vol than the index (a big positive spread / low IMPLIED CORRELATION), the
 * market is pricing lots of idiosyncratic movement — the classic dispersion trade sells index vol and buys
 * the components (betting correlation rises); when the index is priced near its components (high implied
 * correlation), it's the reverse. Pure + client-safe.
 *
 * Approximation: index IV = VIX (SPX 30-day); single-name IV = the ~1-month ATM IV solved nightly for the
 * large/mid-cap universe (vol-dislocation). That set isn't the exact S&P 500 with exact index weights, so
 * the cap-weighted average and the implied correlation are a REGIME read, not an index-desk-exact number.
 *
 * Implied correlation from σ_index² ≈ ρ · (Σ wᵢσᵢ)²  ⇒  ρ ≈ (σ_index / Σ wᵢσᵢ)², clamped to [0,1].
 */
export interface DispSectorRow {
  sector: string;
  wIV: number; // cap-weighted single-name IV within the sector (decimal)
  n: number;
  capPct: number; // share of the universe's market cap
}
export interface DispName {
  symbol: string;
  name: string;
  sector: string;
  atmIV: number;
  marketCap: number;
}
export interface Dispersion {
  indexIV: number; // VIX/100
  singleNameIV: number; // cap-weighted avg (decimal)
  spread: number; // singleNameIV − indexIV (how much richer single-name vol is)
  impliedCorr: number | null; // (indexIV / singleNameIV)², clamped [0,1]
  n: number;
  sectors: DispSectorRow[]; // by cap-weighted IV, richest first
  topNames: DispName[]; // highest single-name IV (the vol drivers), most liquid mega/large caps
}

export interface DispersionData extends Dispersion {
  generatedAt: string;
  vix: number;
  coverage: number; // how many index heavyweights we solved an IV for
}

interface Row {
  symbol: string;
  name: string;
  sector: string;
  atmIV: number;
  marketCap: number;
  illiquid?: boolean;
}

export function computeDispersion(rows: Row[], vix: number): Dispersion | null {
  const use = rows.filter((r) => r.atmIV > 0.03 && r.atmIV < 3 && r.marketCap > 0 && !r.illiquid);
  if (use.length < 20 || !(vix > 0)) return null;
  const totalCap = use.reduce((s, r) => s + r.marketCap, 0);
  const singleNameIV = use.reduce((s, r) => s + r.atmIV * r.marketCap, 0) / totalCap;
  const indexIV = vix / 100;
  const spread = singleNameIV - indexIV;
  const impliedCorr = singleNameIV > 0 ? Math.max(0, Math.min(1, (indexIV / singleNameIV) ** 2)) : null;

  const bySector = new Map<string, { capW: number; cap: number; n: number }>();
  for (const r of use) {
    const s = r.sector || "—";
    const e = bySector.get(s) || { capW: 0, cap: 0, n: 0 };
    e.capW += r.atmIV * r.marketCap;
    e.cap += r.marketCap;
    e.n += 1;
    bySector.set(s, e);
  }
  const sectors: DispSectorRow[] = [...bySector.entries()]
    .map(([sector, e]) => ({ sector, wIV: e.cap > 0 ? e.capW / e.cap : 0, n: e.n, capPct: e.cap / totalCap }))
    .sort((a, b) => b.wIV - a.wIV);

  const topNames: DispName[] = [...use]
    .sort((a, b) => b.atmIV - a.atmIV)
    .slice(0, 12)
    .map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector, atmIV: r.atmIV, marketCap: r.marketCap }));

  return { indexIV, singleNameIV, spread, impliedCorr, n: use.length, sectors, topNames };
}

// A plain-English regime read on the implied correlation.
export function corrRead(rho: number | null): { t: string; c: string } {
  if (rho == null) return { t: "—", c: "var(--text-3)" };
  if (rho <= 0.25) return { t: "low correlation — dispersion richly priced (sell index vol / buy singles)", c: "#22c55e" };
  if (rho >= 0.5) return { t: "high correlation — index-like, dispersion looks cheap to own", c: "#f59e0b" };
  return { t: "moderate correlation", c: "var(--text-2)" };
}
