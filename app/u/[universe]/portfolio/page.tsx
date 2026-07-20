import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import PortfolioCockpit from "@/components/PortfolioCockpit";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Prism owns this route's identity within Tape — its own tab title + gem favicon. Setting `icons` here
// overrides the root layout's Tape favicon for this route only (metadata is shallow-merged per segment).
export const metadata: Metadata = {
  title: "Prism — Portfolio Intelligence",
  description:
    "See what your returns are made of — institutional-grade portfolio risk, decomposed: exposure, factor attribution, predicted vol & VaR, crowding, and a solved hedge, all as a share of your AUM.",
  icons: { icon: [{ url: "/icons/prism.svg", type: "image/svg+xml" }] },
};

export default async function PortfolioPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  // Universe-agnostic: a book is personal. Prices/betas are US-only; intl tickers degrade gracefully.
  return <PortfolioCockpit universe={universe} />;
}
