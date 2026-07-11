import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import type { BuybackData } from "@/lib/buybacks";
import BuybacksView from "@/components/BuybacksView";
import EmptyState from "@/components/EmptyState";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const dynamic = "force-dynamic";

// lib/buybacks stays fs-free (the client view imports its BADGE_META), so the loader lives here.
const loadBuybacks = (): Promise<BuybackData | null> =>
  fs.readFile(path.join(process.cwd(), "data", "buybacks.json"), "utf8").then((s) => JSON.parse(s) as BuybackData).catch(() => null);

// Buyback & Capital-Return board — S&P 500 capital return from SEC XBRL (US filers). The current
// universe's snapshot supplies the known-symbol set so a ticker links only when it lives here.
export default async function BuybacksPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Buyback & Capital Return" relPath="/buybacks" dataNote="This board reads US SEC XBRL filings (S&P 500 repurchases, dividends, share count)" />;

  const [data, snapshot] = await Promise.all([loadBuybacks(), loadSnapshot(universe)]);
  if (!data || !data.rows.length) return <EmptyState universe={universe} title="Buyback & Capital Return" note="The board builds on the next nightly run." />;
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  return <BuybacksView universe={universe} data={data} known={known} />;
}
