import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadCef } from "@/lib/cef";
import { buildCefHunter } from "@/lib/cefHunter";
import CefHunterView from "@/components/CefHunterView";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

// CEF Discount Hunter — the scored shortlist of the most stretched US closed-end-fund discounts.
// Reuses data/cef.json; the [universe] param only drives nav + links.
export default async function CefHunterPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadCef();
  const funds = data?.funds ? buildCefHunter(data.funds) : [];
  if (!funds.length) {
    return <EmptyState universe={universe} title="CEF Discount Hunter" />;
  }
  return <CefHunterView universe={universe} funds={funds} />;
}
