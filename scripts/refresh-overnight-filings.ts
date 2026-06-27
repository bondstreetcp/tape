/**
 * Overnight Filings (SuperAnalyst) — build data/overnight-filings.json.
 *
 * Scans the watch-set (S&P 500 ∪ Nasdaq 100 ∪ Russell 1000; SCAN_BROAD=1 adds the
 * Russell 3000 + Broad 1500) for NEW material SEC filings accepted within the last
 * WINDOW_HOURS (default 36) and, for each, asks an LLM to write a desk note on what
 * MATERIALLY changed vs the PRIOR comparable filing of the same type.
 *
 *   npm run refresh-overnight-filings
 *
 * Material set: 10-K, 10-Q, and material 8-Ks (items 1.01 entry into a material
 * agreement, 2.02 results, 4.01 auditor change, 4.02 non-reliance/restatement,
 * 5.02 officer/director changes, 8.01 other events). The NEW + the comparable
 * filing's text (+ a multi-year financial snapshot, + the free risk-factor redline
 * counts for 10-K/Q) are fed to the model; routine/administrative filings are
 * gated out when the model returns headline "NONE".
 *
 * Needs OPENROUTER_API_KEY (CI secret, or .env.local for local runs). EDGAR asks
 * for a descriptive User-Agent and <10 req/s — we reuse lib/edgar's HEADERS + pool.
 *
 * Testing knobs (frugal with LLM credits):
 *   WINDOW_HOURS=336  widen the detection window to 14 days
 *   TEST_SYMBOLS="AAPL MSFT …"  restrict the watch-set to a handful of names
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { tickerToCik, getSubmissions, getFilingText, HEADERS, pool } from "../lib/edgar";
import { getFilingDoc } from "../lib/filingDoc";
import { findPriorComparable, getRedline } from "../lib/redline";
import { financialSnapshot } from "../lib/ask";
import { chatJSON } from "../lib/llm";

const DATA = path.join(process.cwd(), "data");
const WINDOW_HOURS = process.env.WINDOW_HOURS ? Number(process.env.WINDOW_HOURS) : 36;
const SCAN_BROAD = process.env.SCAN_BROAD === "1";
const TEST_SYMBOLS = (process.env.TEST_SYMBOLS || "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 8-K items we treat as material (entry into agreement, results, auditor change,
// non-reliance/restatement, officer/director changes, other material events).
const MATERIAL_8K_ITEMS = ["1.01", "2.02", "4.01", "4.02", "5.02", "8.01"];
const TRACKED_FORMS = new Set(["8-K", "10-Q", "10-K"]);

const SYSTEM =
  "You are an equity analyst writing the overnight desk note on a new SEC filing. You are given the NEW filing and the PRIOR comparable filing of the same type, plus a multi-year financial snapshot. Identify ONLY what materially changed vs the prior comparable: guidance, segment revenue/margin, new or dropped risk factors, buybacks/dividends, M&A, management changes, accounting/restatements. Ground every claim in the supplied text — never invent a number. Ignore boilerplate and unchanged repeated language. If nothing material changed (a routine committee appointment, an annual-meeting date, an administrative exhibit), set headline to exactly 'NONE' and leave whatChanged empty. Return ONLY JSON.";

const SCHEMA_HINT =
  'Return ONLY a JSON object with this exact shape: {"headline": string (<=12 words, or exactly "NONE"), "whatChanged": string[] (3-5 concise items; empty if NONE), "decisionTakeaway": string (one decision-relevant sentence), "sentiment": "bullish"|"neutral"|"bearish", "surprise": "beat"|"inline"|"miss"|"na", "keyMetrics": object (a few labelled figures grounded in the filing, e.g. {"revenue":"$1.2B (+8% YoY)","EPS":"$2.10 vs $1.95 est"})}';

interface Digest {
  headline: string;
  whatChanged: string[];
  decisionTakeaway: string;
  sentiment: "bullish" | "neutral" | "bearish";
  surprise: "beat" | "inline" | "miss" | "na";
  keyMetrics: Record<string, unknown>;
}

interface OvernightItem extends Digest {
  ticker: string;
  name: string;
  form: string;
  filedAt: string; // acceptanceDateTime (ET)
  riskFactorsAdded: number | null;
  riskFactorsRemoved: number | null;
  accession: string;
  url: string;
}

interface NewFiling {
  symbol: string;
  name: string;
  cik: string;
  form: string;
  formClean: "8-K" | "10-Q" | "10-K"; // form with /A stripped, for comparable matching
  newIdx: number;
  acceptance: string;
  filingDate: string;
  items: string;
  accession: string;
  primaryDoc: string;
  recent: any;
}

/** Build the de-duped watch-set: symbol → display name, across the US universes. */
async function buildWatchSet(): Promise<Map<string, string>> {
  const ids = ["sp500", "nasdaq100", "russell1000", ...(SCAN_BROAD ? ["russell3000", "sp1500"] : [])];
  const map = new Map<string, string>();
  for (const id of ids) {
    const snap = await loadSnapshot(id).catch(() => null);
    if (!snap?.stocks?.length) continue;
    for (const s of snap.stocks) if (!map.has(s.symbol)) map.set(s.symbol, s.name);
  }
  return map;
}

/** The EDGAR human-readable filing-index page for an accession. */
function indexUrl(cik: string, accession: string): string {
  const accNo = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accNo}/${accession}-index.htm`;
}

function isMaterial(form: string, items: string): boolean {
  if (form === "10-Q" || form === "10-K" || form === "10-Q/A" || form === "10-K/A") return true;
  if (form === "8-K" || form === "8-K/A") {
    const parts = (items || "").split(/[,;]/).map((s) => s.trim());
    return parts.some((p) => MATERIAL_8K_ITEMS.some((it) => p === it || p.startsWith(it)));
  }
  return false;
}

/** Detect new material filings for one symbol within the window. */
async function detectForSymbol(symbol: string, name: string, windowStart: number): Promise<NewFiling[]> {
  const cik = await tickerToCik(symbol);
  if (!cik) return []; // non-US filer / no EDGAR CIK → skip
  let sub: any;
  try {
    sub = await getSubmissions(cik);
  } catch {
    return [];
  }
  const r = sub?.filings?.recent;
  if (!r?.form) return [];
  const out: NewFiling[] = [];
  // recent arrays are newest-first; early-exit once we pass the window start.
  for (let i = 0; i < r.form.length; i++) {
    const accept = r.acceptanceDateTime?.[i] || `${r.filingDate?.[i] || ""}T00:00:00`;
    const acceptMs = Date.parse(accept);
    if (Number.isFinite(acceptMs) && acceptMs < windowStart) break; // older than the window → done
    const form = r.form[i];
    if (!TRACKED_FORMS.has(form.replace("/A", ""))) continue;
    const items = r.items?.[i] || "";
    if (!isMaterial(form, items)) continue;
    out.push({
      symbol,
      name,
      cik,
      form,
      formClean: form.replace("/A", "") as "8-K" | "10-Q" | "10-K",
      newIdx: i,
      acceptance: accept,
      filingDate: r.filingDate[i],
      items,
      accession: r.accessionNumber[i],
      primaryDoc: r.primaryDocument[i],
      recent: r,
    });
  }
  return out;
}

/** Fetch a filing's readable text by accession. 10-K/Q use the deep doc; 8-K the exhibit/release. */
async function filingTextByAccession(symbol: string, f: { form: string; accession: string }): Promise<string> {
  if (f.form === "10-K" || f.form === "10-Q") {
    const doc = await getFilingDoc(symbol, f.form as "10-K" | "10-Q").catch(() => null);
    if (doc?.text) return doc.text;
  }
  const t = await getFilingText(symbol, f.accession).catch(() => null);
  return t?.text || "";
}

async function summarize(nf: NewFiling): Promise<OvernightItem | null> {
  // Find the prior comparable: 10-K→prior 10-K, 10-Q→prior 10-Q, earnings-8-K→prior earnings-8-K.
  const earningsOnly = nf.formClean === "8-K" && /(^|,)\s*2\.02/.test(nf.items);
  const priorIdx = findPriorComparable(nf.recent, nf.newIdx, nf.formClean, earningsOnly);
  const priorForm = priorIdx >= 0 ? nf.recent.form[priorIdx] : "";
  const priorAcc = priorIdx >= 0 ? nf.recent.accessionNumber[priorIdx] : "";
  const priorDate = priorIdx >= 0 ? nf.recent.filingDate[priorIdx] : "";

  // NEW text + comparable text + financial snapshot, in parallel.
  const newCap = nf.formClean === "8-K" ? 80_000 : 180_000;
  const [newText, priorTextRaw, snapshot] = await Promise.all([
    filingTextByAccession(nf.symbol, { form: nf.formClean, accession: nf.accession }),
    priorIdx >= 0
      ? filingTextByAccession(nf.symbol, { form: priorForm.replace("/A", ""), accession: priorAcc })
      : Promise.resolve(""),
    financialSnapshot(nf.symbol).catch(() => ""),
  ]);
  if (!newText || newText.length < 400) return null; // couldn't read the filing → skip

  // Free risk-factor redline counts (10-K/Q only) from the existing differ.
  let rfAdded: number | null = null;
  let rfRemoved: number | null = null;
  if (nf.formClean === "10-K" || nf.formClean === "10-Q") {
    const rl = await getRedline(nf.symbol, nf.formClean).catch(() => null);
    if (rl?.available) {
      rfAdded = rl.added;
      rfRemoved = rl.removed;
    }
  }

  const newClip = newText.slice(0, newCap);
  const priorClip = (priorTextRaw || "").slice(0, newCap);
  const rfLine =
    rfAdded != null || rfRemoved != null
      ? `\n\nRISK-FACTOR REDLINE (vs prior, machine-diffed): ${rfAdded ?? 0} risk-factor sentences added, ${rfRemoved ?? 0} removed.`
      : "";
  const priorBlock = priorClip
    ? `\n\n=== PRIOR COMPARABLE ${priorForm} (filed ${priorDate}) ===\n${priorClip}`
    : "\n\n=== PRIOR COMPARABLE ===\n(none on file — assess the NEW filing on its own and call out anything materially new.)";

  const user =
    `${SCHEMA_HINT}\n\n` +
    `Company: ${nf.name} (${nf.symbol}). NEW filing: ${nf.form}${nf.items ? ` · items ${nf.items}` : ""} · accepted ${nf.acceptance}.\n` +
    `\n=== MULTI-YEAR FINANCIAL SNAPSHOT ===\n${snapshot || "(unavailable)"}\n` +
    `\n=== NEW FILING ${nf.form} ===\n${newClip}` +
    priorBlock +
    rfLine;

  const digest = await chatJSON<Digest>(SYSTEM, user, { maxTokens: 900 });
  if (!digest || typeof digest.headline !== "string") return null;
  const headline = digest.headline.trim();
  if (!headline || /^none$/i.test(headline)) return null; // NONE-gate

  return {
    ticker: nf.symbol,
    name: nf.name,
    form: nf.form,
    filedAt: nf.acceptance,
    headline,
    whatChanged: Array.isArray(digest.whatChanged) ? digest.whatChanged.filter((x) => typeof x === "string" && x.trim()).slice(0, 5) : [],
    decisionTakeaway: typeof digest.decisionTakeaway === "string" ? digest.decisionTakeaway.trim() : "",
    sentiment: ["bullish", "neutral", "bearish"].includes(digest.sentiment) ? digest.sentiment : "neutral",
    surprise: ["beat", "inline", "miss", "na"].includes(digest.surprise) ? digest.surprise : "na",
    keyMetrics: digest.keyMetrics && typeof digest.keyMetrics === "object" ? digest.keyMetrics : {},
    riskFactorsAdded: rfAdded,
    riskFactorsRemoved: rfRemoved,
    accession: nf.accession,
    url: indexUrl(nf.cik, nf.accession),
  };
}

async function main() {
  const now = Date.now();
  const windowStart = now - WINDOW_HOURS * 3600 * 1000;
  const since = new Date(windowStart).toISOString();

  let watch = await buildWatchSet();
  if (TEST_SYMBOLS) {
    const want = new Set(TEST_SYMBOLS.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean));
    const restricted = new Map<string, string>();
    for (const sym of want) restricted.set(sym, watch.get(sym) || sym);
    watch = restricted;
  }
  console.log(`Watch-set: ${watch.size} symbols · window ${WINDOW_HOURS}h (since ${since})${SCAN_BROAD ? " · BROAD" : ""}${TEST_SYMBOLS ? " · TEST" : ""}`);

  // --- Detection (EDGAR-bound; ~4 concurrent + a polite delay) ---
  const symbols = [...watch.entries()];
  let scanned = 0;
  const detected: NewFiling[][] = await pool(symbols, 4, async ([sym, name]) => {
    const r = await detectForSymbol(sym, name, windowStart);
    if (++scanned % 100 === 0) console.log(`  …scanned ${scanned}/${symbols.length}`);
    await sleep(120); // stay well under EDGAR's 10 req/s
    return r;
  });
  const newFilings = detected.flat();
  console.log(`Detected ${newFilings.length} new material filings across ${watch.size} symbols.`);

  // --- Summarize each new filing via the LLM (sequential — frugal + polite) ---
  const items: OvernightItem[] = [];
  let gatedNone = 0;
  for (let i = 0; i < newFilings.length; i++) {
    const nf = newFilings[i];
    try {
      const item = await summarize(nf);
      if (item) {
        items.push(item);
        console.log(`  [${i + 1}/${newFilings.length}] ${nf.symbol} ${nf.form}: ${item.headline}`);
      } else {
        gatedNone++;
        console.log(`  [${i + 1}/${newFilings.length}] ${nf.symbol} ${nf.form}: NONE / unreadable`);
      }
    } catch (e: any) {
      console.log(`  [${i + 1}/${newFilings.length}] ${nf.symbol} ${nf.form}: error ${e?.message || e}`);
    }
    await sleep(150);
  }

  items.sort((a, b) => Date.parse(b.filedAt) - Date.parse(a.filedAt)); // newest-first

  const out = {
    generatedAt: new Date().toISOString(),
    windowHours: WINDOW_HOURS,
    since,
    count: items.length,
    items,
  };
  await fs.writeFile(path.join(DATA, "overnight-filings.json"), JSON.stringify(out));
  console.log(`\nWrote ${items.length} digests (${gatedNone} gated to NONE/unreadable) → data/overnight-filings.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
