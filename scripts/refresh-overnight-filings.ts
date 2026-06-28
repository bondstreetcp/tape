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
const scanErrors: string[] = []; // symbols whose EDGAR submissions fetch failed (after retries) → silently skipped
const TEST_SYMBOLS = (process.env.TEST_SYMBOLS || "").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 8-K items we treat as candidate-material. Cast a wide net here and let the LLM's
// NONE-gate trim the noise (routine annual-meeting votes, boilerplate exhibits) — a
// too-narrow item filter was silently dropping real events (M&A completions, control
// changes, agreement terminations, merger votes). Excluded by design: 7.01 (Reg FD —
// mostly investor-deck noise) and 9.01-only (exhibits with no standalone event).
//   1.01 entry / 1.02 termination of a material agreement
//   2.01 completed acquisition/disposition · 2.02 results · 2.03 new financial obligation
//   4.01 auditor change · 4.02 non-reliance/restatement
//   5.01 change in control · 5.02 officer/director changes · 5.07 submitted to a vote
//   8.01 other material events
const MATERIAL_8K_ITEMS = ["1.01", "1.02", "2.01", "2.02", "2.03", "4.01", "4.02", "5.01", "5.02", "5.07", "8.01"];

// Beyond 8-K/10-Q/10-K we track company-filed deal & capital-raise docs:
//   S-4 / 425 = M&A (merger registration / merger communications) · 424B = offering
//   prospectus (IPO/follow-on/debt raise). These are inherently material event filings —
//   no item gate, summarized standalone.
//   424B is restricted to 424B1 (IPO) and 424B4 (follow-on equity) only. ⚠ Big banks
//   (BAC/GS/MS/C/JPM…) file DOZENS of 424B2 AND 424B3 structured-note pricing supplements
//   daily off their MTN shelves (tiny auto-callable retail notes), and 424B5 is mostly
//   routine debt-shelf takedowns — all noise that floods the digest. Material debt/equity
//   raises still arrive as 8-Ks (item 1.01/2.03/8.01). (SC 13D/13G are filed BY the
//   investor, not the issuer, so they never appear in the issuer's feed — not covered.)
type TrackedForm = "8-K" | "10-Q" | "10-K" | "S-4" | "425" | "424B";
function trackedForm(form: string): TrackedForm | null {
  const f = form.replace("/A", "");
  if (f === "8-K" || f === "10-Q" || f === "10-K" || f === "S-4" || f === "425") return f;
  if (f === "424B1" || f === "424B4") return "424B"; // IPO / follow-on equity only; B2/B3/B5 are structured-note + MTN noise
  return null;
}

const SYSTEM =
  "You are an equity analyst writing the overnight desk note on a new SEC filing. You get TWO inputs: (1) the FILING text — your ONLY source for whatChanged, keyMetrics and every number you cite; and (2) a BACKGROUND market-data snapshot (Yahoo stats) for context and scale ONLY — never present its figures as disclosures from this filing. For an 8-K you may also get the prior comparable 8-K to diff against; a 10-Q/10-K carries its own prior-year/prior-period comparatives — use those. When no prior comparable is provided (a one-off 8-K, or an S-4/425/424B deal/offering), do NOT diff — summarize what the filing ANNOUNCES and why it matters on its own; absence of a baseline is never a reason to return 'NONE'. " +
  "Identify ONLY what materially changed or what the filing announces: revenue/margin/EPS vs the prior period, guidance, segment trends, new/dropped risk factors, buybacks/dividends, M&A (parties/price/structure), capital raises (size/coupon/use of proceeds), management changes, accounting/restatements. Ground every claim in the FILING text — never invent or infer a number that isn't stated there. Ignore boilerplate and unchanged repeated language. " +
  "FIELD RUBRICS — surprise: 'beat'/'miss' ONLY vs an analyst consensus/estimate explicitly stated in the filing (e.g. an EPS-surprise line), else 'na'; never infer beat/miss from a year-over-year change. sentiment: the filing's effect on the forward outlook / intrinsic value (bullish/neutral/bearish) — judge substance, not tone. decisionTakeaway: one falsifiable sentence on what changed and why it matters; never a buy/sell/hold call. impact (how market-moving for THIS stock): 'high' requires BOTH a high-impact event type (guidance change, M&A, a surprise/forced CEO-CFO-auditor exit, a restatement that changes reported earnings, a major contract/litigation/regulatory outcome, or a buyback/raise/charge large relative to the company — use the background snapshot for scale, roughly >=5% of market cap) AND material magnitude; a high-impact type at immaterial scale (a small shelf on a mega-cap, a planned retirement, an in-line quarter) is 'medium'; routine/administrative is 'low'. Be selective — most filings are low or medium; when between tiers, choose the lower. " +
  "NONE-GATE (distinct from low impact): return headline exactly 'NONE' with empty whatChanged ONLY for a genuinely empty/administrative filing — a routine committee appointment, an annual-meeting date/result, an administrative exhibit. A real-but-minor disclosure (a small contract, a minor officer change, an in-line quarter, a priced offering, a deal with terms) is NOT 'NONE' — keep it and rate impact 'low' or 'medium'. Return ONLY JSON.";

const SCHEMA_HINT =
  'Return ONLY a JSON object with this exact shape: {"headline": string (<=12 words, or exactly "NONE"), "whatChanged": string[] (3-5 concise items grounded in the filing; empty if NONE), "decisionTakeaway": string (one decision-relevant sentence, no buy/sell/hold), "sentiment": "bullish"|"neutral"|"bearish", "surprise": "beat"|"inline"|"miss"|"na", "impact": "high"|"medium"|"low", "keyMetrics": object — only figures EXPLICITLY stated in THIS filing, each with its unit and the filing\'s own comparison (YoY/QoQ/vs guidance/vs consensus); never pull from the background snapshot and never compute a figure; use {} when the filing states no clean figures (common for 8.01 / S-4 / 425). Examples — earnings: {"revenue":"$1.2B (+8% YoY)","EPS":"$2.10 vs $1.95 cons"}; non-earnings with no clean figure: {}}';

interface Digest {
  headline: string;
  whatChanged: string[];
  decisionTakeaway: string;
  sentiment: "bullish" | "neutral" | "bearish";
  surprise: "beat" | "inline" | "miss" | "na";
  impact: "high" | "medium" | "low";
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
  formClean: TrackedForm; // form normalized (amendments stripped, 424B* collapsed)
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
  } catch (e: any) {
    scanErrors.push(`${symbol}: ${e?.message || e}`); // surfaced after the scan — a swallowed error here drops the symbol
    return [];
  }
  const r = sub?.filings?.recent;
  if (!r?.form) return [];
  const out: NewFiling[] = [];
  // One M&A deal or shelf program spawns MANY near-identical 425/S-4/424B filings (e.g. a
  // merger files a 425 for every press release) — keep only the newest of each per issuer so
  // a single deal is one card, not a wall of duplicates.
  const seenDeal = new Set<string>();
  // recent arrays are newest-first; early-exit once we pass the window start.
  for (let i = 0; i < r.form.length; i++) {
    const accept = r.acceptanceDateTime?.[i] || `${r.filingDate?.[i] || ""}T00:00:00`;
    const acceptMs = Date.parse(accept);
    if (Number.isFinite(acceptMs) && acceptMs < windowStart) break; // older than the window → done
    const form = r.form[i];
    const kind = trackedForm(form);
    if (!kind) continue;
    const items = r.items?.[i] || "";
    if (kind === "8-K") {
      if (!isMaterial(form, items)) continue; // 8-Ks gated by item
    } else if (kind === "S-4" || kind === "425" || kind === "424B") {
      if (seenDeal.has(kind)) continue; // already kept the newest of this deal/offering form for this issuer
      seenDeal.add(kind);
    } // 10-Q/10-K are inherently material, one per window
    out.push({
      symbol,
      name,
      cik,
      form,
      formClean: kind,
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
  const isPeriodic = nf.formClean === "10-K" || nf.formClean === "10-Q";
  // Prior comparable for 8-Ks only (earnings-8-K → prior earnings-8-K). For a 10-K/10-Q we
  // deliberately DON'T paste a prior filing's text: the report already carries its own
  // prior-year/prior-period comparatives, and a different-quarter 10-Q alongside is ~all
  // shared boilerplate, which made the model conclude "nothing changed" → NONE. The
  // risk-factor redline below still supplies the Q/Q change in risks.
  const earningsOnly = nf.formClean === "8-K" && /(^|,)\s*2\.02/.test(nf.items);
  // Only 8-Ks get a prior-comparable diff. 10-Q/10-K use their own internal comparatives
  // (above); deal/offering forms (S-4/425/424B) are one-off events with no comparable.
  const priorIdx = nf.formClean === "8-K" ? findPriorComparable(nf.recent, nf.newIdx, nf.formClean, earningsOnly) : -1;
  const priorForm = priorIdx >= 0 ? nf.recent.form[priorIdx] : "";
  const priorAcc = priorIdx >= 0 ? nf.recent.accessionNumber[priorIdx] : "";
  const priorDate = priorIdx >= 0 ? nf.recent.filingDate[priorIdx] : "";

  // NEW text + comparable text + financial snapshot, in parallel.
  const newCap = nf.formClean === "8-K" ? 80_000 : 110_000;
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
    : isPeriodic
      ? "\n\n(Periodic report — compare against the prior-year/prior-period figures WITHIN the filing itself.)"
      : nf.formClean === "S-4" || nf.formClean === "425" || nf.formClean === "424B"
        ? "\n\n(Event filing — summarize what it announces: the deal or capital raise and its material terms (parties, price, size, structure). 'NONE' only if purely administrative.)"
        : "\n\n=== PRIOR COMPARABLE ===\n(none on file — assess the NEW filing on its own and call out anything materially new.)";

  const user =
    `${SCHEMA_HINT}\n\n` +
    `Company: ${nf.name} (${nf.symbol}). NEW filing: ${nf.form}${nf.items ? ` · items ${nf.items}` : ""} · accepted ${nf.acceptance}.\n` +
    `\n=== BACKGROUND CONTEXT (market data — NOT from this filing; for scale/context only) ===\n${snapshot || "(unavailable)"}\n` +
    `\n=== NEW FILING ${nf.form} ===\n${newClip}` +
    priorBlock +
    rfLine;

  const digest = await chatJSON<Digest>(SYSTEM, user, { maxTokens: 2000 });
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
    impact: ["high", "medium", "low"].includes(digest.impact) ? digest.impact : "medium",
    keyMetrics: digest.keyMetrics && typeof digest.keyMetrics === "object" ? digest.keyMetrics : {},
    riskFactorsAdded: rfAdded,
    riskFactorsRemoved: rfRemoved,
    accession: nf.accession,
    url: indexUrl(nf.cik, nf.accession),
  };
}

/**
 * Start (00:00 UTC) of the most recent prior trading day, skipping weekends. A flat
 * WINDOW_HOURS=36 lookback misses Friday's filings on a Monday (or weekend) run — the
 * weekend gap is wider than 36h — so the effective window is always widened to reach
 * back to the previous session. (US market holidays aren't special-cased; a holiday
 * Monday just looks back to Friday, which is harmless — one extra quiet day.)
 */
function prevTradingDayStart(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1); // at least yesterday
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1); // skip Sat/Sun
  return d.getTime();
}

async function main() {
  const now = Date.now();
  // Reach back the configured window OR to the previous trading session, whichever is
  // earlier — so a Monday/weekend run still catches Friday's filings (the weekend gap
  // alone is wider than the default 36h). An explicit WINDOW_HOURS override still wins
  // when it asks for a *wider* window (e.g. WINDOW_HOURS=336 for testing).
  const windowStart = Math.min(now - WINDOW_HOURS * 3600 * 1000, prevTradingDayStart(now));
  const since = new Date(windowStart).toISOString();

  let watch = await buildWatchSet();
  if (TEST_SYMBOLS) {
    const want = new Set(TEST_SYMBOLS.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean));
    const restricted = new Map<string, string>();
    for (const sym of want) restricted.set(sym, watch.get(sym) || sym);
    watch = restricted;
  }
  const effHours = Math.round((now - windowStart) / 3600e3);
  console.log(`Watch-set: ${watch.size} symbols · window ${effHours}h (since ${since})${SCAN_BROAD ? " · BROAD" : ""}${TEST_SYMBOLS ? " · TEST" : ""}`);

  // --- Detection (EDGAR-bound; ~4 concurrent + a polite delay) ---
  const symbols = [...watch.entries()];
  let scanned = 0;
  // 3 concurrent + a 300ms post-fetch pause ≈ 6 req/s — comfortably under EDGAR's 10/s
  // ceiling (4×/120ms previously burst to ~15/s and got 429-throttled). fetchWithRetry
  // backs off on any residual throttle.
  const detected: NewFiling[][] = await pool(symbols, 3, async ([sym, name]) => {
    const r = await detectForSymbol(sym, name, windowStart);
    if (++scanned % 100 === 0) console.log(`  …scanned ${scanned}/${symbols.length}`);
    await sleep(300);
    return r;
  });
  const newFilings = detected.flat();
  console.log(`Detected ${newFilings.length} new material filings across ${watch.size} symbols.`);
  if (scanErrors.length) {
    console.warn(`⚠ ${scanErrors.length} symbols dropped on EDGAR fetch errors (coverage gap): ${scanErrors.slice(0, 20).join(" · ")}${scanErrors.length > 20 ? " …" : ""}`);
  }

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
    windowHours: effHours, // effective lookback (may exceed WINDOW_HOURS when reaching back across a weekend)
    since,
    count: items.length,
    items,
  };
  await fs.writeFile(path.join(DATA, "overnight-filings.json"), JSON.stringify(out));
  console.log(`\nWrote ${items.length} digests (${gatedNone} gated to NONE/unreadable) → data/overnight-filings.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
