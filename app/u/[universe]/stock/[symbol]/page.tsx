import { notFound } from "next/navigation";
import { loadSnapshot, loadSymbolSeries } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { peerCohort } from "@/lib/peerCohorts";
import { xyToPoints } from "@/lib/compute";
import { getCompanyStats } from "@/lib/companyStats";
import { getFinancials } from "@/lib/financials";
import { getCompanyProfile } from "@/lib/companyProfile";
import FinancialsView from "@/components/FinancialsView";
import SetupNotice from "@/components/SetupNotice";
import { fetchLiveStock } from "@/lib/liveStock";
import type { StockRow, StockSeries } from "@/lib/types";

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

  // Prefer the precomputed constituent row; otherwise fetch the ticker live from Yahoo so
  // off-index names (when-issued spinoffs like MBGL-WI, fresh IPOs, ADRs) still render.
  let row = snapshot.stocks.find((s) => s.symbol === SYM);
  let liveSeries: StockSeries | null = null;
  if (!row) {
    const live = await fetchLiveStock(SYM).catch(() => null);
    if (!live) notFound(); // Yahoo has nothing either → genuine 404
    row = live.row;
    liveSeries = live.series;
  }
  const meta = ETF_TO_SECTOR[row.etf] ?? null;

  // Peers: a curated business cohort when the name is in one (GICS sub-industry splits real
  // competitors — e.g. DECK/ONON in "Footwear" vs LULU in "Apparel"); else same sub-industry → sector.
  const cohort = peerCohort(row.symbol);
  let peers: StockRow[];
  let peerGroup: string | null;
  if (cohort) {
    // Draw from the broad Russell 3000 so cross-universe comps (e.g. ONON while viewing on the
    // S&P 500) still appear; fall back to the current snapshot if it isn't built.
    const broad = (await loadSnapshot("russell3000")) ?? snapshot;
    const set = new Set(cohort.tickers);
    peers = broad.stocks.filter((s) => set.has(s.symbol));
    if (peers.length < 3) peers = snapshot.stocks.filter((s) => set.has(s.symbol)); // safety
    peerGroup = cohort.label;
  } else {
    const sub = snapshot.stocks.filter((s) => s.etf === row.etf && s.industry === row.industry);
    if (sub.length >= 4) {
      peers = sub;
      peerGroup = row.industry;
    } else {
      peers = snapshot.stocks.filter((s) => s.etf === row.etf);
      peerGroup = meta?.name ?? row.sector;
    }
  }
  peers = [...peers].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 30);

  const [xy, stats, financials, profile] = await Promise.all([
    liveSeries ? Promise.resolve(liveSeries) : loadSymbolSeries(SYM),
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
