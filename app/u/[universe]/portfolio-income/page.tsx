import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadPutWrite } from "@/lib/putwrite";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { IncomeCandidate } from "@/lib/portfolioIncome";
import PortfolioIncome from "@/components/PortfolioIncome";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Portfolio Options Income — the covered-call suggestions (from the nightly putwrite scan) are shipped
// slim to the client, which reads the pasted book from localStorage and joins to it. Book stays local.
export default async function PortfolioIncomePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Portfolio Income" relPath="/portfolio-income" dataNote="The covered-call suggestions are built from the US options chains in the put-writing scan" />;

  const pw = await loadPutWrite();
  const candidates: IncomeCandidate[] = (pw?.candidates ?? []).map((c) => ({
    symbol: c.symbol, name: c.name, sector: c.sector, price: c.price,
    nextEarnings: c.nextEarnings, earningsEstimate: c.earningsEstimate, calls: c.calls,
  }));

  return <PortfolioIncome universe={universe} candidates={candidates} generatedAt={pw?.generatedAt ?? new Date().toISOString()} />;
}
