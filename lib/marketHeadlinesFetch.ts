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

// Reputable-source ALLOWLIST. Google News's long tail is mostly SEO / aggregator / local-paper junk
// (Motley Fool, Investopedia, AOL, Seeking Alpha, local TV…), so we keep ONLY these (substring, case-
// insensitive) — quality over quantity. Loosen if the wire ever gets too thin.
const ALLOW = [
  "reuters", "bloomberg", "associated press", "ap news", "wall street journal", "wsj",
  "cnbc", "marketwatch", "barron", "financial times", "ft.com", "the economist", "semafor",
  "yahoo finance", "business insider", "fortune", "forbes", "investor's business daily",
  "washington post", "new york times", "nytimes", "the hill", "politico", "axios", "npr",
  "cbs news", "abc news", "cnn", "usa today", "the guardian", "bbc", "morningstar",
  "nikkei", "south china morning post", "quartz",
];
// Clickbait / SEO title patterns to drop even from an allowed source.
const CLICKBAIT = [
  /\b\d+ (stocks|things|reasons|ways|charts)\b/i, /should you buy/i, /here'?s (why|what)/i, /could make you/i, /\bbest stocks\b/i, /motley/i,
  /bullish or bearish/i, /climb or sink/i, /predicting .+ stock/i, /\bstock (a )?(buy|sell|hold)\b/i, /\b(buy|sell|hold) rating\b/i,
  /could mean for/i, /what it means for/i, /what to know/i, /things to know/i, /\btalks impact\b/i, /is it time to/i, /reasons to (buy|watch)/i,
];
const lc = (s: string) => s.toLowerCase();
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 70);

// A clear cashtag → ticker ("$AAPL - APPLE…" → "AAPL"). Only $TICKER (letters), never $-amounts ($20B),
// and skip $-prefixed non-tickers so we don't mis-link. Precision over recall — a wrong link is worse.
const NOT_TICKERS = new Set(["US", "USD", "EUR", "GBP", "JPY", "GDP", "CPI", "PPI", "FED", "ECB", "BOJ", "OPEC", "CEO", "CFO", "IPO", "AI", "EV", "UK", "EU", "GOP", "FBI", "CIA", "UN"]);
function extractTicker(t: string): string | null {
  const m = t.match(/\$([A-Za-z]{1,5})\b/);
  if (!m) return null;
  const tk = m[1].toUpperCase();
  return NOT_TICKERS.has(tk) ? null : tk;
}

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
      if (!ALLOW.some((a) => lc(source).includes(a))) return; // reputable sources only
      if (CLICKBAIT.some((re) => re.test(title))) return;
      out.push({
        title: title.slice(0, 200),
        publisher: source || "News",
        url: link,
        time: pub && !Number.isNaN(Date.parse(pub)) ? new Date(pub).toISOString() : null,
        topic,
        ticker: extractTicker(title),
      });
    });
    return out;
  } catch {
    return []; // a slow/blocked topic drops out; the others still return
  } finally {
    clearTimeout(timer);
  }
}

// Bucket a curated flash into a topic from its keywords (Google-News items carry their own topic).
function classifyTopic(t: string): HeadlineTopic {
  const s = t.toLowerCase();
  if (/\b(fed|fomc|powell|collins|bostic|waller|williams|kashkari|beige book|rate hike|rate cut|interest rate|central bank|\becb\b|\bboj\b|bank of england)\b/.test(s)) return "Fed";
  if (/\b(treasury|yield|bond|10-year|2-year|30-year|debt|refunding|auction|financial repression)\b/.test(s)) return "Rates";
  if (/\b(tariff|trade war|trade deal|trade talks|import|export|\bwto\b|trade tension)\b/.test(s)) return "Trade";
  if (/\b(oil|opec|crude|brent|\bwti\b|natural gas|energy|barrel|refiner)\b/.test(s)) return "Energy";
  if (/\b(china|russia|iran|ukraine|israel|geopolit|sanction|\bwar\b|election|midterm|hormuz|nato|tariffs? on)\b/.test(s)) return "Global";
  return "Markets";
}

// Walter Bloomberg's PUBLIC Telegram channel, read via the account-free web preview (t.me/s/<channel>) —
// his hand-curated market flashes, the same feed as his X/Discord. Reading a public web page (no login,
// no API key) — this is fair use of public content, unlike self-botting a login-gated platform.
async function fetchTelegramChannel(channel: string, brand: string): Promise<MarketHeadline[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://t.me/s/${channel}`, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) return [];
    const html = await res.text();
    const out: MarketHeadline[] = [];
    // Each post is a .tgme_widget_message block carrying data-post (permalink id), a <time datetime>, and
    // a _message_text div. Split on the block so id/time/text stay associated.
    for (const b of html.split('<div class="tgme_widget_message ').slice(1)) {
      const id = (b.match(/data-post="([^"]+)"/) || [])[1] || "";
      const dt = (b.match(/<time[^>]+datetime="([^"]+)"/) || [])[1] || "";
      const rawText = (b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "";
      if (!rawText) continue;
      // He posts HEADLINE then detail — take the first line as the headline; strip his self-tag + entities.
      const text = rawText.split(/<br\s*\/?>/i)[0]
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&#0?36;/g, "$").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&nbsp;/g, " ")
        .replace(/\(\s*@?\s*walter\s*bloomberg\s*\)/i, "").replace(/^[*🇺🇸\s]+/, "")
        .replace(/\s+/g, " ").trim();
      if (text.length < 6) continue;
      out.push({
        title: text.slice(0, 240),
        publisher: brand,
        url: id ? `https://t.me/${id}` : `https://t.me/s/${channel}`,
        time: dt && !Number.isNaN(Date.parse(dt)) ? new Date(dt).toISOString() : null,
        topic: classifyTopic(text),
        curated: true,
        ticker: extractTicker(text),
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The wire: Walter Bloomberg's curated Telegram flashes LEAD (newest first), then the reputable-source
 * Google-News aggregate behind them (deduped against his). His feed is the whole point; the aggregate is
 * the backfill for anything he didn't flag. Returns [] only if everything failed.
 */
export async function fetchLiveMarketHeadlines(limit = 60): Promise<MarketHeadline[]> {
  const [wb, ...batches] = await Promise.all([
    fetchTelegramChannel("WalterBloomberg", "Walter Bloomberg"),
    ...TOPICS.map(({ topic, q }) => fetchTopic(topic, q)),
  ]);
  const byTime = (a: MarketHeadline, b: MarketHeadline) => (Date.parse(b.time || "") || 0) - (Date.parse(a.time || "") || 0);
  const seen = new Set<string>();
  const dedupe = (arr: MarketHeadline[]) => arr.filter((h) => { const k = norm(h.title); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  const curated = dedupe([...wb].sort(byTime)); // his flashes first — seeds `seen` so the aggregate can't echo them
  const rest = dedupe(batches.flat().sort(byTime));
  return [...curated, ...rest].slice(0, limit);
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
