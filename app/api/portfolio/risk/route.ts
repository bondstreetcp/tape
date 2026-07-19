import { NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot, loadManySymbolSeries, loadMarketSeries } from "@/lib/data";
import { buildFactorModel, type FactorInput, type FactorKey, type PairCorr } from "@/lib/factors";
import { corrOf, type Daily } from "@/lib/pairs";
import { alignDailyReturns } from "@/lib/portfolioRisk";
import { HEDGE_ETFS } from "@/lib/hedge";
import type { StockRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCORING_UNIVERSE = "russell1000"; // matches betas.json coverage; broad-but-quality large-cap cross-section
const HOLDING_SOURCES = ["sp500", "nasdaq100", "russell1000", "sp1500", "russell3000"] as const; // freshest first
const MAX_SYMBOLS = 50; // bound the O(n²) correlation pass

async function loadBetas(): Promise<Record<string, number>> {
  try {
    const j = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "betas.json"), "utf8"));
    return (j?.betas ?? {}) as Record<string, number>;
  } catch { return {}; }
}

const toFactorInput = (s: StockRow, beta: number | null): FactorInput => ({
  symbol: s.symbol,
  trailingPE: s.trailingPE ?? null,
  forwardPE: s.forwardPE ?? null,
  priceToBook: s.priceToBook ?? null,
  dividendYield: s.dividendYield ?? null,
  marketCap: s.marketCap ?? null,
  roe: s.fund?.roe ?? null,
  roic: s.fund?.roic ?? null,
  opMargin: s.fund?.opMargin ?? null,
  grossMargin: s.fund?.grossMargin ?? null,
  fScore: s.fund?.fScore ?? null,
  netDebtEbitda: s.fund?.netDebtEbitda ?? null,
  fcfYield: s.fund?.fcfYield ?? null,
  revGrowth: s.fund?.revGrowth ?? null,
  revCagr3y: s.fund?.revCagr3y ?? null,
  shareholderYield: s.fund?.shareholderYield ?? null,
  r1w: s.returns?.["1w"] ?? null,
  r3m: s.returns?.["3m"] ?? null,
  r6m: s.returns?.["6m"] ?? null,
  r1y: s.returns?.["1y"] ?? null,
  beta,
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requested = [...new Set((searchParams.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const symbols = requested.slice(0, MAX_SYMBOLS);
  const cappedFrom = requested.length > MAX_SYMBOLS ? requested.length : null; // surfaced so the client can warn (no silent truncation)
  if (!symbols.length) return NextResponse.json({ factors: {}, corr: [], universe: SCORING_UNIVERSE, scored: 0, cappedFrom: null, cap: MAX_SYMBOLS, asOf: null });

  const [scoringSnap, betas] = await Promise.all([loadSnapshot(SCORING_UNIVERSE), loadBetas()]);

  // Factor model from the Russell 1000 cross-section (beta attached so the Low-Vol factor has a distribution).
  const universe: FactorInput[] = (scoringSnap?.stocks ?? []).map((s) => toFactorInput(s, betas[s.symbol] ?? null));
  const model = buildFactorModel(universe);

  // Look up each holding's raw metrics across the US snapshots (freshest source wins) so even a
  // Russell-3000-only small-cap gets scored against the Russell 1000 distribution.
  const rowOf = new Map<string, StockRow>();
  for (const u of HOLDING_SOURCES) {
    const snap = await loadSnapshot(u);
    for (const s of snap?.stocks ?? []) { const sym = s.symbol?.toUpperCase(); if (sym && !rowOf.has(sym)) rowOf.set(sym, s); }
  }

  const factors: Record<string, Record<FactorKey, number | null>> = {};
  let scored = 0;
  for (const sym of symbols) {
    const row = rowOf.get(sym);
    if (!row) continue;
    factors[sym] = model.score(toFactorInput(row, betas[sym] ?? null));
    scored++;
  }

  // Pairwise return correlation among the held names (day-bucketed inside corrOf).
  const seriesMap = await loadManySymbolSeries(symbols);
  const daily: Record<string, Daily> = {};
  for (const sym of symbols) { const d = seriesMap[sym]?.daily; if (Array.isArray(d) && d.length) daily[sym] = d as Daily; }
  const withSeries = symbols.filter((s) => daily[s]);
  const corr: PairCorr[] = [];
  for (let i = 0; i < withSeries.length; i++) {
    for (let j = i + 1; j < withSeries.length; j++) {
      const r = corrOf(daily[withSeries[i]], daily[withSeries[j]]);
      if (r != null) corr.push({ a: withSeries[i], b: withSeries[j], r: Math.round(r * 1000) / 1000 });
    }
  }

  // Aligned daily return matrix over the held names' shared history — the client combines it with the
  // position sizes it never uploads to get predicted vol / VaR / risk contribution (lib/portfolioRisk).
  // The market (^GSPC) series rides along on the same axis so the client can split systematic vs specific;
  // the liquid ETF menu rides along too so the client can solve the risk-minimizing hedge overlay.
  const marketSeries = await loadMarketSeries();
  const etfSeriesMap = await loadManySymbolSeries(HEDGE_ETFS.map((e) => e.etf));
  const etfDaily: Record<string, Daily> = {};
  for (const e of HEDGE_ETFS) {
    const d = etfSeriesMap[e.etf]?.daily;
    if (Array.isArray(d) && d.length) etfDaily[e.etf] = d as Daily;
  }
  const aligned = alignDailyReturns(daily, 252, marketSeries ?? undefined, etfDaily);

  return NextResponse.json({ factors, corr, aligned, universe: SCORING_UNIVERSE, scored, cappedFrom, cap: MAX_SYMBOLS, asOf: new Date().toISOString() });
}
