/**
 * MarketBeat earnings-call transcript source — the free full-text historical source for the archive backfill
 * (scripts/backfill-transcripts). Chosen after vetting 6 sources (2026-09): MarketBeat serves the complete
 * transcript (prepared remarks + Q&A) in plain server-rendered HTML — a plain HTTP GET, no headless browser —
 * with ~3 years of history and full S&P 500 breadth, and its llms.txt opts in to AI use of /earnings/ (with a
 * citation requirement, which we honour by storing the source URL on every CallRecord).
 *
 * Two steps: DISCOVER a ticker's report URLs from /stocks/<EXCH>/<TICKER>/earnings/ (each URL carries its date),
 * then FETCH + parse one /earnings/reports/<YYYY-M-D-slug>-stock/ page: the `.transcript-discussion` turns, the
 * "Q# YYYY Earnings Call Transcript" period, and the call date. Pure parsers are exported for tests; network
 * lives in the async functions only (the module doctrine from lib/transcriptSources).
 */
import * as cheerio from "cheerio";
import { deadline } from "./deadline";
import { BROWSER_UA as UA } from "./scriptKit";

const BASE = "https://www.marketbeat.com";
const HEADERS = { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" };
/** MarketBeat's US exchange path segments — we try these in order when the exchange isn't known. */
export const MB_EXCHANGES = ["NASDAQ", "NYSE", "NYSEAMERICAN"];

export interface MbReport { url: string; date: string; fiscalPeriod: string | null } // fiscalPeriod filled after fetch

async function getHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: deadline(20_000) });
    if (!res.ok) return null;
    const html = await res.text();
    return html.length > 5_000 ? html : null;
  } catch { return null; }
}

/** Report URLs + their dates on a ticker's earnings page. Pure. Newest first, deduped. */
export function parseMarketBeatReportList(html: string): { url: string; date: string }[] {
  const seen = new Set<string>();
  const out: { url: string; date: string }[] = [];
  for (const m of html.matchAll(/\/earnings\/reports\/(\d{4})-(\d{1,2})-(\d{1,2})-[a-z0-9-]+-stock\/?/g)) {
    const path = m[0].replace(/\/?$/, "/");
    if (seen.has(path)) continue;
    seen.add(path);
    const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    out.push({ url: `${BASE}${path}`, date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** The full transcript text + period from a report page. Pure. null when the page has no transcript (some
 *  report pages are results-only, no call). */
export function parseMarketBeatReport(html: string): { text: string; fiscalPeriod: string | null; title: string } | null {
  const $ = cheerio.load(html);
  const turns: string[] = [];
  const clean = (s: string) => s.replace(/\d{2}:\d{2}:\d{2}/g, " ").replace(/\s+/g, " ").trim();
  $(".transcript-discussion .transcript-line-left, .transcript-discussion .transcript-line-right").each((_, el) => {
    let speaker = clean($(el).find(".transcript-line-speaker").first().text());
    const half = speaker.slice(0, speaker.length >> 1).trim(); // MarketBeat repeats the name (name+role) — collapse "X X" → "X"
    if (half && speaker === `${half} ${half}`) speaker = half;
    let said = clean($(el).find(".transcript-arrow").first().text());
    if (speaker && said.startsWith(speaker)) said = said.slice(speaker.length).trim(); // the bubble self-labels the speaker; don't double it
    if (said) turns.push(speaker ? `${speaker}: ${said}` : said);
  });
  const text = turns.join("\n\n");
  if (text.length < 3000) return null; // not a real transcript (results-only page / stub)
  const pm = html.match(/(?:Fiscal\s+)?Q([1-4])\s+(\d{4})\s+Earnings Call Transcript/i);
  const fiscalPeriod = pm ? `${pm[2]}-Q${pm[1]}` : null;
  const title = ($("h1").first().text().replace(/\s+/g, " ").trim()) || "Earnings Call Transcript";
  return { text, fiscalPeriod, title };
}

/** Discover a ticker's transcript report URLs (newest first). Tries the given exchange, else the US boards. */
export async function discoverMarketBeatReports(ticker: string, exchange?: string | null): Promise<{ url: string; date: string }[]> {
  const sym = ticker.toUpperCase();
  const boards = exchange ? [exchange.toUpperCase(), ...MB_EXCHANGES.filter((e) => e !== exchange.toUpperCase())] : MB_EXCHANGES;
  for (const ex of boards) {
    const html = await getHtml(`${BASE}/stocks/${ex}/${sym}/earnings/`);
    if (!html) continue;
    const reports = parseMarketBeatReportList(html);
    if (reports.length) return reports;
  }
  return [];
}

export interface MbTranscript { text: string; chars: number; title: string; date: string; fiscalPeriod: string | null; url: string; source: "MarketBeat" }

/** Fetch + parse one report page into a transcript. null on miss / no-transcript page. */
export async function fetchMarketBeatTranscript(report: { url: string; date: string }): Promise<MbTranscript | null> {
  const html = await getHtml(report.url);
  if (!html) return null;
  const parsed = parseMarketBeatReport(html);
  if (!parsed) return null;
  return { text: parsed.text, chars: parsed.text.length, title: parsed.title, date: report.date, fiscalPeriod: parsed.fiscalPeriod, url: report.url, source: "MarketBeat" };
}
