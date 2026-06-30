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
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";
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
  "You extract management's FORWARD FINANCIAL GUIDANCE (the 'outlook'/'guidance' section) from a company's quarterly earnings press release. Return an ARRAY of guided periods (usually 1-2: the full year, and sometimes the next quarter). For EACH period: " +
  "'period' = what it covers, short (e.g. 'FY2026', 'Q3 FY26'). " +
  "'revLowM'/'revHighM' = the REVENUE guide range in MILLIONS of USD (e.g. '$40.1 to $40.9 billion' → 40100 / 40900; a single point → put it in BOTH). null if no revenue guide. " +
  "'epsLow'/'epsHigh' = the EPS (earnings PER SHARE) guide range in DOLLARS — typically between $0.05 and $50. Do NOT return a margin %, a revenue/sales figure, a growth rate, or any non-per-share number as EPS. '$6.20–$6.40' → 6.20 / 6.40; adjusted/non-GAAP is fine, note it in metricLabel. null if no EPS guide. " +
  "'action' = how this outlook compares to the company's PRIOR guidance: 'raise' (raised/increased), 'cut' (lowered/reduced), 'reaffirm' (maintained/reiterated/unchanged), 'initiate' (first time giving it), 'mixed' (raised one metric, cut another), or 'none' if not stated. " +
  "'metricLabel' = brief note if the guide is non-standard (e.g. 'adjusted EPS', 'organic revenue growth %', 'comparable sales'); else null. " +
  "'quote' = the VERBATIM guidance sentence. 'confidence' = high|medium|low. " +
  "If the company gives guidance only as a GROWTH RATE or a non-dollar metric (e.g. 'mid-single-digit revenue growth', 'comparable sales up 3-5%') and NO dollar/EPS range, still return the period with revLowM/revHighM/epsLow/epsHigh=null and put the metric + range in metricLabel + quote. " +
  "If the release gives NO forward guidance at all, return an empty array []. NEVER invent numbers — only what's stated. " + NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON: an ARRAY of {"period": string, "metricLabel": string|null, "revLowM": number|null, "revHighM": number|null, "epsLow": number|null, "epsHigh": number|null, "action": "raise"|"reaffirm"|"cut"|"initiate"|"mixed"|"none", "quote": string|null, "confidence": "high"|"medium"|"low"}';

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ACTIONS = new Set<GuidanceAction>(["raise", "reaffirm", "cut", "initiate", "mixed", "none"]);

async function extract(sym: string, text: string): Promise<GuidancePeriod[]> {
  const raw = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\nEarnings text for ${sym}:\n${grepWindows(text)}`, { model: PRO_MODEL, maxTokens: MAXTOK, reasoningEffort: "low" });
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out: GuidancePeriod[] = [];
  for (const o of arr) {
    if (!o || typeof o !== "object" || typeof o.period !== "string") continue;
    const revLowM = num(o.revLowM), revHighM = num(o.revHighM), epsLow = num(o.epsLow), epsHigh = num(o.epsHigh);
    const metricLabel = typeof o.metricLabel === "string" ? o.metricLabel.slice(0, 60) : undefined;
    // Keep a period only if it carries a usable dollar/EPS range OR a described metric (metricLabel/quote).
    if (revLowM == null && epsLow == null && revHighM == null && epsHigh == null && !metricLabel && !o.quote) continue;
    out.push({
      period: o.period.slice(0, 16),
      metricLabel,
      revLowM, revHighM, epsLow, epsHigh,
      action: ACTIONS.has(o.action) ? o.action : "none",
      quote: typeof o.quote === "string" ? o.quote.slice(0, 400) : null,
      confidence: ["high", "medium", "low"].includes(o.confidence) ? o.confidence : "medium",
    });
  }
  // Dedup repeated periods (the model sometimes emits FY27 three times) — keep the first per period.
  const byPeriod = new Map<string, GuidancePeriod>();
  for (const g of out) { const k = g.period.toLowerCase().replace(/\s/g, ""); if (!byPeriod.has(k)) byPeriod.set(k, g); }
  return [...byPeriod.values()].slice(0, 3);
}

async function buildWatchSet(): Promise<string[]> {
  const seen = new Set<string>();
  for (const u of UNIVERSES) { const snap = await loadSnapshot(u); for (const s of snap?.stocks ?? []) seen.add(s.symbol); }
  let list = [...seen];
  if (ONLY.length) list = list.filter((s) => ONLY.includes(s));
  return list.sort();
}

(async () => {
  if (!(await llmConfigured())) { console.error("✗ no LLM key (OPENROUTER_API_KEY). Aborting."); process.exit(1); }
  const data: GuidanceData = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { generatedAt: "", byTicker: {} };
  const watch = await buildWatchSet();
  console.log(`guidance watch-set: ${watch.length} names${ONLY.length ? ` [ONLY ${ONLY.join(",")}]` : ""}${LIMIT ? ` · LIMIT ${LIMIT}` : ""}`);

  let touched = 0, calls = 0, processed = 0;
  for (const sym of watch) {
    if (LIMIT && processed >= LIMIT) break;
    try {
      const { filings } = await getFilings(sym, 0, 90);
      const earnings = filings.filter((f) => f.isEarnings);
      if (!earnings.length) continue;
      const e0 = earnings[0];
      if (data.byTicker[sym]?.lastAccession === e0.acc) { continue; } // up to date
      processed++;
      const ft = await getFilingText(sym, e0.acc);
      if (!ft || ft.text.length < 400) { console.log(`  ${sym}: no text`); continue; }
      const guides = await extract(sym, ft.text); calls++;
      // Even when no guidance is found we record lastAccession so we don't re-LLM the same 8-K nightly.
      data.byTicker[sym] = { lastAccession: e0.acc, updated: e0.date, source: { form: e0.form, url: ft.url, date: e0.date }, guides } as GuidanceTicker;
      if (guides.length) { touched++; console.log(`  ${sym} ${e0.date}: ${guides.map((g) => `${g.period} ${g.action}${g.revLowM != null ? ` rev ${g.revLowM}-${g.revHighM}` : ""}${g.epsLow != null ? ` eps ${g.epsLow}-${g.epsHigh}` : ""}`).join(" · ")}`); }
      else console.log(`  ${sym} ${e0.date}: no guidance`);
      await sleep(150);
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
