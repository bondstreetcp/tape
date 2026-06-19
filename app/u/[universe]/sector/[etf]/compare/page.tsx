import { notFound } from "next/navigation";
import { loadSnapshot, loadSymbolSeries, loadManySymbolSeries } from "@/lib/data";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { slugify } from "@/lib/slug";
import { xyToPoints } from "@/lib/compute";
import { buildIndustryIndex } from "@/lib/aggregate";
import IndustryCompareView from "@/components/IndustryCompareView";
import SetupNotice from "@/components/SetupNotice";
import type { StockRow, XY } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ universe: string; etf: string }>;
}) {
  const { universe, etf } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const ETF = etf.toUpperCase();
  const meta = ETF_TO_SECTOR[ETF];
  if (!meta) notFound();

  const snapshot = await loadSnapshot(universe);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;

  const sectorStocks = snapshot.stocks.filter((s) => s.etf === ETF);
  if (sectorStocks.length === 0) notFound();

  const [seriesMap, etfXY] = await Promise.all([
    loadManySymbolSeries(sectorStocks.map((s) => s.symbol)),
    loadSymbolSeries(ETF),
  ]);

  const byIndustry = new Map<string, StockRow[]>();
  for (const s of sectorStocks) {
    const arr = byIndustry.get(s.industry) ?? [];
    arr.push(s);
    byIndustry.set(s.industry, arr);
  }

  const toXY = (pts: { t: number; c: number }[]): XY[] =>
    pts.map((p) => [p.t, p.c]);

  const industries = [...byIndustry.entries()]
    .map(([industry, rows]) => {
      const inputs = rows
        .filter((r) => seriesMap[r.symbol])
        .map((r) => ({
          cap: r.marketCap || 0,
          daily: seriesMap[r.symbol].daily,
          intraday: seriesMap[r.symbol].intraday,
        }));
      const idx = buildIndustryIndex(inputs);
      return {
        industry,
        slug: slugify(industry),
        count: rows.length,
        cap: rows.reduce((a, b) => a + (b.marketCap || 0), 0),
        daily: toXY(idx.daily),
        intraday: toXY(idx.intraday),
      };
    })
    .filter((i) => i.daily.length > 1)
    .sort((a, b) => b.cap - a.cap);

  const etfSeries = etfXY
    ? { etf: ETF, intraday: xyToPoints(etfXY.intraday), daily: xyToPoints(etfXY.daily) }
    : null;

  return (
    <IndustryCompareView
      meta={meta}
      universe={universe}
      industries={industries}
      etfSeries={etfSeries}
      generatedAt={snapshot.generatedAt}
    />
  );
}
