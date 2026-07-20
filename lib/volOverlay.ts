/**
 * Volatility / options overlay for the Portfolio Cockpit — reads how volatile your names are RIGHT NOW
 * vs their own history (realized-vol cone) and which report earnings soon (IV set). Exposure-weighted so
 * it describes the book, not a single name. Pure + fs-free → unit-tested (tests/volOverlay.test.ts).
 */

export interface VolInfo {
  rv?: number; // current 20d realized vol (annualized fraction, e.g. 0.34)
  rvPct?: number; // percentile of current RV in the name's own history (0..100)
  daysToEarnings?: number | null;
  expMovePct?: number | null; // options-implied earnings move (%)
}

export interface VolOverlay {
  avgRv: number | null; // exposure-weighted current realized vol
  avgRvPct: number | null; // exposure-weighted RV percentile (0..100)
  coverage: number; // share of gross with cone data
  elevated: { symbol: string; rvPct: number; rv: number }[]; // names running hot vs their own history
  earnings: { symbol: string; days: number; expMovePct: number | null }[]; // earnings within ~2 weeks
  earningsGrossPct: number; // share of gross reporting within ~2 weeks
}

export function volOverlay(
  holdings: { symbol: string; value: number }[],
  vol: Record<string, VolInfo>,
): VolOverlay | null {
  const totalGross = holdings.reduce((a, h) => a + Math.abs(h.value), 0) || 1;
  const withRv = holdings.filter((h) => typeof vol[h.symbol.toUpperCase()]?.rv === "number");
  if (!withRv.length) return null;

  const wavg = (pick: (v: VolInfo) => number | undefined) => {
    let w = 0, acc = 0;
    for (const h of holdings) {
      const x = pick(vol[h.symbol.toUpperCase()] ?? {});
      if (typeof x === "number" && Number.isFinite(x)) { const g = Math.abs(h.value); acc += g * x; w += g; }
    }
    return w > 0 ? acc / w : null;
  };

  const elevated = withRv
    .map((h) => ({ symbol: h.symbol, rvPct: vol[h.symbol.toUpperCase()].rvPct ?? 0, rv: vol[h.symbol.toUpperCase()].rv ?? 0 }))
    .filter((x) => x.rvPct >= 80)
    .sort((a, b) => b.rvPct - a.rvPct)
    .slice(0, 5);

  const earnHold = holdings.filter((h) => { const d = vol[h.symbol.toUpperCase()]?.daysToEarnings; return typeof d === "number" && d >= 0 && d <= 14; });
  const earnings = earnHold
    .map((h) => ({ symbol: h.symbol, days: vol[h.symbol.toUpperCase()].daysToEarnings as number, expMovePct: vol[h.symbol.toUpperCase()].expMovePct ?? null }))
    .sort((a, b) => a.days - b.days);

  return {
    avgRv: wavg((v) => v.rv),
    avgRvPct: wavg((v) => v.rvPct),
    coverage: withRv.reduce((a, h) => a + Math.abs(h.value), 0) / totalGross,
    elevated,
    earnings,
    earningsGrossPct: earnHold.reduce((a, h) => a + Math.abs(h.value), 0) / totalGross,
  };
}
