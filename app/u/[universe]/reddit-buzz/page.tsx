import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildBuzzRows, type ApeWisdomData } from "@/lib/apewisdom";
import RedditBuzzView from "@/components/RedditBuzzView";

export const dynamic = "force-dynamic";

// Cross-universe Reddit-buzz board — what retail is talking about (ApeWisdom mention counts).
export default async function RedditBuzzPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  let data: ApeWisdomData | null = null;
  try {
    const p = join(process.cwd(), "data", "apewisdom.json");
    if (existsSync(p)) data = JSON.parse(readFileSync(p, "utf8")) as ApeWisdomData;
  } catch {
    /* not built */
  }

  const snap = (await loadSnapshot("russell3000")) ?? (await loadSnapshot("sp500")) ?? (await loadSnapshot(universe));
  const sectorOf = new Map((snap?.stocks ?? []).map((s) => [s.symbol, s.sector] as const));
  const rows = data ? buildBuzzRows(data, (t) => sectorOf.get(t)) : [];

  return <RedditBuzzView rows={rows} universe={universe} asOf={data?.generatedAt?.slice(0, 10) ?? "—"} />;
}
