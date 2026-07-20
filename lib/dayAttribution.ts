/**
 * "What drove my book today" for the Portfolio Cockpit — attribute the day's P&L to each holding using
 * its 1-day return (value · ret1d), so you see which names made or lost you money today. Pure + fs-free
 * → unit-tested (tests/dayAttribution.test.ts). A short that rises is a loss; the sign follows value·ret.
 */

export interface DayContribution { symbol: string; name?: string; pnl: number; retPct: number }
export interface DayAttribution {
  totalPnl: number; // Σ value · ret1d
  totalPct: number | null; // / base (AUM or gross)
  contributors: DayContribution[]; // sorted by |pnl| desc
  coverage: number; // share of gross with a 1-day return
}

export function dayAttribution(
  holdings: { symbol: string; value: number; ret1d?: number | null; name?: string }[],
  base: number,
): DayAttribution | null {
  const withRet = holdings.filter((h) => typeof h.ret1d === "number" && Number.isFinite(h.ret1d));
  if (!withRet.length) return null;
  const totalGross = holdings.reduce((a, h) => a + Math.abs(h.value), 0) || 1;
  const contributors: DayContribution[] = withRet
    .map((h) => ({ symbol: h.symbol, name: h.name, pnl: h.value * ((h.ret1d as number) / 100), retPct: h.ret1d as number }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const totalPnl = contributors.reduce((a, c) => a + c.pnl, 0);
  return {
    totalPnl,
    totalPct: base > 0 ? totalPnl / base : null,
    contributors,
    coverage: withRet.reduce((a, h) => a + Math.abs(h.value), 0) / totalGross,
  };
}
