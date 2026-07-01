import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { TrumpStocksData } from "@/lib/trumpStocks";
import TrumpStocksView from "@/components/TrumpStocksView";

export const dynamic = "force-dynamic";

function loadTrumpStocks(): Promise<TrumpStocksData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "trump-truth-stocks.json"), "utf8")
    .then((s) => JSON.parse(s) as TrumpStocksData)
    .catch(() => null);
}

export default async function TrumpStocksPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadTrumpStocks();
  // His calls span the whole market — not filtered to the current universe.
  return (
    <TrumpStocksView
      universe={universe}
      data={data ?? { generatedAt: new Date().toISOString(), source: "Truth Social", scanned: 0, posts: [] }}
    />
  );
}
