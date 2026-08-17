/**
 * Liquid, US-listed, OPTIONABLE reporters that fall OUTSIDE the tracked equity indices — so the
 * earnings scans (which are grounded in Russell/S&P snapshots) never see them (2026-08-16 call:
 * Alibaba, Amer Sports, Viking et al. missing from the calendar). Two buckets that indices miss:
 *   - foreign-incorporated ADRs with a deep US options market (the big China names especially), and
 *   - recent US IPOs not yet added to an index.
 *
 * Hand-maintained on purpose — an "everything on the exchange calendar" admit would flood the scan
 * with illiquid microcaps that carry no real straddle. These are names with a genuine options market
 * a small account could actually trade the print in. Add liberally as new liquid names list; the
 * scan self-corrects if a name has no options (it just yields no implied move and drops out).
 */
export const EARNINGS_EXTRA_NAMES: string[] = [
  // China / HK ADRs — deep US options
  "BABA", "JD", "PDD", "BIDU", "NIO", "LI", "XPEV", "BEKE", "TME", "VIPS", "TCOM", "YMM", "ZTO", "FUTU", "TAL", "EDU", "ATHM", "IQ", "BILI",
  // Other liquid non-index ADRs
  "SE", "GRAB", "MELI", "NU", "STNE", "GLOB", "SHOP", "SPOT",
  // Recent US IPOs / non-index US names with listed options
  "AS", "VIK", "LINE", "RDDT", "ALAB", "RBRK", "ARM", "SMR", "CRDO",
];
