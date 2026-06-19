import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { getFinancials } from "@/lib/financials";
import { getCompanyStats } from "@/lib/companyStats";
import FinancialsView from "@/components/FinancialsView";

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

  const [financials, stats] = await Promise.all([
    getFinancials(SYM),
    getCompanyStats(SYM),
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
    />
  );
}
