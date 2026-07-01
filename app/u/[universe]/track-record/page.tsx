import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { TradeLogData } from "@/lib/tradeLog";
import TradeRecordView from "@/components/TradeRecordView";

export const dynamic = "force-dynamic";

function loadTradeLog(): Promise<TradeLogData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "trade-log.json"), "utf8")
    .then((s) => JSON.parse(s) as TradeLogData)
    .catch(() => null);
}

export default async function TrackRecordPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  const meta = UNIVERSE_BY_ID[universe];
  if (!meta) notFound();

  const data = await loadTradeLog();
  let recs = data?.recs ?? [];
  const prices: Record<string, number> = {};

  if (meta.international) {
    recs = [];
  } else {
    const snap = await loadSnapshot(universe);
    const members = new Set((snap?.stocks ?? []).map((s) => s.symbol));
    if (members.size) recs = recs.filter((r) => members.has(r.symbol));
    for (const s of snap?.stocks ?? []) if (s.price != null) prices[s.symbol] = s.price;
  }

  return (
    <TradeRecordView
      universe={universe}
      recs={recs}
      prices={prices}
      generatedAt={data?.generatedAt ?? new Date().toISOString()}
      intl={!!meta.international}
    />
  );
}
