import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadCongress, loadTrump } from "@/lib/congress";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { CongressSummary } from "@/lib/congressSummary";
import CongressView from "@/components/CongressView";

export const dynamic = "force-dynamic";

// AI "what's notable" summary of the trades (scripts/refresh-congress-summary.ts).
function loadCongressSummary(): Promise<CongressSummary | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "congress-summary.json"), "utf8")
    .then((s) => JSON.parse(s) as CongressSummary)
    .catch(() => null);
}

// Congressional (Senate STOCK Act) trades. Universe-independent data; the current universe's
// symbol set is passed so a ticker only links when it lives in this universe.
export default async function CongressPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, trump, snapshot, summary] = await Promise.all([loadCongress(), loadTrump(), loadSnapshot(universe), loadCongressSummary()]);
  if (!data || !data.trades.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Congressional Trading</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">Trade data isn&apos;t built yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-congress</code> to pull the latest Senate disclosures.</p>
      </main>
    );
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  return <CongressView universe={universe} data={data} trump={trump} known={known} summary={summary} />;
}
