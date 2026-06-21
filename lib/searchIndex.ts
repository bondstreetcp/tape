import { loadSnapshot } from "./data";
import { UNIVERSES } from "./universes";

export interface SearchEntry { symbol: string; name: string; universe: string }

let cache: SearchEntry[] | null = null;

// Every company across every universe, deduped by symbol — the source for the global
// search box. A company in multiple universes is attributed to the first (most
// canonical) one in UNIVERSES order (sp500 → … → russell3000 → international), so e.g.
// AAPL links to sp500 and ATZ.TO (TSX-only) to tsx. Cached for the life of the server
// instance since the snapshots are static per deploy.
export async function getGlobalSearchIndex(): Promise<SearchEntry[]> {
  if (cache) return cache;
  const seen = new Map<string, SearchEntry>();
  for (const u of UNIVERSES) {
    const snap = await loadSnapshot(u.id);
    for (const s of snap?.stocks ?? []) {
      if (!seen.has(s.symbol)) seen.set(s.symbol, { symbol: s.symbol, name: s.name, universe: u.id });
    }
  }
  cache = [...seen.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return cache;
}
