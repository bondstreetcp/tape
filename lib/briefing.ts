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

// The Day Ahead (narrow multi-column) glues each bold headline onto its story body in the
// linearised text, and pdf-parse drops the bold cue. But the body reliably re-states the
// headline's subject — "AbbVie sharpens…" → "AbbVie said…", "SpaceX turns…" → "Elon Musk's
// SpaceX turned…" — so we split each story on that subject echo.
const STOP_SUBJ = new Set(["The", "A", "An", "US", "In", "On", "For", "With", "As", "At", "To", "It", "Its", "This", "These", "Also"]);
function subjectWord(s: string): string {
  for (const m of s.matchAll(/[“"']?([A-Z][A-Za-z.&'’-]{2,})/g)) {
    const w = m[1].replace(/[.,'’]+$/, "");
    if (!STOP_SUBJ.has(w)) return w;
  }
  return "";
}
// Stricter than ENDS_SENTENCE: a trailing "U.S.", "Inc.", an initial or a decimal isn't a
// sentence end (those were breaking paragraphs mid-clause, e.g. "…the 250th anniversary of U.S.").
function endsSentenceStrict(l: string): boolean {
  if (!/[.?!][”"']?$/.test(l)) return false;
  if (/[.?!][”"']$/.test(l)) return true; // closing quote after terminal punctuation
  if (/\b[A-Z]\.$/.test(l)) return false; // U.S. / U.K. / initials
  if (/\b(?:Inc|Corp|Co|Ltd|Jr|Sr|Dr|Mr|Mrs|Ms|vs|etc|No|St|Ave|Cos|Bros|Rep|Sen|Gov|Gen|Sept|Oct|Nov|Dec|Jan|Feb)\.$/.test(l)) return false;
  if (/\d\.$/.test(l)) return false; // decimal
  return /[.?!]$/.test(l);
}
const wordsOf = (s: string) => s.split(/[^A-Za-z0-9]+/).filter(Boolean);
function echoIndex(lines: string[], subj: string, from: number, to: number): number {
  for (let j = from; j <= to && j < lines.length; j++) if (wordsOf(lines[j]).includes(subj)) return j;
  return -1;
}

// Narrow-PDF prose → headline + body per story via the subject echo. Spliced price rows are
// dropped; with no story structure it falls back to a single reflowed block.
function groupProseNarrow(raw: string[]): BriefBlock[] {
  const lines = raw.filter((l) => !(NUM_ROW.test(l) || TRAILING_PRICES.test(l) || MONITOR_HDR.test(l)));
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const subj = subjectWord(lines[i]);
    if (subj.length < 3) continue;
    if (i > 0 && !endsSentenceStrict(lines[i - 1])) continue; // a headline follows a finished sentence
    if (endsSentenceStrict(lines[i])) continue; // …and a headline line itself has no terminal period
    if (echoIndex(lines, subj, i + 1, i + 4) >= 0) starts.push(i);
  }
  const blocks: BriefBlock[] = [];
  const push = (t: string, headline?: string) => { const x = t.replace(/\s+/g, " ").trim(); if (x || headline) blocks.push(headline ? { headline, text: x } : { text: x }); };
  if (!starts.length) { push(lines.join(" ")); return blocks.filter((b) => b.text); }
  if (starts[0] > 0) push(lines.slice(0, starts[0]).join(" ")); // any lead-in before the first headline
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k], end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    const subj = subjectWord(lines[s]);
    let e = echoIndex(lines, subj, s + 1, end - 1);
    if (e < 0) e = end;
    if (e < end) push(lines.slice(e, end).join(" "), lines.slice(s, e).join(" ").replace(/\s+/g, " ").trim());
    else push(lines.slice(s, end).join(" "));
  }
  return blocks;
}

// Group a section's lines into headline + paragraph blocks. PDF text arrives as
// hard-wrapped physical lines, so the bold "headline" must come from real structure
// (a bullet entry, or a short standalone title line) — never from a paragraph's first
// wrapped line, which lacks end punctuation only because it wrapped mid-sentence.
function groupSection(lines: string[], wrapWidth: number, narrow: boolean): BriefBlock[] {
  const bullets = lines.filter((l) => /^[•▪·‣]/.test(l)).length;
  return bullets >= 2 ? groupBulleted(lines) : narrow ? groupProseNarrow(lines) : groupProse(lines, wrapWidth, narrow);
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

// A line that reads as data (a price/number row, a trailing price/time, a column header)
// rather than prose. Used to tell a genuine tabular section (GAINERS, ECONOMIC EVENTS) from
// spliced narrow-column prose that merely got tagged with a "list" heading (The Day Ahead's
// "Coming Up", which is paragraphs and must be reflowed, not printed line-by-line).
const TAB_LINE = (l: string) =>
  NUM_ROW.test(l) || TRAILING_PRICES.test(l) || MONITOR_HDR.test(l) ||
  /\s[-+$]?\d[\d,]*\.?\d*%?$/.test(l) || /\b\d{3,4}\b/.test(l);
function looksTabular(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines.filter(TAB_LINE).length / lines.length >= 0.4;
}

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
    .map((s) => {
      // Narrow multi-column PDFs (The Day Ahead) splice prose into short fragments, so a
      // "list" heading doesn't mean tabular — decide by the actual content (Coming Up is
      // prose; Gainers/Economic Events are real tables). Wide PDFs (Morning News Call) keep
      // the heading-based split.
      const isList = narrow ? looksTabular(s.lines) : s.kind === "list";
      return isList
        ? { heading: s.heading, kind: "list" as const, lines: s.lines }
        : { heading: s.heading, kind: "prose" as const, blocks: groupSection(s.lines, wrapWidth, narrow) };
    })
    .filter((s) => (s.kind === "list" ? s.lines!.length : s.blocks!.length));

  // Multi-column PDFs (e.g. The Day Ahead) don't linearise into clean sections — a
  // runaway "list" section means the columns ran together and headings no longer mark
  // real breaks. Reflow the whole body into readable story blocks instead.
  if (sections.length <= 2 && sections.some((s) => s.kind === "list" && s.lines!.length > 60)) {
    const body = lines.filter((l) => !isHeader(l));
    const blocks = narrow ? groupProseNarrow(body) : groupProse(body, wrapWidth, narrow);
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

// ---- Per-ticker briefing stories (for the stock page news section) -------------------------
// The briefing is fetched live and never persisted (the text is Reuters/LSEG-copyrighted), so
// this just filters the in-memory parse for stories whose HEADLINE names the company. Matching
// on the headline (not the body) keeps it to stories *about* the name, not competitor mentions.

export interface BriefingStory { source: string; cadence: string; date: string | null; headline: string; snippet: string }

const NAME_SUFFIX = /\b(?:inc|incorporated|corp|corporation|co|company|companies|ltd|plc|llc|lp|nv|sa|ag|group|holdings?|the|class\s+[a-c]|cl\s+[a-c]|international|intl|technologies|technology|systems|solutions|enterprises|industries|& ?co|& ?company|com|plc\.)\b/gi;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Distinctive name tokens to match a story headline against this company.
function brandTokens(name: string): string[] {
  const n = name.replace(/[.,]/g, " ").replace(NAME_SUFFIX, " ").replace(/\s+/g, " ").trim();
  const words = n.split(" ").filter(Boolean);
  const toks: string[] = [];
  if (words[0] && words[0].length >= 4) toks.push(words[0]); // brand: Apple, AbbVie, Micron, Amazon
  if (words.length >= 2 && words.slice(0, 2).join(" ").length >= 7) toks.push(words.slice(0, 2).join(" ")); // Berkshire Hathaway
  return [...new Set(toks)];
}

export async function briefingStoriesFor(name: string): Promise<BriefingStory[]> {
  const tokens = brandTokens(name || "");
  if (!tokens.length) return [];
  const regs = tokens.map((t) => new RegExp(`\\b${escapeRe(t)}\\b`, "i"));
  const briefings = await getBriefings();
  const out: BriefingStory[] = [];
  const seen = new Set<string>();
  for (const b of briefings) {
    for (const s of b.sections) {
      if (s.kind !== "prose" || !s.blocks) continue;
      for (const bl of s.blocks) {
        const hl = (bl.headline || "").trim();
        if (!hl || !regs.some((r) => r.test(hl))) continue;
        const key = hl.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const body = (bl.text || "").trim();
        out.push({ source: b.title, cadence: b.cadence, date: b.date, headline: hl, snippet: body.length > 240 ? body.slice(0, 240).trim() + "…" : body });
      }
    }
  }
  return out.slice(0, 8);
}
