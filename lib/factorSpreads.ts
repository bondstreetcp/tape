/**
 * Long-short factor-mimicking spreads from the ETF menu (much less collinear than the raw ETFs): Market =
 * ^GSPC, Size = IWM−SPY (small−large), Value = IWD−IWF (value−growth), and Momentum/Quality/Low-Vol as each
 * factor ETF's excess over the market. Returns null if the market vector is missing.
 *
 * Shared by the factor decomposition / return attribution in portfolioRisk AND the factor-targeted hedge in
 * hedgeOptimizer, so both neutralize/attribute against the SAME factor definitions. Kept dependency-free to
 * avoid an import cycle between those two modules.
 */
export function factorSpreads(extra: Record<string, number[]> | undefined, market: number[]): Record<string, number[]> | null {
  const e = extra ?? {};
  const n = market.length;
  const ok = (a: string) => e[a]?.length === n;
  const spread = (a: string, b: string) => (ok(a) && ok(b) ? e[a].map((x, i) => x - e[b][i]) : null);
  const exMkt = (a: string) => (ok(a) ? e[a].map((x, i) => x - market[i]) : null);
  const f: Record<string, number[]> = { Market: market };
  const add = (name: string, v: number[] | null) => { if (v) f[name] = v; };
  add("Size", spread("IWM", "SPY"));
  add("Value", spread("IWD", "IWF"));
  add("Momentum", exMkt("MTUM"));
  add("Quality", exMkt("QUAL"));
  add("LowVol", exMkt("USMV"));
  return Object.keys(f).length ? f : null;
}
