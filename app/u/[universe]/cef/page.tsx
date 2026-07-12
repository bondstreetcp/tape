import { notFound } from "next/navigation";
import { loadCef } from "@/lib/cef";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import CefScreenerView from "@/components/CefScreenerView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Closed-end fund discount-to-NAV screener. Universe-independent (its own US CEF universe);
// the route lives under /u/[universe] only so it inherits the app header + nav.
export default async function CefPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadCef();
  if (!data || !data.funds.length) {
    return <EmptyState universe={universe} title="Closed-End Fund Screener" />;
  }
  return <CefScreenerView universe={universe} data={data} />;
}
