import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadValuationHistory } from "@/lib/valuationHistory";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ValuationExplainMap } from "@/lib/valuationExplain";
import ValuationHistoryView from "@/components/ValuationHistoryView";

export const dynamic = "force-dynamic";

// GLM genuine-vs-trap verdicts on the deepest discounts (scripts/refresh-valuation-explain.ts).
function loadExplain(): Promise<ValuationExplainMap> {
  return fs
    .readFile(path.join(process.cwd(), "data", "valuation-explain.json"), "utf8")
    .then((s) => (JSON.parse(s).verdicts ?? {}) as ValuationExplainMap)
    .catch(() => ({}));
}

// "Discount to own 10-year history" valuation screen. Universe-independent data (its own US-name
// set), but the current universe's snapshot supplies the known-symbol set (so a ticker only links
// when it lives in this universe) and the per-name GICS sector label for the table.
export default async function ValuationHistoryPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, snapshot, explain] = await Promise.all([loadValuationHistory(), loadSnapshot(universe), loadExplain()]);
  if (!data || !Object.keys(data.names).length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Discount to Own History</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">
          Data isn&apos;t built yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-valuation-history</code> to build the valuation-history dataset.
        </p>
      </main>
    );
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  const sectorBy: Record<string, string> = {};
  for (const s of snapshot?.stocks ?? []) sectorBy[s.symbol] = s.sector;
  return <ValuationHistoryView universe={universe} data={data} known={known} sectorBy={sectorBy} explain={explain} />;
}
