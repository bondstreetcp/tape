import { notFound } from "next/navigation";
import { loadSnapshot, loadSymbolSeries } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { xyToPoints } from "@/lib/compute";
import { getCompanyStats } from "@/lib/companyStats";
import StockView from "@/components/StockView";
import SetupNotice from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

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

  const [xy, stats] = await Promise.all([
    loadSymbolSeries(SYM),
    getCompanyStats(SYM).catch(() => null),
  ]);
  const meta = ETF_TO_SECTOR[row.etf] ?? null;

  return (
    <StockView
      universe={universe}
      row={row}
      sectorName={meta?.name ?? row.sector}
      stats={stats}
      daily={xy ? xyToPoints(xy.daily) : []}
      intraday={xy ? xyToPoints(xy.intraday) : []}
      generatedAt={snapshot.generatedAt}
    />
  );
}
