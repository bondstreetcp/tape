/**
 * Builds data/market-headlines.json — the "market headlines" wire: general macro / market / geopolitical
 * flashes (Fed-speaker comments, tariffs/trade, OPEC/oil, rates, China/geopolitics) that the company-news
 * tape (EDGAR + press wires) and the BEA/BLS release feed don't carry. FREE & KEYLESS, off Google News RSS.
 *
 * This is the ToS-clean, ~10-min-lagged stand-in for the NON-company slice of a paid headline wire — the
 * kind of thing @DeltaOne relays beyond gov data. No sub-second latency, no human curation. Run:
 * npm run refresh-market-headlines. Nightly (FULL); cheap enough to move to the intraday clock later.
 */
import { promises as fsp } from "fs";
import path from "path";
import * as cheerio from "cheerio";
import type { HeadlineTopic, MarketHeadline, MarketHeadlinesData } from "../lib/marketHeadlines";

const OUT = path.join(process.cwd(), "data", "market-headlines.json");
const KEEP = 60;
const UA = "Mozilla/5.0 (tape market-headlines research; jameslyeh@gmail.com)";

// Curated Google News searches for the flashes the company tape misses — the macro/geopolitical layer.
const TOPICS: { topic: HeadlineTopic; q: string }[] = [
  { topic: "Markets", q: "stock market OR S&P 500 OR Wall Street" },
  { topic: "Fed", q: "Federal Reserve OR Jerome Powell OR FOMC OR interest rate" },
  { topic: "Rates", q: "Treasury yields OR bond market" },
  { topic: "Trade", q: "tariffs OR trade war OR trade deal" },
  { topic: "Energy", q: "OPEC OR oil prices OR crude oil" },
  { topic: "Global", q: "China economy OR ECB OR global markets geopolitics" },
];

// Low-signal SEO/content-farm sources + clickbait patterns to drop (same spirit as lib/news.ts).
const BLOCK = ["motley fool", "zacks", "investorplace", "insider monkey", "simply wall", "gurufocus", "marketbeat", "tipranks", "24/7 wall", "barchart"];
const CLICKBAIT = [
  /\b\d+ (stocks|things|reasons|ways)\b/i, /should you buy/i, /here'?s why/i, /could make you/i, /\bbest stocks\b/i, /motley/i,
  // Templated per-stock "analyst rating" SEO — not macro headlines.
  /bullish or bearish/i, /climb or sink/i, /predicting .+ stock/i, /\bstock (a )?(buy|sell|hold)\b/i, /\b(buy|sell|hold) rating\b/i,
];
const lc = (s: string) => s.toLowerCase();
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 70);

async function fetchTopic(topic: HeadlineTopic, q: string): Promise<MarketHeadline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const $ = cheerio.load(await res.text(), { xmlMode: true });
  const out: MarketHeadline[] = [];
  $("item").each((_, el) => {
    const $el = $(el);
    const source = $el.find("source").first().text().trim();
    let title = $el.find("title").first().text().trim();
    // Google News suffixes "<headline> - <source>"; strip it so the row is just the headline.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const link = $el.find("link").first().text().trim();
    const pub = $el.find("pubDate").first().text().trim();
    if (!title || !link) return;
    if (BLOCK.some((b) => lc(source).includes(b)) || CLICKBAIT.some((re) => re.test(title))) return;
    out.push({
      title: title.slice(0, 200),
      publisher: source || "News",
      url: link,
      time: pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null,
      topic,
    });
  });
  return out;
}

async function main() {
  const all: MarketHeadline[] = [];
  for (const { topic, q } of TOPICS) {
    try { all.push(...(await fetchTopic(topic, q))); }
    catch (e: any) { console.warn(`  ${topic}: ${String(e?.message || e).slice(0, 60)}`); }
  }
  if (!all.length) { console.error("market-headlines: no headlines fetched — not overwriting."); process.exit(1); }

  // Dedupe by normalized title (one story surfaces under several topics), newest first, cap the wire.
  const seen = new Set<string>();
  const headlines = all
    .sort((a, b) => (Date.parse(b.time || "") || 0) - (Date.parse(a.time || "") || 0))
    .filter((h) => { const k = norm(h.title); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, KEEP);

  await fsp.writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), headlines } satisfies MarketHeadlinesData));
  console.log(`market-headlines: wrote ${headlines.length} (from ${all.length} raw) → ${OUT}`);
  for (const h of headlines.slice(0, 10)) console.log(`  [${h.topic.padEnd(7)}] ${h.title.slice(0, 72)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
