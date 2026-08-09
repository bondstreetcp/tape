/**
 * Code-selected peers — curated cohort first, GICS industry fallback (2026-08, the VSTS incident:
 * the AI preview's "peer read-throughs" cited VISTRA and nuclear names for VESTIS because the
 * model was invited to pick peers "from your knowledge + the headlines", and a Yahoo search for a
 * ticker/name returns name-similar strangers. Peers are a CLASSIFICATION fact we already own —
 * VSTS/CTAS/UNF all carry GICS "Diversified Support Services" in the snapshot — so CODE picks
 * them and the model only narrates. Pipe fix, not a prompt patch: don't debug the model when the
 * pipe is wrong.)
 *
 * The curated PEER_COHORTS list still wins when present (it exists precisely for the cases where
 * GICS misses business-reality comps); the industry group covers the other ~3,000 names.
 */
import { loadSnapshot } from "@/lib/data";
import { peerCohort } from "@/lib/peerCohorts";

export interface PeerRef { symbol: string; name: string | null }
export interface PeerSet {
  label: string; // the cohort label or the GICS industry name
  self: PeerRef;
  peers: PeerRef[]; // largest-cap first for GICS groups; curated order for cohorts
}

interface RowLike { symbol: string; name?: string | null; sector?: string | null; industry?: string | null; marketCap?: number | null }

/** Pure core — same-industry (fallback same-sector) peers ranked by cap, self excluded. */
export function industryPeersFrom(stocks: RowLike[], sym: string, max = 6): PeerSet | null {
  const S = sym.toUpperCase();
  const self = stocks.find((r) => r.symbol === S);
  if (!self) return null;
  const key = self.industry?.trim() || null;
  const group = key
    ? stocks.filter((r) => r.industry?.trim() === key)
    : self.sector
      ? stocks.filter((r) => r.sector === self.sector)
      : [];
  const peers = group
    .filter((r) => r.symbol !== S)
    .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
    .slice(0, max)
    .map((r) => ({ symbol: r.symbol, name: r.name ?? null }));
  if (!peers.length) return null;
  return { label: key ?? self.sector ?? "sector", self: { symbol: S, name: self.name ?? null }, peers };
}

async function broadUs(): Promise<RowLike[] | null> {
  for (const u of ["russell3000", "broad1500", "russell1000", "sp1500", "sp500"]) {
    const s = await loadSnapshot(u).catch(() => null);
    if (s?.stocks?.length) return s.stocks;
  }
  return null;
}

/** Curated cohort when one exists, else the GICS-industry group from the broadest US snapshot. */
export async function resolvePeers(sym: string, max = 6): Promise<PeerSet | null> {
  const S = sym.toUpperCase();
  const stocks = await broadUs();
  const byTicker = new Map((stocks ?? []).map((r) => [r.symbol, r]));
  const cohort = peerCohort(S);
  if (cohort) {
    const peers = cohort.tickers
      .filter((t) => t !== S)
      .slice(0, max)
      .map((t) => ({ symbol: t, name: byTicker.get(t)?.name ?? null }));
    return { label: cohort.label, self: { symbol: S, name: byTicker.get(S)?.name ?? null }, peers };
  }
  return stocks ? industryPeersFrom(stocks, S, max) : null;
}
