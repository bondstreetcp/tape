import { NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "@/lib/data";
import type { NameData } from "@/lib/portfolio";
import { parseTimeframe, type TimeframeKey } from "@/lib/timeframes";

export const dynamic = "force-dynamic";

// US snapshots, freshest first — sp500/nasdaq100 refresh intraday, so their price wins on overlap;
// the broader lists backfill the long tail. betas.json is US-only (regressed on ^GSPC).
const US_UNIVERSES = ["sp500", "nasdaq100", "russell1000", "sp1500", "russell3000"] as const;

async function loadBetas(): Promise<Record<string, number>> {
  try {
    const j = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "betas.json"), "utf8"));
    return (j?.betas ?? {}) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Build a symbol → {price,sector,marketCap,name,ret} map across the US universes (freshest source wins). */
async function buildNameMap(tf: TimeframeKey): Promise<Map<string, NameData>> {
  const map = new Map<string, NameData>();
  for (const u of US_UNIVERSES) {
    const snap = await loadSnapshot(u);
    for (const s of snap?.stocks ?? []) {
      const sym = s.symbol?.toUpperCase();
      if (!sym || map.has(sym)) continue; // keep the freshest (first-seen) source
      map.set(sym, {
        symbol: sym,
        name: s.name,
        price: s.price,
        sector: s.sector,
        marketCap: s.marketCap,
        ret: s.returns?.[tf] ?? null,
      });
    }
  }
  return map;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbols = (searchParams.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const tf: TimeframeKey = parseTimeframe(searchParams.get("tf")) ?? "ytd";

  if (!symbols.length) return NextResponse.json({ data: {}, missing: [], tf, asOf: null });

  const [names, betas] = await Promise.all([buildNameMap(tf), loadBetas()]);

  const data: Record<string, NameData> = {};
  const missing: string[] = [];
  for (const sym of new Set(symbols)) {
    const nd = names.get(sym);
    if (!nd || !(nd.price > 0)) {
      missing.push(sym);
      continue;
    }
    const beta = betas[sym];
    data[sym] = { ...nd, beta: typeof beta === "number" && Number.isFinite(beta) ? beta : null };
  }

  return NextResponse.json({ data, missing, tf, asOf: new Date().toISOString() });
}
