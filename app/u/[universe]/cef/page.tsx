import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { latestCampaignByTicker, loadCef } from "@/lib/cef";
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
  // Activist join: a 13D on a discounted fund is the discount-closing catalyst (tenders, open-ending,
  // board seats) — the campaigns feed already captures CEF targets, so this is a pure read-side join.
  const campaigns = await fs
    .readFile(path.join(process.cwd(), "data", "campaigns.json"), "utf8")
    .then((s) => JSON.parse(s).campaigns as any[])
    .catch(() => [] as any[]);
  const act = latestCampaignByTicker(campaigns ?? [], new Set(data.funds.map((f) => f.ticker)));
  if (act.size) for (const f of data.funds) { const a = act.get(f.ticker); if (a) f.activist = a; }
  return <CefScreenerView universe={universe} data={data} />;
}
