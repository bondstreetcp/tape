import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import StockCompareView from "@/components/StockCompareView";
import SetupNotice from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

// Head-to-head comparison of 2–5 user-picked tickers: margin & revenue-growth overlays,
// quality and valuation side by side. Tickers carried in ?tickers= for shareable links.
export default async function CompareStocksPage({
  params,
  searchParams,
}: {
  params: Promise<{ universe: string }>;
  searchParams: Promise<{ tickers?: string }>;
}) {
  const { universe } = await params;
  const { tickers } = await searchParams;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snapshot = await loadSnapshot(universe);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;

  const initial = (tickers || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  return <StockCompareView universe={universe} stocks={snapshot.stocks} initial={initial} generatedAt={snapshot.generatedAt} />;
}
