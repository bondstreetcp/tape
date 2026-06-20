import * as cheerio from "cheerio";

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  time: string | null; // ISO
  tickers: string[];
}

// Low-signal content farms, SEO mills, and non-news pages to drop (by source).
const BLOCK = [
  "stockstory", "insider monkey", "24/7 wall st", "247 wall", "gurufocus", "simply wall st",
  "investorplace", "stocktwits", "tipranks", "marketbeat", "the globe and mail", "khabarhub",
  "zacks", "etf daily news", "kavout", "trefis", "cabot", "finviz", "the motley fool", "motley fool",
  "benzinga", "talkmarkets", "barchart", "stocknews", "defense world", "watcher guru", "coinpedia",
  "financhill", "stockhouse", "value the markets", "modern readers", "stock region", "market chronicles",
  "fintel", "directorstalk", "etf trends", "pulse 2.0", "invezz",
];

// Clickbait / promo / non-news headline patterns.
const TITLE_BLOCK = [
  /\bbuy or sell\b/i, /\bbetter buy\b/i, /should (you|i) buy/i, /\b(is it )?time to buy\b/i,
  /\bmore upside\b/i, /\bstill a buy\b/i, /is there still value/i, /stock price and quote/i,
  /\bis (it|now|this|the) [a-z ]*(buy|sell)\b/i, /\bbuy now\b/i, /\b\d+\s+(reasons|stocks|things|ways|dividend)\b/i,
  /\bbest (stocks?|dividend)\b/i, /could (make|turn) you/i, /\bmillionaire\b/i, /\bworth buying\b/i,
  /\bprice prediction\b/i, /vs\.?\s+\w+.*\bbetter\b/i, /\bhere'?s why\b/i,
  /\b(buy|sell|hold)\?$/i, /\bshould you (invest|own)\b/i,
  // syndicated farm content that shows up under "Yahoo Finance" etc.
  /\bwhy\b.*\b(soar|sink|slid|plung|tumbl|surg|rall|jump|spike|crash|rocket|fall|drop|rising|climb|slip|slump)/i,
  /how to play\b/i, /changing their mind/i, /\bbillionaires?\b/i, /\bwall street'?s top\b/i,
  /\bmotley fool\b/i, /\bzacks\b/i, /\bcould (soar|double|triple|surge|skyrocket)\b/i,
  /what you should know/i, /\breach \$?\d[\d,.]*\b/i, /'s portfolio\b/i, /\bmoves [+-]?\d/i,
  /\bhedge funds?\b.*\b(buying|loading|piling)/i,
];

// Reputable outlets surfaced first (recency preserved within each tier).
const PREFERRED = [
  "reuters", "bloomberg", "cnbc", "wall street journal", "barron", "financial times", "associated press",
  "marketwatch", "yahoo finance", "investing.com", "forbes", "business insider", "axios", "the new york times",
  "seeking alpha", "9to5mac", "techcrunch", "the verge", "ars technica", "fortune", "the information",
];

const lc = (s: string) => s.toLowerCase();
const isBlocked = (pub: string) => BLOCK.some((b) => lc(pub).includes(b));
const isClickbait = (title: string) => TITLE_BLOCK.some((re) => re.test(title));
const isPreferred = (pub: string) => PREFERRED.some((p) => lc(pub).includes(p));

/** News from Google News RSS (better source mix than Yahoo's search). `query`
 *  is a ticker/company or the literal "market". */
export async function getNews(query: string, count = 12): Promise<NewsItem[]> {
  const q = query.toLowerCase() === "market" ? "stock market" : `${query} stock`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:14d")}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-screener/1.0)" } });
    if (!res.ok) return [];
    const $ = cheerio.load(await res.text(), { xmlMode: true });
    const out: NewsItem[] = [];
    $("item").each((_, el) => {
      const $el = $(el);
      const source = $el.find("source").first().text().trim();
      let title = $el.find("title").first().text().trim();
      // Google appends " - Source" to titles
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
      else title = title.replace(/\s-\s[^-]+$/, "").trim();
      const link = $el.find("link").first().text().trim();
      const pub = $el.find("pubDate").first().text().trim();
      if (!title || !link || isBlocked(source) || isClickbait(title)) return;
      out.push({
        title,
        publisher: source || "News",
        link,
        time: pub ? new Date(pub).toISOString() : null,
        tickers: [],
      });
    });
    // Two tiers: reputable outlets first, then the rest — recency preserved within each.
    const pref = out.filter((o) => isPreferred(o.publisher));
    const rest = out.filter((o) => !isPreferred(o.publisher));
    return [...pref, ...rest].slice(0, count);
  } catch {
    return [];
  }
}
