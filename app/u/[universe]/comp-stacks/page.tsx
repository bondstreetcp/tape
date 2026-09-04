import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import type { SssData } from "@/lib/sameStoreSales";
import { INTL_COMPS } from "@/lib/intlComps";
import { readCompanyCache } from "@/lib/companyCache";
import { buildCompStackRows, type AnalyzeOpts } from "@/lib/compStack";
import CompStackView from "@/components/CompStackView";

export const dynamic = "force-dynamic";

// 2-yr Comp Stack Analyzer — every restaurant/retailer with a stackable comp series, with what its latest
// comp GUIDE implies for the two-year stack over the rest of its fiscal year (lib/compStack). Reads the
// nightly comp series + comp outlook (data/same-store-sales.json) and the baked per-stock cache for the
// prior-year quarterly revenue that weights the fiscal quarters.
export default async function CompStacksPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  let data: SssData | null = null;
  try {
    const p = join(process.cwd(), "data", "same-store-sales.json");
    if (existsSync(p)) data = JSON.parse(readFileSync(p, "utf8")) as SssData;
  } catch {
    /* not built */
  }

  const snap = (await loadSnapshot("russell3000")) ?? (await loadSnapshot("sp500")) ?? (await loadSnapshot(universe));
  const nameOf = new Map<string, string>([
    ...(snap?.stocks ?? []).map((s) => [s.symbol, s.name] as const),
    ...INTL_COMPS.map((c) => [c.yahoo, c.name] as const),
  ]);

  // Quarterly revenue ($M) from the baked company cache — cache-only, never a live fetch: this is a
  // ~100-name board rendered per request, and equal weights are the documented fallback.
  const revenue = new Map<string, AnalyzeOpts["revenueByDate"]>();
  if (data) {
    await Promise.all(
      Object.keys(data.byTicker).map(async (t) => {
        const q = (await readCompanyCache(t))?.financials?.quarterly ?? [];
        if (q.length) revenue.set(t, q.map((p) => ({ date: p.date, rev: typeof p.totalRevenue === "number" ? p.totalRevenue / 1e6 : null })));
      }),
    );
  }
  const rows = data ? buildCompStackRows(data, (t) => nameOf.get(t), (t) => revenue.get(t)) : [];

  return <CompStackView rows={rows} universe={universe} asOf={data?.generatedAt?.slice(0, 10) ?? "—"} />;
}
