import { getMarketMonitor } from "@/lib/market";
import MarketMonitor from "@/components/MarketMonitor";

// Cross-asset quotes refresh on a short ISR window.
export const revalidate = 300;

export default async function MarketPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  const { groups, asOf } = await getMarketMonitor();
  return <MarketMonitor groups={groups} asOf={asOf} universe={universe} />;
}
