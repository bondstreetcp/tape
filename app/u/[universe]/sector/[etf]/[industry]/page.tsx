import { notFound } from "next/navigation";
import {
  loadSnapshot,
  loadSymbolSeries,
  loadManySymbolSeries,
} from "@/lib/data";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { findIndustryBySlug } from "@/lib/slug";
import { xyToPoints } from "@/lib/compute";
import IndustryView from "@/components/IndustryView";
import SetupNotice from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

export default async function IndustryPage({
  params,
}: {
  params: Promise<{ universe: string; etf: string; industry: string }>;
}) {
  const { universe, etf, industry } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const ETF = etf.toUpperCase();
  const meta = ETF_TO_SECTOR[ETF];
  if (!meta) notFound();

  const snapshot = await loadSnapshot(universe);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;

  const sectorStocks = snapshot.stocks.filter((s) => s.etf === ETF);
  const industries = [...new Set(sectorStocks.map((s) => s.industry))];
  const industryName = findIndustryBySlug(industries, industry);
  if (!industryName) notFound();

  const stocks = sectorStocks
    .filter((s) => s.industry === industryName)
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

  const [etfXY, seriesBySymbol] = await Promise.all([
    loadSymbolSeries(ETF),
    loadManySymbolSeries(stocks.map((s) => s.symbol)),
  ]);
  const etfSeries = etfXY
    ? { etf: ETF, intraday: xyToPoints(etfXY.intraday), daily: xyToPoints(etfXY.daily) }
    : null;

  return (
    <IndustryView
      meta={meta}
      industry={industryName}
      stocks={stocks}
      seriesBySymbol={seriesBySymbol}
      etfSeries={etfSeries}
      generatedAt={snapshot.generatedAt}
      universe={universe}
    />
  );
}
