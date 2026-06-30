/**
 * Reddit buzz → data/apewisdom.json. Pulls the ApeWisdom "all-stocks" board (r/wallstreetbets +
 * r/stocks + r/investing + more), all pages, into a per-ticker map of mention counts + 24h change.
 * Free, no key. Run: npm run refresh-apewisdom.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ApeWisdomData, ApeWisdomEntry } from "../lib/apewisdom";

const OUT = join(process.cwd(), "data", "apewisdom.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Raw { rank: number; ticker: string; name: string; mentions: number; upvotes: number; rank_24h_ago: number; mentions_24h_ago: number }

(async () => {
  const byTicker: Record<string, ApeWisdomEntry> = {};
  let pages = 1;
  for (let page = 1; page <= pages && page <= 12; page++) {
    try {
      const r = await fetch(`https://apewisdom.io/api/v1.0/filter/all-stocks/page/${page}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; tape-research)", Accept: "application/json" },
      });
      if (!r.ok) { console.log(`  page ${page}: HTTP ${r.status}`); break; }
      const j: any = await r.json();
      pages = j.pages || pages;
      for (const x of (j.results || []) as Raw[]) {
        const t = String(x.ticker || "").toUpperCase().trim();
        if (!t) continue;
        const m = Number(x.mentions) || 0, m0 = Number(x.mentions_24h_ago) || 0;
        byTicker[t] = {
          name: String(x.name || t).slice(0, 60),
          rank: Number(x.rank) || 0,
          mentions: m,
          upvotes: Number(x.upvotes) || 0,
          mentions24hAgo: m0,
          rank24hAgo: Number(x.rank_24h_ago) || 0,
          mentionChangePct: m0 > 0 ? Math.round(((m - m0) / m0) * 1000) / 10 : null,
          rankChange: x.rank_24h_ago != null && x.rank != null ? Number(x.rank_24h_ago) - Number(x.rank) : null,
        };
      }
      console.log(`  page ${page}/${pages}: ${Object.keys(byTicker).length} tickers so far`);
      await sleep(300);
    } catch (e: any) {
      console.log(`  page ${page}: ERROR ${String(e?.message || e).slice(0, 80)}`);
      break;
    }
  }
  const data: ApeWisdomData = { generatedAt: new Date().toISOString(), byTicker };
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`Wrote ${OUT} · ${Object.keys(byTicker).length} tickers with Reddit buzz`);
})();
