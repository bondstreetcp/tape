import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import PortfolioCockpit from "@/components/PortfolioCockpit";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  // Universe-agnostic: a book is personal. Prices/betas are US-only; intl tickers degrade gracefully.
  return <PortfolioCockpit universe={universe} />;
}
