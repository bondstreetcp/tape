import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadValuationHistory } from "@/lib/valuationHistory";
import { buildRelStat, type IndexValuationData, type RelStat } from "@/lib/relValuation";

export const dynamic = "force-dynamic";

// Company multiples relative to the S&P 500 median multiple, over time (server-side join of the
// per-name valuation history + the synthesized index series — avoids shipping the big files client-side).
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const vh = await loadValuationHistory();
  const name = vh?.names?.[sym];
  if (!name) return NextResponse.json({ available: false });

  let idx: IndexValuationData | null = null;
  try {
    const p = join(process.cwd(), "data", "index-valuation-history.json");
    if (existsSync(p)) idx = JSON.parse(readFileSync(p, "utf8")) as IndexValuationData;
  } catch {
    /* not built yet */
  }
  if (!idx) return NextResponse.json({ available: false });

  const stats: RelStat[] = [];
  for (const mk of name.eligible) {
    const r = buildRelStat(mk, name.multiples[mk]?.series, idx.series[mk]);
    if (r) stats.push(r);
  }
  if (!stats.length) return NextResponse.json({ available: false });
  return NextResponse.json({ available: true, label: idx.label, asOf: idx.asOf, stats }, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800" } });
}
