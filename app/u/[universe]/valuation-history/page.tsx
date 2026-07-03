import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadValuationHistory } from "@/lib/valuationHistory";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ValuationExplainMap } from "@/lib/valuationExplain";
import ValuationHistoryView from "@/components/ValuationHistoryView";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

// GLM genuine-vs-trap verdicts on the deepest discounts (scripts/refresh-valuation-explain.ts).
// generatedAt rides along so the badges can carry an "AI · as of" staleness label.
function loadExplain(): Promise<{ map: ValuationExplainMap; asOf: string | null }> {
  return fs
    .readFile(path.join(process.cwd(), "data", "valuation-explain.json"), "utf8")
    .then((s) => {
      const j = JSON.parse(s);
      return { map: (j.verdicts ?? {}) as ValuationExplainMap, asOf: typeof j.generatedAt === "string" ? j.generatedAt : null };
    })
    .catch(() => ({ map: {} as ValuationExplainMap, asOf: null }));
}

// "Discount to own 10-year history" valuation screen. Universe-independent data (its own US-name
// set), but the current universe's snapshot supplies the known-symbol set (so a ticker only links
// when it lives in this universe) and the per-name GICS sector label for the table.
export default async function ValuationHistoryPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, snapshot, explain] = await Promise.all([loadValuationHistory(), loadSnapshot(universe), loadExplain()]);
  if (!data || !Object.keys(data.names).length) {
    return <EmptyState universe={universe} title="Discount to Own History" />;
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  const sectorBy: Record<string, string> = {};
  for (const s of snapshot?.stocks ?? []) sectorBy[s.symbol] = s.sector;
  return <ValuationHistoryView universe={universe} data={data} known={known} sectorBy={sectorBy} explain={explain.map} explainAsOf={explain.asOf} />;
}
