/**
 * Per-stock company cache — the fix for slow stock pages on the self-hosted NAS.
 *
 * A stock page renders on-demand (ISR) on whichever origin serves it, and used to make THREE live
 * fetches at request time: getCompanyStats (Yahoo), getFinancials (Yahoo fundamentals + SEC EDGAR,
 * ~4.2s from the NAS's home uplink) and getCompanyProfile (Yahoo). On Vercel that's fine; on the NAS
 * it's seconds of blocking network per first render. This bakes all three into one small per-symbol
 * file nightly on the FAST pipe (GitHub Actions) → R2, so the NAS reads local JSON instead of
 * fetching. Compute happens where fetching is cheap; the slow origin only reads.
 *
 * Cache-first with a LIVE FALLBACK: a cold name (or a fresh deploy before the nightly cache exists)
 * still live-fetches, so nothing ever shows empty — the cache just makes the common path local. As the
 * nightly build fills in, NAS misses → 0.
 */
import { promises as fs } from "fs";
import path from "path";
import { getCompanyStats, type CompanyStats } from "./companyStats";
import { getFinancials, type Financials } from "./financials";
import { getCompanyProfile, type CompanyProfile } from "./companyProfile";

export interface CompanyBundle {
  fetchedAt: string; // ISO — when the three fetches were baked (the page's honest "as of")
  stats: CompanyStats | null;
  financials: Financials;
  profile: CompanyProfile | null;
}

const EMPTY_FIN: Financials = { annual: [], quarterly: [] };

export const companyCacheDir = () => path.join(process.cwd(), "data", "company");
export const companyCacheFile = (symbol: string) => path.join(companyCacheDir(), symbol.toUpperCase() + ".json");

/** Read the baked per-symbol cache; null if it hasn't been built yet. */
export async function readCompanyCache(symbol: string): Promise<CompanyBundle | null> {
  try {
    return JSON.parse(await fs.readFile(companyCacheFile(symbol), "utf8")) as CompanyBundle;
  } catch {
    return null;
  }
}

/** Fetch all three LIVE — used by the nightly builder and as the on-miss fallback. Each source fails
 *  independently to null / empty so one dead vendor never nukes the whole bundle. */
export async function fetchCompanyBundle(symbol: string): Promise<CompanyBundle> {
  const [stats, financials, profile] = await Promise.all([
    getCompanyStats(symbol).catch(() => null),
    getFinancials(symbol).catch(() => EMPTY_FIN),
    getCompanyProfile(symbol).catch(() => null),
  ]);
  return { fetchedAt: new Date().toISOString(), stats, financials, profile };
}

const bundleHasData = (b: CompanyBundle) => !!(b.stats || b.profile || b.financials.annual.length || b.financials.quarterly.length);

/** The stock page's data source: prefer the baked cache (fast, LOCAL — the NAS never live-fetches on a
 *  hit), fall back to a live fetch for a cold name or a fresh deploy before the cache is built. */
export async function loadCompanyBundle(symbol: string): Promise<CompanyBundle> {
  const cached = await readCompanyCache(symbol);
  if (cached) return cached;
  const bundle = await fetchCompanyBundle(symbol);
  // Best-effort persist so an OFF-INDEX name (a spinoff/IPO/ADR not in any nightly-baked snapshot) is
  // live-fetched at most once per slot lifetime, not on every ISR revalidation. Silently no-ops on a
  // read-only fs (Vercel); on the NAS it writes into the live slot's data/company/.
  if (bundleHasData(bundle)) {
    try {
      await fs.mkdir(companyCacheDir(), { recursive: true });
      await fs.writeFile(companyCacheFile(symbol), JSON.stringify(bundle));
    } catch { /* read-only fs / race — the cache is an optimization, never required */ }
  }
  return bundle;
}

/** Cache-first single-field accessors for API routes that only need one slice. Same rule as the page:
 *  if the cache FILE exists, use it (even if that field baked to null — never re-fetch per request);
 *  only a fully-uncached name falls back to a live fetch. */
export async function cachedStats(symbol: string): Promise<CompanyStats | null> {
  const c = await readCompanyCache(symbol);
  return c ? c.stats : getCompanyStats(symbol).catch(() => null);
}
export async function cachedProfile(symbol: string): Promise<CompanyProfile | null> {
  const c = await readCompanyCache(symbol);
  return c ? c.profile : getCompanyProfile(symbol).catch(() => null);
}
