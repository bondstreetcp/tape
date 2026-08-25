/**
 * SERVER-ONLY live fetch for the market-headlines wire (cheerio + network) — kept OUT of
 * lib/marketHeadlines.ts so the client bundle never pulls cheerio in. Used by BOTH the API route
 * (/api/market-headlines, live + 5-min cache) and the nightly extractor (scripts/refresh-market-headlines).
 */
import { promises as fsp } from "fs";
import path from "path";
import * as cheerio from "cheerio";
import type { HeadlineTopic, MarketHeadline, MarketHeadlinesData } from "./marketHeadlines";

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
  /bullish or bearish/i, /climb or sink/i, /predicting .+ stock/i, /\bstock (a )?(buy|sell|hold)\b/i, /\b(buy|sell|hold) rating\b/i,
];
const lc = (s: string) => s.toLowerCase();
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 70);

async function fetchTopic(topic: HeadlineTopic, q: string): Promise<MarketHeadline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=en-US&gl=US&ceid=US:en`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) return [];
    const $ = cheerio.load(await res.text(), { xmlMode: true });
    const out: MarketHeadline[] = [];
    $("item").each((_, el) => {
      const $el = $(el);
      const source = $el.find("source").first().text().trim();
      let title = $el.find("title").first().text().trim();
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
  } catch {
    return []; // a slow/blocked topic drops out; the others still return
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch all topics in parallel, dedupe by title, newest first. Returns [] if every topic failed. */
export async function fetchLiveMarketHeadlines(limit = 60): Promise<MarketHeadline[]> {
  const batches = await Promise.all(TOPICS.map(({ topic, q }) => fetchTopic(topic, q)));
  const all = batches.flat();
  const seen = new Set<string>();
  return all
    .sort((a, b) => (Date.parse(b.time || "") || 0) - (Date.parse(a.time || "") || 0))
    .filter((h) => { const k = norm(h.title); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit);
}

/** Read the committed wire (the baked SSR seed / offline fallback). Empty (never throws) until it runs. */
export async function getMarketHeadlines(limit = 30): Promise<MarketHeadline[]> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "market-headlines.json"), "utf8");
    const d = JSON.parse(raw) as MarketHeadlinesData;
    return (d.headlines ?? [])
      .filter((h) => h && h.title && h.url)
      .sort((a, b) => (Date.parse(b.time || "") || 0) - (Date.parse(a.time || "") || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}
