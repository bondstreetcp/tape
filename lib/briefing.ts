import pdfParse from "pdf-parse/lib/pdf-parse.js";

/**
 * Daily briefing from Reuters/LSEG's "Morning News Call" (US) and "The Day Ahead"
 * (North America) PDFs. Fetched and parsed on demand (server-side only) and served
 * behind a password gate — the full text is copyrighted, so it is never persisted
 * to this (public) repo. See app/api/briefing/route.ts for the gate.
 */

export interface BriefBlock { headline?: string; text: string }
export interface BriefSection { heading: string; kind: "prose" | "list"; blocks?: BriefBlock[]; lines?: string[] }
export interface Briefing {
  id: string;
  title: string;
  edition: string;
  date: string | null;
  sections: BriefSection[];
  sourceUrl: string;
  chars: number;
}

const SOURCES = [
  { id: "mnc", title: "Morning News Call", edition: "U.S. Edition · Reuters", url: "https://share.refinitiv.com/assets/newsletters/Morning_News_Call/MNC_US.pdf" },
  { id: "tda", title: "The Day Ahead", edition: "North America · Reuters", url: "https://share.refinitiv.com/assets/newsletters/The_Day_Ahead/TDA_NAM.pdf" },
];

// Section headers we recognise (others fall back to the generic all-caps test).
const HEADERS = new Set([
  "TOP NEWS", "BEFORE THE BELL", "STOCKS TO WATCH", "ANALYSIS", "ANALYSTS' RECOMMENDATION",
  "ANALYSTS' RECOMMENDATIONS", "EX-DIVIDENDS", "PICTURE OF THE DAY", "COMING UP", "CANADA",
  "GAINERS", "LOSERS", "ECONOMIC EVENTS", "KEY ECONOMIC EVENTS", "MARKET MONITOR", "INSIGHT",
  "WALL STREET", "IPO", "WEALTH",
]);
// Sections that are tabular/list-like — keep their lines as-is rather than reflowing prose.
const LIST_SECTIONS = new Set([
  "EX-DIVIDENDS", "COMING UP", "CANADA", "GAINERS", "LOSERS", "ECONOMIC EVENTS",
  "KEY ECONOMIC EVENTS", "MARKET MONITOR", "ANALYSTS' RECOMMENDATION", "ANALYSTS' RECOMMENDATIONS",
]);

const NOISE = [
  /^powered by reuters$/i, /^morning news call$/i, /^the day ahead$/i, /^©/, /thomson reuters/i,
  /all rights reserved/i, /^https?:\/\//i, /^\d{1,3}$/, /^click here/i, /reuters\.com/i,
  /^for .{0,40}\bclick\b/i, /^to .{0,40}\bunsubscribe\b/i, /^\(.*Reuters.*\)$/i,
];

const DATE_RE = /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/;

function isHeader(l: string): boolean {
  const u = l.toUpperCase();
  if (HEADERS.has(u)) return true;
  // generic: all-caps, 6–40 chars, no digits, ≤5 words (avoids 3-letter tickers and mixed-case names)
  return l === u && /^[A-Z][A-Z &'’.\/()-]{5,40}$/.test(l) && l.split(" ").length <= 5 && !/\d/.test(l);
}

// Group a run of lines into headline + paragraph blocks (a line that follows a
// completed sentence and isn't one itself reads as a new headline).
function groupProse(lines: string[], dropHeaders: boolean): BriefBlock[] {
  const blocks: BriefBlock[] = [];
  let prevEnded = true;
  for (const l of lines) {
    if (dropHeaders && isHeader(l)) { prevEnded = true; continue; }
    const endsSentence = /[.?!:”"']$/.test(l);
    const looksHeadline = prevEnded && !endsSentence && l.length <= 160;
    if (looksHeadline || blocks.length === 0) blocks.push({ headline: l, text: "" });
    else {
      const b = blocks[blocks.length - 1];
      b.text = b.text ? `${b.text} ${l}` : l;
    }
    prevEnded = endsSentence;
  }
  return blocks.filter((b) => b.headline || b.text);
}

function parse(text: string): { date: string | null; sections: BriefSection[] } {
  const rawLines = text.split("\n").map((l) => l.replace(/ /g, " ").trim());
  let date: string | null = null;
  for (const l of rawLines) {
    const m = l.match(DATE_RE);
    if (m) { date = m[1].replace(/\s+/g, " "); break; }
  }
  const lines = rawLines.filter((l) => l && !NOISE.some((re) => re.test(l)));

  const sections: BriefSection[] = [];
  let cur: BriefSection | null = null;
  let prevEnded = true;
  for (const l of lines) {
    if (isHeader(l)) {
      const heading = l.replace(/\s+/g, " ");
      const kind: "prose" | "list" = LIST_SECTIONS.has(heading.toUpperCase()) ? "list" : "prose";
      cur = kind === "list" ? { heading, kind, lines: [] } : { heading, kind, blocks: [] };
      sections.push(cur);
      prevEnded = true;
      continue;
    }
    if (!cur) continue; // skip preamble before the first section (masthead/date)
    if (cur.kind === "list") { cur.lines!.push(l); continue; }

    const endsSentence = /[.?!:”"']$/.test(l);
    const looksHeadline = prevEnded && !endsSentence && l.length <= 160;
    if (looksHeadline || cur.blocks!.length === 0) {
      cur.blocks!.push({ headline: l, text: "" });
    } else {
      const b = cur.blocks![cur.blocks!.length - 1];
      b.text = b.text ? `${b.text} ${l}` : l;
    }
    prevEnded = endsSentence;
  }

  const cleaned = sections.filter((s) => (s.kind === "list" ? s.lines!.length : s.blocks!.length));
  // Multi-column PDFs (e.g. The Day Ahead) don't linearise into clean sections —
  // a runaway "list" section means the columns ran together and headings no longer
  // mark real breaks. Reflow the whole body into readable story blocks instead of
  // mislabelling it (still the full text, just not falsely sectioned).
  if (cleaned.some((s) => s.kind === "list" && s.lines!.length > 50)) {
    const blocks = groupProse(lines, true);
    if (blocks.length) return { date, sections: [{ heading: "Briefing", kind: "prose", blocks }] };
  }
  return { date, sections: cleaned };
}

async function fetchOne(src: (typeof SOURCES)[number]): Promise<Briefing | null> {
  try {
    const res = await fetch(src.url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    const { date, sections } = parse(data.text);
    if (!sections.length) return null;
    return { id: src.id, title: src.title, edition: src.edition, date, sections, sourceUrl: src.url, chars: data.text.length };
  } catch {
    return null;
  }
}

// In-process cache. Each fetch always pulls whatever PDF is live at the URL, so
// the briefing is never older than the cache window — The Day Ahead publishes at
// ~4pm ET and Morning News Call pre-market, so a 30-min window picks up the new
// edition promptly without re-parsing ~2 MB on every page load.
let cache: { at: number; data: Briefing[] } | null = null;
const TTL = 30 * 60 * 1000;

export async function getBriefings(): Promise<Briefing[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  const data = (await Promise.all(SOURCES.map(fetchOne))).filter((b): b is Briefing => !!b);
  if (data.length) cache = { at: Date.now(), data };
  return cache?.data ?? data;
}
