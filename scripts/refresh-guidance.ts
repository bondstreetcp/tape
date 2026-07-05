/**
 * Management GUIDANCE (forward outlook) extractor → data/guidance.json. Like comps, guidance is a
 * company-disclosed forward statement with no XBRL tag → LLM-from-8-K-text.
 *
 * Source: the 8-K Ex-99.1 earnings press release (`getFilingText` prefers EX-99). Extracts the standing
 * outlook for the guided period(s) — revenue range (USD millions), EPS range, and raise/reaffirm/cut vs
 * the prior outlook. Scope: US names across S&P500 ∪ Nasdaq100 ∪ Russell 1000.
 *
 * Modes: incremental (default; skip if the newest earnings 8-K === stored lastAccession) · BACKFILL
 * isn't useful (only the LATEST guide matters) · ONLY=AAPL,MSFT · MAXTOK.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getFilings, getFilingText } from "../lib/edgar";
import { chatJSON, FLASH_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";
import { loadSnapshot } from "../lib/data";
import type { GuidanceData, GuidancePeriod, GuidanceTicker, GuidanceAction } from "../lib/guidance";

try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI provides env */ }

const OUT = join(process.cwd(), "data", "guidance.json");
const UNIVERSES = ["sp500", "nasdaq100"]; // ~600 large caps — the names a guide read matters most for
const MAXTOK = Number(process.env.MAXTOK || 16000);
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const LIMIT = Number(process.env.LIMIT || 0); // cap names processed this run (for a bounded seed)
const BACKFILL = Number(process.env.BACKFILL || 0); // 0 = incremental (latest 8-K only); N = walk last N 8-Ks to seed the beat-the-guide history
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KW = /guidance|outlook|expect|guide|forecast|full[- ]year|fiscal 20\d\d|for the (year|quarter)|anticipat|reaffirm|raott|raise|updat\w+ (its|our|full)|continues? to expect|now expects?/i;
function grepWindows(text: string, pad = 1100, cap = 14000): string {
  const hits: [number, number][] = [];
  const re = new RegExp(KW.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = Math.max(0, m.index - pad), e = Math.min(text.length, m.index + pad);
    if (hits.length && s <= hits[hits.length - 1][1]) hits[hits.length - 1][1] = e;
    else hits.push([s, e]);
    if (hits.reduce((a, [x, y]) => a + (y - x), 0) > cap) break;
  }
  const head = text.slice(0, 1200);
  if (!hits.length) return (head + "\n…\n" + text.slice(0, cap)).slice(0, cap);
  return (head + "\n…\n" + hits.map(([s, e]) => text.slice(s, e)).join("\n…\n")).slice(0, cap);
}

const SYSTEM =
  "You extract management's FORWARD FINANCIAL GUIDANCE plus two specific datapoints from a company's quarterly earnings press release. Return a JSON OBJECT: {reportedEps, nextQuarterEpsLow, nextQuarterEpsHigh, guides}. " +
  "'reportedEps' = the ACTUAL diluted EPS the company JUST REPORTED for the completed quarter, $/share (use the ADJUSTED/non-GAAP figure if that's the headline the company leads with). null if not clearly stated. " +
  "'nextQuarterEpsLow'/'nextQuarterEpsHigh' = the company's guide specifically for the NEXT/upcoming single QUARTER's EPS, $/share (NOT the full-year). null if they only guide the full year or give no quarterly EPS. " +
  "'guides' = an ARRAY of guided periods (usually 1-2: the full year, and sometimes the next quarter). For EACH period: " +
  "'period' = what it covers, short (e.g. 'FY2026', 'Q3 FY26'). " +
  "'revLowM'/'revHighM' = the REVENUE guide range in MILLIONS of USD (e.g. '$40.1 to $40.9 billion' → 40100 / 40900; a single point → put it in BOTH). null if no revenue guide. " +
  "'epsLow'/'epsHigh' = the EPS (earnings PER SHARE) guide range in DOLLARS — typically between $0.05 and $50. Do NOT return a margin %, a revenue/sales figure, a growth rate, or any non-per-share number as EPS. '$6.20–$6.40' → 6.20 / 6.40; adjusted/non-GAAP is fine, note it in metricLabel. null if no EPS guide. " +
  "'action' = how this outlook compares to the company's PRIOR guidance: 'raise' (raised/increased), 'cut' (lowered/reduced), 'reaffirm' (maintained/reiterated/unchanged), 'initiate' (first time giving it), 'mixed' (raised one metric, cut another), or 'none' if not stated. " +
  "'metricLabel' = brief note if the guide is non-standard (e.g. 'adjusted EPS', 'organic revenue growth %', 'comparable sales'); else null. " +
  "'quote' = the VERBATIM guidance sentence. 'confidence' = high|medium|low. " +
  "If the company gives guidance only as a GROWTH RATE or a non-dollar metric (e.g. 'mid-single-digit revenue growth', 'comparable sales up 3-5%', 'deliver 20,500-21,500 homes') and NO dollar/EPS range, still return the period with revLowM/revHighM/epsLow/epsHigh=null and put the metric + range in metricLabel + quote. " +
  "CRITICAL: a single period usually carries SEVERAL guides at once — e.g. a revenue/sales figure, an EPS $ range, a margin, and a unit/volume target. For each period ALWAYS populate epsLow/epsHigh from the per-share EPS $ range and revLowM/revHighM from the revenue $ range whenever the filing states them; scan the WHOLE outlook section, do not stop at the first guidance sentence, and never let a growth-rate or unit metric (organic sales %, deliveries, comparable sales) crowd out an EPS or revenue $ range that is ALSO given. The forward EPS $ range is the single most important field — capture it if it appears anywhere in the outlook. " +
  "If the release gives NO forward guidance at all, return guides: []. NEVER invent, COMPUTE, derive, annualize, or estimate a number: put a value in revLowM/revHighM/epsLow/epsHigh ONLY if that exact $ figure is written in the filing text as guidance. Do NOT multiply a unit target (e.g. '20,500 homes') by a price to produce a revenue $, and do NOT back into EPS from net income — if guidance is only in units or rates, leave the $ fields null and describe it in metricLabel/quote. " + NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON object: {"reportedEps": number|null, "nextQuarterEpsLow": number|null, "nextQuarterEpsHigh": number|null, "guides": [{"period": string, "metricLabel": string|null, "revLowM": number|null, "revHighM": number|null, "epsLow": number|null, "epsHigh": number|null, "action": "raise"|"reaffirm"|"cut"|"initiate"|"mixed"|"none", "quote": string|null, "confidence": "high"|"medium"|"low"}]}';

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ACTIONS = new Set<GuidanceAction>(["raise", "reaffirm", "cut", "initiate", "mixed", "none"]);

interface Extracted { reportedEps: number | null; nextQEpsLow: number | null; nextQEpsHigh: number | null; guides: GuidancePeriod[] }

// Guidance extraction is mechanical (fill the schema from the filing text), so it runs on the CHEAP
// FLASH tier — NOT the premium Pro model it used to (that was ~5x the nightly's whole LLM bill for one
// job). Override per-run with GUIDANCE_MODEL for A/B testing.
const GUIDANCE_MODEL = process.env.GUIDANCE_MODEL || FLASH_MODEL;

async function extract(sym: string, text: string, ctx: { mktcapM: number | null; consEps: number | null }): Promise<Extracted | null> {
  const raw = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\nEarnings text for ${sym}:\n${grepWindows(text)}`, { model: GUIDANCE_MODEL, maxTokens: MAXTOK, reasoningEffort: "low" });
  if (raw == null) return null; // LLM transport failure ≠ "no guidance" — caller must not store [] or advance the gate
  const root = Array.isArray(raw) ? raw[0] : raw;
  const arr: any[] = Array.isArray(root?.guides) ? root.guides : Array.isArray(raw) ? raw : root && typeof root === "object" && root.period ? [root] : [];
  // Quote grounding (the SSS pattern): a "verbatim" quote must actually appear in the filing text
  // (whitespace/punctuation-normalized) — a fabricated citation is worse than none.
  const normText = text.replace(/\s+/g, " ").replace(/[,$]/g, "").toLowerCase();
  const groundedQuote = (q: unknown): string | null => {
    if (typeof q !== "string" || !q.trim()) return null;
    const nq = q.replace(/\s+/g, " ").replace(/[,$]/g, "").toLowerCase();
    return normText.includes(nq.slice(0, 80)) ? q.slice(0, 400) : null;
  };
  // Revenue sanity vs market cap: quarterly/annual guides live within a wide but finite band of the
  // company's size — a 1000× unit misread ($40.9B stored as 40.9, or raw dollars as "millions")
  // lands far outside [0.001×, 10×] mktcap and is nulled rather than stored wrong.
  const revOk = (v: number | null): number | null => {
    if (v == null) return null;
    if (ctx.mktcapM != null) return v >= ctx.mktcapM * 0.001 && v <= ctx.mktcapM * 10 ? v : null;
    return v >= 1 && v <= 1_000_000 ? v : null; // no mktcap known → absolute $1M-$1T band
  };
  const out: GuidancePeriod[] = [];
  for (const o of arr) {
    if (!o || typeof o !== "object" || typeof o.period !== "string") continue;
    let revLowM = revOk(num(o.revLowM)), revHighM = revOk(num(o.revHighM));
    if (revLowM != null && revHighM != null && revLowM > revHighM) [revLowM, revHighM] = [revHighM, revLowM]; // enforce low ≤ high
    const epsLow = num(o.epsLow), epsHigh = num(o.epsHigh);
    const metricLabel = typeof o.metricLabel === "string" ? o.metricLabel.slice(0, 60) : undefined;
    // Keep a period only if it carries a usable dollar/EPS range OR a described metric (metricLabel/quote).
    if (revLowM == null && epsLow == null && revHighM == null && epsHigh == null && !metricLabel && !o.quote) continue;
    out.push({
      period: o.period.slice(0, 16),
      metricLabel,
      revLowM, revHighM, epsLow, epsHigh,
      action: ACTIONS.has(o.action) ? o.action : "none",
      quote: groundedQuote(o.quote),
      confidence: ["high", "medium", "low"].includes(o.confidence) ? o.confidence : "medium",
    });
  }
  // Dedup repeated periods (the model sometimes emits FY27 three times) — keep the first per period.
  const byPeriod = new Map<string, GuidancePeriod>();
  for (const g of out) { const k = g.period.toLowerCase().replace(/\s/g, ""); if (!byPeriod.has(k)) byPeriod.set(k, g); }
  // EPS sanity: > $200/sh is a misread, not EPS; and when a consensus estimate exists, a reported
  // quarterly EPS more than ~5× the ANNUAL consensus (or wildly negative vs it) is a misread too —
  // reportedEps feeds the "beats its own guide" track record, so one bad figure poisons the stat.
  const epsOk = (v: number | null) => {
    if (v == null) return true;
    if (Math.abs(v) > 200) return false;
    if (ctx.consEps != null && Math.abs(ctx.consEps) >= 0.1) return Math.abs(v) <= Math.max(Math.abs(ctx.consEps) * 5, 5);
    return true;
  };
  return {
    reportedEps: epsOk(num(root?.reportedEps)) ? num(root?.reportedEps) : null,
    nextQEpsLow: epsOk(num(root?.nextQuarterEpsLow)) ? num(root?.nextQuarterEpsLow) : null,
    nextQEpsHigh: epsOk(num(root?.nextQuarterEpsHigh)) ? num(root?.nextQuarterEpsHigh) : null,
    guides: [...byPeriod.values()].slice(0, 3),
  };
}

async function buildWatchSet(): Promise<{ list: string[]; mktcapM: Map<string, number> }> {
  const seen = new Set<string>();
  const mktcapM = new Map<string, number>();
  for (const u of UNIVERSES) {
    const snap = await loadSnapshot(u);
    for (const s of snap?.stocks ?? []) {
      seen.add(s.symbol);
      if (s.marketCap > 0 && !mktcapM.has(s.symbol)) mktcapM.set(s.symbol, s.marketCap / 1e6);
    }
  }
  let list = [...seen];
  if (ONLY.length) list = list.filter((s) => ONLY.includes(s));
  return { list: list.sort(), mktcapM };
}

// Consensus EPS per symbol (data/estimates.json cyNow = current-year est) — the reportedEps gate.
function loadConsensus(): Map<string, number> {
  try {
    const e = JSON.parse(readFileSync(join(process.cwd(), "data", "estimates.json"), "utf8"));
    const m = new Map<string, number>();
    for (const [sym, v] of Object.entries<any>(e?.names ?? {})) if (typeof v?.cyNow === "number" && Number.isFinite(v.cyNow)) m.set(sym, v.cyNow);
    return m;
  } catch { return new Map(); }
}

(async () => {
  if (!(await llmConfigured())) { console.error("✗ no LLM key (OPENROUTER_API_KEY). Aborting."); process.exit(1); }
  const data: GuidanceData = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { generatedAt: "", byTicker: {} };
  const { list: watch, mktcapM } = await buildWatchSet();
  const consensus = loadConsensus();
  console.log(`guidance watch-set: ${watch.length} names${ONLY.length ? ` [ONLY ${ONLY.join(",")}]` : ""}${LIMIT ? ` · LIMIT ${LIMIT}` : ""}`);

  let touched = 0, calls = 0, processed = 0;
  for (const sym of watch) {
    if (LIMIT && processed >= LIMIT) break;
    try {
      const { filings } = await getFilings(sym, 0, 90);
      const earnings = filings.filter((f) => f.isEarnings);
      if (!earnings.length) continue;
      const e0 = earnings[0];
      const prior = data.byTicker[sym];
      // Incremental processes only the latest 8-K (skip if seen); BACKFILL walks the last N for history.
      if (!BACKFILL && prior?.lastAccession === e0.acc) continue;
      processed++;
      const targets = BACKFILL ? earnings.slice(0, BACKFILL) : [e0];
      const history = BACKFILL ? [] : [...(prior?.history ?? [])];
      let latestGuides = prior?.guides ?? [], latestSrc = prior?.source, latestUpd = prior?.updated;
      // The incremental gate may only advance once the NEWEST 8-K was actually read AND extracted —
      // a transient EDGAR/LLM failure previously stored guides:[] and stamped lastAccession, erasing
      // a standing guide until the NEXT quarter's print. Failures now leave the gate untouched.
      let e0ok = false;
      for (const f of targets) {
        const ft = await getFilingText(sym, f.acc);
        if (!ft || ft.text.length < 400) { console.log(`  ${sym} ${f.date}: no text — will retry next run`); continue; }
        const ex = await extract(sym, ft.text, { mktcapM: mktcapM.get(sym) ?? null, consEps: consensus.get(sym) ?? null }); calls++;
        if (ex == null) { console.log(`  ${sym} ${f.date}: LLM failed — will retry next run`); continue; }
        if (f.acc === e0.acc) e0ok = true;
        const hp = { date: f.date, reportedEps: ex.reportedEps, nextQEpsLow: ex.nextQEpsLow, nextQEpsHigh: ex.nextQEpsHigh };
        const hi = history.findIndex((h) => h.date === f.date);
        if (hi >= 0) history[hi] = hp; else history.push(hp);
        if (f.acc === e0.acc) { latestGuides = ex.guides; latestSrc = { form: f.form, url: ft.url, date: f.date }; latestUpd = f.date; }
        console.log(`  ${sym} ${f.date}: ${ex.guides.length ? ex.guides.map((g) => `${g.period} ${g.action}`).join(",") : "no guide"}${ex.reportedEps != null ? ` · act EPS ${ex.reportedEps}` : ""}${ex.nextQEpsLow != null ? ` · nextQ ${ex.nextQEpsLow}-${ex.nextQEpsHigh}` : ""}`);
        await sleep(150);
      }
      history.sort((a, b) => b.date.localeCompare(a.date));
      data.byTicker[sym] = { lastAccession: e0ok ? e0.acc : (prior?.lastAccession ?? ""), updated: latestUpd || e0.date, source: latestSrc || { form: e0.form, url: "", date: e0.date }, guides: latestGuides, history: history.slice(0, 10) } as GuidanceTicker;
      if (latestGuides.length) touched++;
    } catch (e: any) {
      console.log(`  ${sym}: ERROR ${String(e?.message || e).slice(0, 100)}`);
    }
    data.generatedAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(data));
  }
  data.generatedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`\nWrote ${OUT} · ${touched} with guidance · ${calls} LLM calls · ${Object.keys(data.byTicker).length} total in file`);
})();
