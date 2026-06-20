import { notFound } from "next/navigation";
import { loadSnapshot, loadSymbolSeries } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { xyToPoints } from "@/lib/compute";
import { getCompanyStats } from "@/lib/companyStats";
import { getFinancials } from "@/lib/financials";
import { getCompanyProfile } from "@/lib/companyProfile";
import FinancialsView from "@/components/FinancialsView";
import SetupNotice from "@/components/SetupNotice";
import type { StockRow } from "@/lib/types";

// Unified ticker page (Overview + Financials/Estimates/Peers/Ownership/Filings/
// Options/Profile tabs). The chart + snapshot come from local files; the financials/
// stats/profile are live Yahoo, cached by the ISR window below.
export const revalidate = 1800;

export default async function StockPage({
  params,
}: {
  params: Promise<{ universe: string; symbol: string }>;
}) {
  const { universe, symbol } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const SYM = decodeURIComponent(symbol).toUpperCase();

  const snapshot = await loadSnapshot(universe);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;

  const row = snapshot.stocks.find((s) => s.symbol === SYM);
  if (!row) notFound();
  const meta = ETF_TO_SECTOR[row.etf] ?? null;

  // Peers from the snapshot: same sub-industry, falling back to the whole sector.
  const sub = snapshot.stocks.filter((s) => s.etf === row.etf && s.industry === row.industry);
  let peers: StockRow[];
  let peerGroup: string | null;
  if (sub.length >= 4) {
    peers = sub;
    peerGroup = row.industry;
  } else {
    peers = snapshot.stocks.filter((s) => s.etf === row.etf);
    peerGroup = meta?.name ?? row.sector;
  }
  peers = [...peers].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 30);

  const [xy, stats, financials, profile] = await Promise.all([
    loadSymbolSeries(SYM),
    getCompanyStats(SYM).catch(() => null),
    getFinancials(SYM).catch(() => ({ annual: [], quarterly: [] })),
    getCompanyProfile(SYM).catch(() => null),
  ]);

  return (
    <FinancialsView
      universe={universe}
      symbol={SYM}
      name={row.name}
      etf={row.etf}
      sectorName={meta?.name ?? row.sector}
      financials={financials}
      stats={stats}
      profile={profile}
      peers={peers}
      peerGroup={peerGroup}
      row={row}
      daily={xy ? xyToPoints(xy.daily) : []}
      intraday={xy ? xyToPoints(xy.intraday) : []}
      generatedAt={snapshot.generatedAt}
    />
  );
}
