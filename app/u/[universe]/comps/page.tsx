import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildCompsRows, type SssData } from "@/lib/sameStoreSales";
import CompsBoardView from "@/components/CompsBoardView";

export const dynamic = "force-dynamic";

// Cross-universe Comps Board — ranks every restaurant/retailer with a disclosed same-store-sales
// figure. Joins the extracted comp series (data/same-store-sales.json) to company names from the
// broadest available snapshot.
export default async function CompsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  let data: SssData | null = null;
  try {
    const p = join(process.cwd(), "data", "same-store-sales.json");
    if (existsSync(p)) data = JSON.parse(readFileSync(p, "utf8")) as SssData;
  } catch {
    /* not built */
  }

  // Names from the broadest snapshot we have (comps names span S&P500∪Nasdaq100∪Russell1000).
  const snap = (await loadSnapshot("russell3000")) ?? (await loadSnapshot("sp500")) ?? (await loadSnapshot(universe));
  const nameOf = new Map((snap?.stocks ?? []).map((s) => [s.symbol, s.name] as const));
  const rows = data ? buildCompsRows(data, (t) => nameOf.get(t)) : [];

  return <CompsBoardView rows={rows} universe={universe} asOf={data?.generatedAt?.slice(0, 10) ?? "—"} />;
}
