import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { getFinancials } from "@/lib/financials";
import { getCompanyStats } from "@/lib/companyStats";
import { getCompanyProfile } from "@/lib/companyProfile";
import FinancialsView from "@/components/FinancialsView";
import type { StockRow } from "@/lib/types";

// Financials change quarterly — fetch live from Yahoo and cache each company for 24h.
export const revalidate = 86400;

export default async function FinancialsPage({
  params,
}: {
  params: Promise<{ universe: string; symbol: string }>;
}) {
  const { universe, symbol } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const SYM = decodeURIComponent(symbol).toUpperCase();

  const snapshot = await loadSnapshot(universe);
  const row = snapshot?.stocks.find((s) => s.symbol === SYM) ?? null;
  const meta = row ? ETF_TO_SECTOR[row.etf] : null;

  // Peers from the snapshot (no extra fetching): same sub-industry, falling back
  // to the whole sector when the sub-industry is too small.
  let peers: StockRow[] = [];
  let peerGroup: string | null = null;
  if (row && snapshot) {
    const sub = snapshot.stocks.filter(
      (s) => s.etf === row.etf && s.industry === row.industry,
    );
    if (sub.length >= 4) {
      peers = sub;
      peerGroup = row.industry;
    } else {
      peers = snapshot.stocks.filter((s) => s.etf === row.etf);
      peerGroup = meta?.name ?? row.sector;
    }
    peers = [...peers]
      .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
      .slice(0, 30);
  }

  const [financials, stats, profile] = await Promise.all([
    getFinancials(SYM),
    getCompanyStats(SYM),
    getCompanyProfile(SYM),
  ]);

  return (
    <FinancialsView
      universe={universe}
      symbol={SYM}
      name={row?.name ?? SYM}
      etf={row?.etf ?? null}
      sectorName={meta?.name ?? row?.sector ?? null}
      financials={financials}
      stats={stats}
      profile={profile}
      peers={peers}
      peerGroup={peerGroup}
    />
  );
}
