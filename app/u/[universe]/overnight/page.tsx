import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadOvernightFilings } from "@/lib/overnightFilings";
import type { FilingIndex, RelatedFiling } from "@/lib/filingIndex";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import OvernightFilingsView from "@/components/OvernightFilingsView";
import EmptyState from "@/components/EmptyState";

// The filing semantic index carries the precomputed nearest-neighbours per accession. It's internal
// state (vectors + related), so we read it here and pass ONLY the related lists to the client view —
// the vectors never cross the server boundary. Absent index (first night) → no related, page unchanged.
const loadRelated = async (): Promise<Record<string, RelatedFiling[]>> => {
  try {
    const idx = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "filing-index.json"), "utf8")) as FilingIndex;
    const m: Record<string, RelatedFiling[]> = {};
    for (const r of idx.rows) if (r.related?.length) m[r.accession] = r.related;
    return m;
  } catch { return {}; }
};

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Overnight Filings (SuperAnalyst) — AI desk notes on new material SEC filings vs the prior
// comparable. Universe-independent data; the current universe's symbol set is passed so a ticker
// only links when it lives in this universe.
export default async function OvernightPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, snapshot, related] = await Promise.all([loadOvernightFilings(), loadSnapshot(universe), loadRelated()]);
  if (!data) {
    return <EmptyState universe={universe} title="Overnight Filings" />;
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  // ticker → GICS sector, so the feed can be filtered by sector (useful once the
  // Russell 3000 firehose is on).
  const sectors: Record<string, string> = {};
  for (const s of snapshot?.stocks ?? []) if (s.sector) sectors[s.symbol] = s.sector;
  return <OvernightFilingsView universe={universe} data={data} known={known} sectors={sectors} related={related} />;
}
