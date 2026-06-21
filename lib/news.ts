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
  // dropped per request: Seeking Alpha + more low-signal aggregators / SEO mills
  "seeking alpha", "seekingalpha", "moomoo", "tikr", "vingegroup", "tradingview", "stocktitan",
  "the street", "thestreet", "ainvest", "coinspeaker", "timothy sykes", "wallstreetzen", "markets insider",
  "simplywall", "simply wall",
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
  /top \w+ (stock|pick)\b/i, /top stock in\b/i, /\bin .*('s)? portfolio\b/i, /\b(griffin|buffett|burry|ackman|tepper)\b/i,
];

// Top-tier wire services & major financial press — surfaced first.
const TOP = [
  "associated press", "ap news", "apnews", "reuters", "bloomberg", "wall street journal", "wsj",
  "financial times", "cnbc", "barron", "marketwatch", "the new york times", "nytimes", "the economist", "npr",
  "investor's business daily", "investors business daily",
];
// Newswires companies use to publish their OWN investor-relations press releases —
// surfaced FIRST so the feed leads with the company's official announcements (the IR
// page), not third-party hot takes. This is the primary fix for the clickbait problem.
const WIRE = [
  "business wire", "businesswire", "pr newswire", "prnewswire", "globenewswire", "globe newswire",
  "accesswire", "access newswire", "ein presswire", "einpresswire", "newsfile corp", "newsfile",
  "issuer direct", "newmediawire", "globenewswire inc", "the newswire", "stocktwits newswire",
];

// Other reputable outlets — surfaced after the wires + top tier. Trimmed of the
// clickbait-prone aggregators (Yahoo Finance/Investing.com/Business Insider/Fox Business
// syndicate the "here's why it soared / 3 stocks to buy" filler the user keeps flagging).
const PREFERRED = [
  "forbes", "fortune", "axios", "the information", "morningstar", "cnn", "the guardian",
  "bbc", "usa today", "the washington post", "washington post", "quartz", "kiplinger",
  "investopedia", "techcrunch", "the verge", "ars technica", "wired",
  "9to5mac", "cnet", "engadget", "semafor", "fast company",
];

// ONLY publishers on the allow-list are shown (WIRE ∪ TOP ∪ PREFERRED); a block-list let
// unknown farms through, which is why the feed stayed noisy.

const lc = (s: string) => s.toLowerCase();
const isBlocked = (pub: string) => BLOCK.some((b) => lc(pub).includes(b));
const isClickbait = (title: string) => TITLE_BLOCK.some((re) => re.test(title));
const isWire = (pub: string) => WIRE.some((p) => lc(pub).includes(p));
const isTop = (pub: string) => TOP.some((p) => lc(pub).includes(p));
const isPreferred = (pub: string) => PREFERRED.some((p) => lc(pub).includes(p));

function parseFeed(xml: string, out: NewsItem[], seen: Set<string>) {
  const $ = cheerio.load(xml, { xmlMode: true });
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
    // Dedupe on the normalized headline so a press release and its media echo collapse
    // to one (the wire copy wins since the press-release query is fetched first).
    const key = title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ title, publisher: source || "News", link, time: pub ? new Date(pub).toISOString() : null, tickers: [] });
  });
}

/** News from Google News RSS. For a company we fetch its OFFICIAL PRESS RELEASES first
 *  (the IR-page announcements, via the newswires) then general coverage, and rank wires →
 *  top wire services → other reputable outlets. `query` is a ticker/company or "market". */
export async function getNews(query: string, count = 12): Promise<NewsItem[]> {
  const isMarket = query.toLowerCase() === "market";
  // Press releases are less frequent than media articles, so cast a wider time window.
  const queries = isMarket
    ? ["stock market when:14d"]
    : [`${query} press release when:120d`, `${query} stock when:30d`];
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-screener/1.0)" } });
      if (res.ok) parseFeed(await res.text(), out, seen);
    } catch {
      /* skip this query */
    }
  }
  // Allow-list, ranked: company newswires (IR press releases) → top wire services & major
  // press → other reputable outlets. Anything off the allow-list is dropped.
  const wire = out.filter((o) => isWire(o.publisher));
  const top = out.filter((o) => !isWire(o.publisher) && isTop(o.publisher));
  const pref = out.filter((o) => !isWire(o.publisher) && !isTop(o.publisher) && isPreferred(o.publisher));
  return [...wire, ...top, ...pref].slice(0, count);
}
