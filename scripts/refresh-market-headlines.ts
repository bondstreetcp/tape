/**
 * Builds data/market-headlines.json — the "market headlines" wire (general macro / market / geopolitical
 * flashes: Fed-speaker comments, tariffs/trade, OPEC/oil, rates, China/geopolitics) the company-news tape
 * and the BEA/BLS release feed don't carry. FREE & KEYLESS off Google News RSS.
 *
 * This baked file is the SSR seed + offline fallback; the live freshness comes from /api/market-headlines
 * (same fetcher, 5-min cache). Both call lib/marketHeadlinesFetch. Run: npm run refresh-market-headlines.
 * Nightly (FULL).
 */
import { promises as fsp } from "fs";
import path from "path";
import { fetchLiveMarketHeadlines } from "../lib/marketHeadlinesFetch";
import type { MarketHeadlinesData } from "../lib/marketHeadlines";

const OUT = path.join(process.cwd(), "data", "market-headlines.json");

async function main() {
  const headlines = await fetchLiveMarketHeadlines(60);
  if (!headlines.length) { console.error("market-headlines: no headlines fetched — not overwriting."); process.exit(1); }
  await fsp.writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), headlines } satisfies MarketHeadlinesData));
  console.log(`market-headlines: wrote ${headlines.length} → ${OUT}`);
  for (const h of headlines.slice(0, 10)) console.log(`  [${h.topic.padEnd(7)}] ${h.title.slice(0, 72)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
