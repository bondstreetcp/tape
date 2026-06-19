import Link from "next/link";
import { notFound } from "next/navigation";
import { loadSnapshot, loadSymbolSeries } from "@/lib/data";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { xyToPoints } from "@/lib/compute";
import SectorView from "@/components/SectorView";
import SetupNotice from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

export default async function SectorPage({
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

  const stocks = snapshot.stocks
    .filter((s) => s.etf === ETF)
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

  if (stocks.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16 text-center">
        <Link href={`/u/${universe}`} className="text-sm text-[#8b93a7] hover:text-[#e6e9f0]">
          ← All sectors
        </Link>
        <p className="mt-6 text-lg">
          {UNIVERSE_BY_ID[universe].name} has no constituents in {meta.name} ({ETF}).
        </p>
      </main>
    );
  }

  const sector = snapshot.sectors.find((s) => s.etf === ETF) ?? null;
  const etfXY = await loadSymbolSeries(ETF);
  const series = etfXY
    ? { etf: ETF, intraday: xyToPoints(etfXY.intraday), daily: xyToPoints(etfXY.daily) }
    : null;

  return (
    <SectorView
      meta={meta}
      sector={sector}
      stocks={stocks}
      series={series}
      generatedAt={snapshot.generatedAt}
      universe={universe}
    />
  );
}
