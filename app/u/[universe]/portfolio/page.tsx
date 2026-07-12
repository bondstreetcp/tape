import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import PortfolioCockpit from "@/components/PortfolioCockpit";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function PortfolioPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  // Universe-agnostic: a book is personal. Prices/betas are US-only; intl tickers degrade gracefully.
  return <PortfolioCockpit universe={universe} />;
}
