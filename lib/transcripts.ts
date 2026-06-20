import * as cheerio from "cheerio";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export interface TranscriptLink {
  title: string;
  publisher: string;
  link: string; // Google News redirect → opens the publisher's transcript
  time: string | null;
}

export interface FullTranscript {
  title: string;
  date: string | null;
  source: string;
  url: string;
  text: string;
}

// Publishers that post actual full transcripts (not "highlights" recaps).
const GOOD = ["motley fool", "fool", "fortune", "investing.com", "seeking alpha", "insider", "the globe"];

/** Find links to recent earnings-call transcripts via Google News. We surface
 *  links (which open fine in a browser) rather than scraping each publisher's
 *  page — Google News redirect URLs can't be resolved to raw text server-side. */
export async function getTranscriptLinks(query: string, symbol = "", count = 8): Promise<TranscriptLink[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    `${query} earnings call transcript`,
  )}&hl=en-US&gl=US&ceid=US:en`;
  const sym = symbol.toUpperCase();
  const tickerRe = sym ? new RegExp(`\\(${sym}\\)|\\b${sym}\\b`) : null;
  const nameKw = nameKey(query);
  // Drop off-topic results: a title that names a *different* company's ticker in
  // parens, or one that mentions neither this ticker nor the company name.
  const relevant = (title: string) => {
    const tk = [...title.matchAll(/\(([A-Z]{1,5})\)/g)].map((m) => m[1]);
    if (tk.length && sym && !tk.includes(sym)) return false;
    if (tickerRe && tickerRe.test(title)) return true;
    if (!nameKw || !title.toLowerCase().includes(nameKw)) return false;
    // name matched but no ticker — reject same-name entities (e.g. "Apple Hospitality").
    return !new RegExp(`\\b${nameKw}\\s+(hospitality|realty|reit|trust|financial|bancorp|holdings|industries|properties|partners|capital)\\b`, "i").test(title);
  };
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; stock-screener/1.0)" } });
    if (!res.ok) return [];
    const $ = cheerio.load(await res.text(), { xmlMode: true });
    const out: TranscriptLink[] = [];
    $("item").each((_, el) => {
      const $el = $(el);
      const source = $el.find("source").first().text().trim();
      let title = $el.find("title").first().text().trim();
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
      const link = $el.find("link").first().text().trim();
      const pub = $el.find("pubDate").first().text().trim();
      const low = title.toLowerCase();
      // Must be an actual transcript, not a "highlights"/"key takeaways" recap.
      if (!link || !low.includes("transcript") || low.includes("highlights") || low.includes("takeaway") || !relevant(title)) return;
      out.push({ title, publisher: source || "News", link, time: pub ? new Date(pub).toISOString() : null });
    });
    // Chronological (newest first); ticker-match + known transcript sources break
    // ties (and keep same-name companies like "Apple Hospitality REIT" down).
    const score = (x: TranscriptLink) =>
      (tickerRe && tickerRe.test(x.title) ? -2 : 0) +
      (GOOD.some((g) => x.publisher.toLowerCase().includes(g)) ? -1 : 0);
    out.sort((a, b) => {
      const ta = a.time ? Date.parse(a.time) : 0;
      const tb = b.time ? Date.parse(b.time) : 0;
      return tb - ta || score(a) - score(b);
    });
    return out.slice(0, count);
  } catch {
    return [];
  }
}

// First distinctive word of a company name, to match it in a URL slug
// (so "Apple Hospitality REIT" / slug "aple-…" doesn't match AAPL / "apple-…").
function nameKey(name: string): string {
  const STOP = new Set(["the", "inc", "corp", "corporation", "co", "company", "ltd", "limited", "group", "holdings", "plc", "sa", "nv", "ag"]);
  return (
    name
      .replace(/[.,&]/g, " ")
      .split(/\s+/)
      .map((s) => s.toLowerCase())
      .find((s) => s.length > 1 && !STOP.has(s)) || ""
  );
}

/** The latest earnings-call transcript as full readable text. The Motley Fool
 *  posts complete transcripts (prepared remarks + Q&A) for free; we read the
 *  ticker's fool.com quote page (which lists its recent transcripts), pick the
 *  newest, and parse the article body. Returns null if none is found. */
export async function getLatestTranscript(symbol: string, name = ""): Promise<FullTranscript | null> {
  const cands = await transcriptCandidates(symbol, name);
  return cands.length ? fetchTranscript(symbol, cands[0]) : null;
}

/** The last `n` earnings-call transcripts (newest first) for trend analysis. */
export async function getRecentTranscripts(symbol: string, name = "", n = 6): Promise<FullTranscript[]> {
  const cands = (await transcriptCandidates(symbol, name)).slice(0, n);
  const out = await Promise.all(cands.map((c) => fetchTranscript(symbol, c)));
  return out.filter((t): t is FullTranscript => !!t);
}

// Recent transcript URLs (newest first) from the ticker's fool.com quote page.
async function transcriptCandidates(symbol: string, name: string): Promise<{ url: string; date: string }[]> {
  const sym = symbol.toLowerCase();
  const key = nameKey(name || symbol);
  try {
    let paths: string[] = [];
    for (const ex of ["nasdaq", "nyse", "nysemkt"]) {
      const r = await fetch(`https://www.fool.com/quote/${ex}/${sym}/`, { headers: { "User-Agent": BROWSER_UA } });
      if (!r.ok) continue;
      paths = [...(await r.text()).matchAll(/\/earnings\/call-transcripts\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/g)].map((m) => m[0]);
      if (paths.length) break;
    }
    if (!paths.length) return [];
    const all = [...new Set(paths)].map((p) => {
      const slug = p.split("/").filter(Boolean).pop() || "";
      const dm = p.match(/call-transcripts\/(\d{4})\/(\d{2})\/(\d{2})\//);
      return { url: `https://www.fool.com${p}/`, date: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : "", slug };
    });
    let cands = all.filter((c) => c.slug.includes(sym) || (key && c.slug.includes(key)));
    if (!cands.length) cands = all;
    cands.sort((a, b) => b.date.localeCompare(a.date));
    return cands.map(({ url, date }) => ({ url, date }));
  } catch {
    return [];
  }
}

async function fetchTranscript(symbol: string, c: { url: string; date: string }): Promise<FullTranscript | null> {
  try {
    const pres = await fetch(c.url, { headers: { "User-Agent": BROWSER_UA } });
    if (!pres.ok) return null;
    const $ = cheerio.load(await pres.text());
    const body = $(".article-body").first();
    if (!body.length) return null;
    const NOISE = /^Image source:|Need a quote from a Motley Fool analyst|^Advertisement$|^Continue\b|^Duration:/i;
    let parts: string[] = [];
    body.find("p, h2, h3").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t && !NOISE.test(t)) parts.push(t);
    });
    // Drop The Motley Fool's framing (Image source / DATE / AI-written
    // TAKEAWAYS / RISKS / SUMMARY) that precedes the call. Anchor on the first
    // real speaker turn ("Operator:" / "Jane Doe: <40+ chars>") so management's
    // prepared remarks are kept (formats vary — Apple omits the operator open).
    const speaker = /^(operator|[A-Z][\w.'’-]*(?: [A-Z][\w.'’-]*){0,3}):\s+\S.{50,}/;
    const start = parts.findIndex((p) => speaker.test(p));
    if (start > 0 && start < parts.length - 8) parts = parts.slice(start);
    let text = parts.join("\n\n");
    // Cut the trailing promo / disclosure boilerplate.
    const cut = text.search(
      /This article is a transcript|This article represents the opinion|Motley Fool has positions|Should you invest \$|stocks we like better than|Stock Advisor|premium investing service|has a disclosure policy/i,
    );
    if (cut > 2000) text = text.slice(0, cut).trim();
    if (text.length < 600) return null;
    const title = ($('meta[property="og:title"]').attr("content") || "").replace(/\s*\|\s*The Motley Fool.*$/i, "").trim();
    return { title: title || `${symbol} earnings call transcript`, date: c.date || null, source: "The Motley Fool", url: c.url, text };
  } catch {
    return null;
  }
}
