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
  cadence: string;
  date: string | null;
  sections: BriefSection[];
  sourceUrl: string;
  chars: number;
}

const SOURCES = [
  { id: "mnc", title: "Morning News Call", edition: "U.S. Edition · Reuters", cadence: "Before the open · new each morning (~6–8am ET)", url: "https://share.refinitiv.com/assets/newsletters/Morning_News_Call/MNC_US.pdf" },
  { id: "tda", title: "The Day Ahead", edition: "North America · Reuters", cadence: "After the close · new each afternoon (~4pm ET)", url: "https://share.refinitiv.com/assets/newsletters/The_Day_Ahead/TDA_NAM.pdf" },
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
  /^powered by reuters$/i, /^morning news call/i, /^the day ahead/i, /^©/, /thomson reuters/i,
  /all rights reserved/i, /^https?:\/\//i, /^\d{1,3}$/, /^click here/i, /reuters\.com/i,
  /^for .{0,40}\bclick\b/i, /^to .{0,40}\bunsubscribe\b/i, /^\(.*Reuters.*\)$/i,
];

const DATE_RE = /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+[A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/;
// A line ends a sentence when it closes with terminal punctuation or a closing quote.
const ENDS_SENTENCE = /[.?!:”"']$/;

function isHeader(l: string): boolean {
  const u = l.toUpperCase();
  if (HEADERS.has(u)) return true;
  // generic: all-caps, 6–40 chars, no digits, ≤5 words (avoids 3-letter tickers and mixed-case names)
  return l === u && /^[A-Z][A-Z &'’.\/()-]{5,40}$/.test(l) && l.split(" ").length <= 5 && !/\d/.test(l);
}

// Group a section's lines into headline + paragraph blocks. PDF text arrives as
// hard-wrapped physical lines, so the bold "headline" must come from real structure
// (a bullet entry, or a short standalone title line) — never from a paragraph's first
// wrapped line, which lacks end punctuation only because it wrapped mid-sentence.
function groupSection(lines: string[], wrapWidth: number, narrow: boolean): BriefBlock[] {
  const bullets = lines.filter((l) => /^[•▪·‣]/.test(l)).length;
  return bullets >= 2 ? groupBulleted(lines) : groupProse(lines, wrapWidth, narrow);
}

// Bulleted sections (e.g. STOCKS TO WATCH "• Company: writeup"): one block per
// bullet, with the company/lead name (up to the first colon) as the bold headline
// and the whole reflowed writeup as the body.
function groupBulleted(lines: string[]): BriefBlock[] {
  const blocks: BriefBlock[] = [];
  let cur: string | null = null;
  const flush = () => {
    if (cur == null) return;
    const raw = cur.replace(/\s+/g, " ").trim();
    const m = raw.match(/^(.{2,60}?):\s+(.+)$/);
    // Only treat the pre-colon text as a name when it reads like one (short, no
    // sentence punctuation); otherwise keep the whole entry as plain body.
    if (m && m[1].split(" ").length <= 9 && !/[.?!]/.test(m[1])) blocks.push({ headline: m[1].trim(), text: m[2].trim() });
    else if (raw) blocks.push({ text: raw });
    cur = null;
  };
  for (const l of lines) {
    if (/^[•▪·‣]/.test(l)) { flush(); cur = l.replace(/^[•▪·‣]\s*/, ""); }
    else cur = cur != null ? `${cur} ${l}` : l;
  }
  flush();
  return blocks;
}

// The Day Ahead embeds a "Market Monitor" gainers/losers table whose rows get
// spliced into the news text by the multi-column linearisation. These detect those
// rows so we can drop them: a pure price line ("43.88 2.81 6.84"), a name with a
// trailing price/chng/%chng triple ("Atkinsrealis Group Inc 86.79 5.25 6.44"), or the
// "Price C$ chng % chng" column header.
const NUM_ROW = /^[-+$]?\d[\d,]*\.?\d*%?(?:\s+[-+$]?\d[\d,]*\.?\d*%?){1,6}$/;
const TRAILING_PRICES = /(?:\s[-+]?\d[\d,]*\.\d+){2,}\s*$/;
const MONITOR_HDR = /\bchng\b/i;
function isTableRow(l: string, lines: string[], i: number): boolean {
  if (NUM_ROW.test(l) || TRAILING_PRICES.test(l) || MONITOR_HDR.test(l)) return true;
  // A short, unpunctuated line sitting directly above a price row or the column
  // header is that row's label (the company/index name on its own line).
  const next = lines[i + 1];
  return !!next && l.length <= 45 && !ENDS_SENTENCE.test(l) && (NUM_ROW.test(next) || MONITOR_HDR.test(next));
}

// Prose sections (TOP NEWS, ANALYSIS, BEFORE THE BELL): titled stories become
// {headline, text}; plain market-color prose becomes text-only blocks (no bold).
function groupProse(lines: string[], wrapWidth: number, narrow: boolean): BriefBlock[] {
  const headlineMax = Math.max(60, wrapWidth - 18);
  const blocks: BriefBlock[] = [];
  let cur: BriefBlock | null = null;
  let paraOpen = false; // inside a paragraph that may still take more lines
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Drop spliced-in market-monitor table rows (narrow multi-column layout only) and
    // break the paragraph there, so the prose on either side of the table stays apart.
    if (narrow && isTableRow(l, lines, i)) { paraOpen = false; continue; }
    const endsSentence = ENDS_SENTENCE.test(l);
    const full = l.length > headlineMax; // line ran to the column edge → it wrapped
    // A headline is a short standalone line (it didn't fill the column, so it ended
    // because the title ended) sitting between finished paragraphs. The width test is
    // what stops a paragraph's wrapped first line — which also lacks end punctuation —
    // from being mistaken for a headline. In a narrow multi-column layout (The Day
    // Ahead) every line is short and fragmented, so that test can't work — we skip
    // headline detection entirely and just reflow into prose, letting the teaser read
    // as the lead of its paragraph rather than bolding mid-sentence fragments.
    if (!narrow && !paraOpen && !endsSentence && !full) {
      cur = { headline: l, text: "" };
      blocks.push(cur);
      paraOpen = true;
      continue;
    }
    if (!cur || !paraOpen) { cur = { text: l }; blocks.push(cur); }
    else cur.text = cur.text ? `${cur.text} ${l}` : l;
    paraOpen = full || !endsSentence; // closes on a short, sentence-final line
  }
  return blocks.filter((b) => b.headline || b.text);
}

function parse(text: string): { date: string | null; sections: BriefSection[] } {
  const rawLines = text.split("\n").map((l) => l.replace(/ /g, " ").trim());
  let date: string | null = null;
  for (const l of rawLines) {
    const m = l.match(DATE_RE);
    if (m) { date = m[1].replace(/\s+/g, " "); break; }
  }
  const lines = rawLines.filter((l) => l && !NOISE.some((re) => re.test(l)));
  const wrapWidth = lines.reduce((m, l) => Math.max(m, l.length), 80);
  // A small typical line length means a narrow multi-column PDF (The Day Ahead), whose
  // text can't be cleanly split into headline + body — flag it so prose stays unbolded.
  const lens = lines.map((l) => l.length).sort((a, b) => a - b);
  const narrow = lens.length > 0 && lens[lens.length >> 1] < 70;

  // Split into sections at header lines, collecting each section's raw lines.
  const raw: { heading: string; kind: "prose" | "list"; lines: string[] }[] = [];
  let cur: (typeof raw)[number] | null = null;
  for (const l of lines) {
    if (isHeader(l)) {
      const heading = l.replace(/\s+/g, " ");
      const kind: "prose" | "list" = LIST_SECTIONS.has(heading.toUpperCase()) ? "list" : "prose";
      cur = { heading, kind, lines: [] };
      raw.push(cur);
      continue;
    }
    if (cur) cur.lines.push(l); // skip preamble before the first section (masthead/date)
  }

  const sections: BriefSection[] = raw
    .filter((s) => s.lines.length)
    .map((s) =>
      s.kind === "list"
        ? { heading: s.heading, kind: "list" as const, lines: s.lines }
        : { heading: s.heading, kind: "prose" as const, blocks: groupSection(s.lines, wrapWidth, narrow) },
    )
    .filter((s) => (s.kind === "list" ? s.lines!.length : s.blocks!.length));

  // Multi-column PDFs (e.g. The Day Ahead) don't linearise into clean sections — a
  // runaway "list" section means the columns ran together and headings no longer mark
  // real breaks. Reflow the whole body into readable story blocks instead.
  if (sections.some((s) => s.kind === "list" && s.lines!.length > 50)) {
    const blocks = groupProse(lines.filter((l) => !isHeader(l)), wrapWidth, narrow);
    if (blocks.length) return { date, sections: [{ heading: "Briefing", kind: "prose", blocks }] };
  }
  return { date, sections };
}

async function fetchOne(src: (typeof SOURCES)[number]): Promise<Briefing | null> {
  try {
    const res = await fetch(src.url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const data = await pdfParse(buf);
    const { date, sections } = parse(data.text);
    if (!sections.length) return null;
    return { id: src.id, title: src.title, edition: src.edition, cadence: src.cadence, date, sections, sourceUrl: src.url, chars: data.text.length };
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
