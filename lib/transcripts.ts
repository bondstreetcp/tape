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
      if (!link || !low.includes("transcript") || low.includes("highlights") || low.includes("takeaway")) return;
      out.push({ title, publisher: source || "News", link, time: pub ? new Date(pub).toISOString() : null });
    });
    // Rank: results that name the ticker first (avoids same-name companies like
    // "Apple Hospitality REIT" bleeding into AAPL), then known transcript sources.
    const score = (x: TranscriptLink) =>
      (tickerRe && tickerRe.test(x.title) ? -2 : 0) +
      (GOOD.some((g) => x.publisher.toLowerCase().includes(g)) ? -1 : 0);
    out.sort((a, b) => score(a) - score(b));
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
  const sym = symbol.toLowerCase();
  const key = nameKey(name || symbol);
  try {
    // The exchange is part of the quote-page path; try the major US exchanges.
    let paths: string[] = [];
    for (const ex of ["nasdaq", "nyse", "nysemkt"]) {
      const r = await fetch(`https://www.fool.com/quote/${ex}/${sym}/`, { headers: { "User-Agent": BROWSER_UA } });
      if (!r.ok) continue;
      const html = await r.text();
      paths = [...html.matchAll(/\/earnings\/call-transcripts\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+/g)].map((m) => m[0]);
      if (paths.length) break;
    }
    if (!paths.length) return null;

    const all = [...new Set(paths)].map((p) => {
      const slug = p.split("/").filter(Boolean).pop() || "";
      const dm = p.match(/call-transcripts\/(\d{4})\/(\d{2})\/(\d{2})\//);
      return { url: `https://www.fool.com${p}/`, date: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : "", slug };
    });
    // The quote page only lists this ticker, but prefer slugs that name it.
    let cands = all.filter((c) => c.slug.includes(sym) || (key && c.slug.includes(key)));
    if (!cands.length) cands = all;
    cands.sort((a, b) => b.date.localeCompare(a.date));

    const top = cands[0];
    const pres = await fetch(top.url, { headers: { "User-Agent": BROWSER_UA } });
    if (!pres.ok) return null;
    const $ = cheerio.load(await pres.text());
    const body = $(".article-body").first();
    if (!body.length) return null;

    const NOISE = /^Image source:|Need a quote from a Motley Fool analyst|^Advertisement$/i;
    const parts: string[] = [];
    body.find("p, h2, h3").each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t && !NOISE.test(t)) parts.push(t);
    });
    let text = parts.join("\n\n");
    // Drop the trailing legal/disclaimer boilerplate if it got captured.
    const cut = text.search(/This article is a transcript|This article represents the opinion|Motley Fool has positions/i);
    if (cut > 2000) text = text.slice(0, cut).trim();
    if (text.length < 600) return null;

    const title = ($('meta[property="og:title"]').attr("content") || "")
      .replace(/\s*\|\s*The Motley Fool.*$/i, "")
      .trim();
    return {
      title: title || `${symbol} earnings call transcript`,
      date: top.date || null,
      source: "The Motley Fool",
      url: top.url,
      text,
    };
  } catch {
    return null;
  }
}
