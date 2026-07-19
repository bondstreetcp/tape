/**
 * Average daily $ volume for the Portfolio cockpit's liquidity / exit-concentration read. The stored
 * price series carry no volume, so this fetches Yahoo's 3-month average daily volume (× price) for the
 * US universe + the hedge ETFs, batched → data/adv.json {sym: dollarADV}. /api/portfolio serves it;
 * computeLiquidity turns it into days-to-liquidate. Flows to R2 with data/; nightly-safe (keeps the
 * prior file if the fetch comes back thin).
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { HEDGE_ETFS } from "../lib/hedge";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const BATCH = 200;

async function main() {
  const syms = new Set<string>(HEDGE_ETFS.map((e) => e.etf));
  for (const u of ["sp500", "nasdaq100", "russell1000"]) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DATA, u, "snapshot.json"), "utf8"));
      for (const s of j.stocks ?? []) if (s.symbol) syms.add(String(s.symbol).toUpperCase());
    } catch { /* skip a missing universe */ }
  }
  const list = [...syms];
  const adv: Record<string, number> = {};
  let ok = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    const q: any = await yf
      .quote(batch, { fields: ["symbol", "regularMarketPrice", "averageDailyVolume3Month"] } as any)
      .catch((e: any) => { console.error(`adv: batch ${i} err — ${e?.message}`); return []; });
    for (const r of (Array.isArray(q) ? q : [q])) {
      const v = r?.averageDailyVolume3Month, p = r?.regularMarketPrice;
      if (r?.symbol && v > 0 && p > 0) { adv[String(r.symbol).toUpperCase()] = Math.round(v * p); ok++; }
    }
    console.log(`adv: ${Math.min(i + BATCH, list.length)}/${list.length} scanned (${ok} priced)`);
  }
  if (ok < 100) { console.error("adv: too few names priced — keeping previous file"); process.exit(1); }
  await fs.writeFile(path.join(DATA, "adv.json"), JSON.stringify({ generatedAt: new Date().toISOString(), adv }));
  console.log(`adv: wrote ${ok} names to adv.json`);
}
main();
