import * as cheerio from "cheerio";

export interface TranscriptLink {
  title: string;
  publisher: string;
  link: string; // Google News redirect → opens the publisher's transcript
  time: string | null;
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
