/**
 * Year-over-year 10-K "redline" — diffs the Risk Factors (Item 1A) section of a
 * company's two most recent annual reports and highlights what management added,
 * removed, or reworded (AlphaSense-style).
 *
 * Isolating Item 1A from raw 10-K HTML is the hard part: tables of contents,
 * forward-looking-statement citations, and cross-references all repeat the
 * phrase. We keep only "Risk Factors" mentions that read like a section heading
 * (prose follows — not a page number or a citation paren/quote) and bound the
 * section at the last "Item 1B". It works for most large filers and degrades to
 * "open the filings directly" when it can't isolate the section confidently.
 */
import { tickerToCik } from "./edgar";

const HEADERS = { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" };
const MIN = 14000;
const MAX = 260000;
const CLEAN = /^[\s.]*(the\b|in\b|our\b|we\b|risks?\b|you\b|investors\b|because\b|certain\b|set forth|[A-Z][a-z]+\b)/;

export type RedlineBlock = { type: "add" | "del"; text: string } | { type: "gap"; count: number };

export interface Redline {
  available: boolean;
  section: string;
  fromDate: string | null;
  toDate: string | null;
  fromUrl: string | null;
  toUrl: string | null;
  added: number;
  removed: number;
  reworded: number;
  blocks: RedlineBlock[];
  note?: string;
}

function strip(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, d) => {
      try {
        return String.fromCodePoint(+d);
      } catch {
        return " ";
      }
    })
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRiskFactors(text: string, form = "10-K"): string {
  const isQ = form === "10-Q";
  const minLen = isQ ? 250 : MIN;
  // Section-end anchors: 10-K risk factors end at "Item 1B"; a 10-Q's (Part II,
  // Item 1A) end at the next Part II item (Item 2 unregistered sales / 5 / 6).
  const ends = (isQ
    ? [...text.matchAll(/item\s*2\b|unregistered sales of equity|item\s*5\b|item\s*6\b/gi)]
    : [...text.matchAll(/item\s*1b\b/gi)]
  ).map((m) => m.index!).sort((a, b) => a - b);
  if (!ends.length) return "";
  const last1b = ends[ends.length - 1];
  const cands: string[] = [];
  for (const m of text.matchAll(/risk factors/gi)) {
    const s = m.index!;
    const after = text.slice(s + 12, s + 44);
    if (/^[\s.,)("”'’]*\d/.test(after)) continue; // page number → table of contents
    if (/^[\s.,]*["”'’)(]/.test(after)) continue; // citation paren/quote
    if (!CLEAN.test(after)) continue; // must read like a heading flowing into prose
    const end = isQ ? ends.find((x) => x > s + minLen) : last1b;
    if (end == null || end <= s + minLen) continue;
    const seg = text.slice(s, end);
    if (seg.length >= minLen && seg.length <= MAX) cands.push(seg);
  }
  if (!cands.length) return "";
  return cands.sort((a, b) => a.length - b.length)[0]; // tightest sane section
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;:])\s+(?=[“"(]?[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
    .slice(0, 2600);
}

const normKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) || []);
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function diffSentences(aOrig: string[], bOrig: string[]): { blocks: RedlineBlock[]; added: number; removed: number; reworded: number } {
  // 1) LCS on a letters-only key (ignores punctuation/number/spacing noise).
  const a = aOrig.map(normKey), b = bOrig.map(normKey);
  const n = a.length, m = b.length;
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  type Op = { t: "same" | "add" | "del"; text: string; reworded?: boolean };
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: "same", text: "" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: "del", text: aOrig[i++] });
    else ops.push({ t: "add", text: bOrig[j++] });
  }
  while (i < n) ops.push({ t: "del", text: aOrig[i++] });
  while (j < m) ops.push({ t: "add", text: bOrig[j++] });

  // 2) An added sentence with a highly-similar removed one is a *rewrite*, not a
  //    new risk — pair them off so only genuinely new/dropped sentences remain.
  const adds = ops.filter((o) => o.t === "add");
  const dels = ops.filter((o) => o.t === "del").map((o) => ({ o, tok: tokens(o.text), used: false }));
  let reworded = 0;
  for (const add of adds) {
    const at = tokens(add.text);
    let best: (typeof dels)[number] | null = null;
    let bestScore = 0.5;
    for (const d of dels) {
      if (d.used) continue;
      const s = jaccard(at, d.tok);
      if (s > bestScore) { bestScore = s; best = d; }
    }
    if (best) { best.used = true; best.o.reworded = true; add.reworded = true; reworded++; }
  }

  // 3) Emit blocks in document order; same + reworded collapse into gaps.
  const blocks: RedlineBlock[] = [];
  let added = 0, removed = 0, gap = 0;
  const flush = () => { if (gap) { blocks.push({ type: "gap", count: gap }); gap = 0; } };
  for (const op of ops) {
    if (op.t === "same" || op.reworded) gap++;
    else if (op.t === "add") { flush(); blocks.push({ type: "add", text: op.text }); added++; }
    else { flush(); blocks.push({ type: "del", text: op.text }); removed++; }
  }
  flush();
  return { blocks, added, removed, reworded };
}

async function fetchSection(url: string, form: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return "";
    return extractRiskFactors(strip(await res.text()), form);
  } catch {
    return "";
  }
}

export async function getRedline(symbol: string, form: "10-K" | "10-Q" = "10-K"): Promise<Redline> {
  const base: Redline = {
    available: false, section: "Risk Factors", fromDate: null, toDate: null,
    fromUrl: null, toUrl: null, added: 0, removed: 0, reworded: 0, blocks: [],
  };
  const cik = await tickerToCik(symbol);
  if (!cik) return { ...base, note: "No SEC filings found for this ticker." };
  try {
    const sub: any = await (await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: HEADERS })).json();
    const r = sub.filings?.recent;
    const tens: { date: string; url: string }[] = [];
    for (let i = 0; i < (r?.form?.length || 0) && tens.length < 2; i++) {
      if (r.form[i] === form) {
        const acc = r.accessionNumber[i].replace(/-/g, "");
        tens.push({ date: r.filingDate[i], url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/${r.primaryDocument[i]}` });
      }
    }
    if (tens.length < 2)
      return { ...base, note: `Need two ${form === "10-Q" ? "quarterly reports (10-Q)" : "annual reports (10-K)"} on file to compare.` };
    const [newer, older] = tens;
    base.fromDate = older.date; base.toDate = newer.date; base.fromUrl = older.url; base.toUrl = newer.url;

    const [secNew, secOld] = await Promise.all([fetchSection(newer.url, form), fetchSection(older.url, form)]);
    if (!secNew || !secOld)
      return { ...base, note: "Couldn't reliably isolate the Risk Factors section in one of these filings — open them directly below to compare." };

    const { blocks, added, removed, reworded } = diffSentences(sentences(secOld), sentences(secNew));
    const capped = blocks.length > 600 ? blocks.slice(0, 600) : blocks;
    return {
      ...base, available: true, added, removed, reworded, blocks: capped,
      note: capped.length < blocks.length ? "Showing the first 600 changes." : undefined,
    };
  } catch (e: any) {
    return { ...base, note: "Couldn't load the filings from EDGAR." };
  }
}
