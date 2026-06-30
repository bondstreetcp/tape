/**
 * Same-store / comparable sales extractor → data/same-store-sales.json.
 *
 * Primary source: the 8-K Exhibit 99.1 earnings press release (getFilingText already prefers EX-99);
 * fallback: 10-Q MD&A. Extraction is LLM (chatJSON / PRO_MODEL) — comps have no us-gaap XBRL tag.
 * Scope: US names whose industry ∈ SSS_INDUSTRIES across S&P500 ∪ Nasdaq100 ∪ Russell 1000.
 *
 * Modes:
 *   - incremental (default): per name, skip entirely if the newest earnings 8-K === stored
 *     lastAccession; else extract only the new quarter(s). Steady state ≈ a handful of names/night.
 *   - backfill: BACKFILL=8 walks the last N earnings 8-Ks per name (run once, off-cron).
 * Knobs: ONLY=CMG,MCD (ticker allowlist) · INDUSTRY=Restaurants (industry filter) · BACKFILL=8 · MAXTOK.
 *
 * Validated against CMG/YUM/KR/TJX/RL/MCD/SBUX/KSS/DG (see the design memo): handles multi-brand,
 * grocery ex-fuel, constant-currency, and NEGATIVE comps with the correct sign.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getFilings, getFilingText } from "../lib/edgar";
import { getFilingDoc } from "../lib/filingDoc";
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";
import { loadSnapshot } from "../lib/data";
import { SSS_INDUSTRIES, type SssData, type SssPeriod, type SssTicker } from "../lib/sameStoreSales";

// Load .env.local into process.env (without printing secrets).
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI provides env directly */ }

const OUT = join(process.cwd(), "data", "same-store-sales.json");
const UNIVERSES = ["sp500", "nasdaq100", "russell1000"];
const BACKFILL = Number(process.env.BACKFILL || 0); // 0 = incremental; N = walk last N earnings 8-Ks
const MAXTOK = Number(process.env.MAXTOK || 16000); // Gemini reasoning eats max_tokens → keep high
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const INDUSTRY = (process.env.INDUSTRY || "").trim(); // e.g. "Restaurants" for Phase 1
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KW = /comparable|same[- ]store|identical sales|like[- ]for[- ]like|comp(s|arable)?\s+(restaurant|store|sales)|system[- ]wide/i;
function grepWindows(text: string, pad = 900, cap = 15000): string {
  const hits: [number, number][] = [];
  const re = new RegExp(KW.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = Math.max(0, m.index - pad), e = Math.min(text.length, m.index + pad);
    if (hits.length && s <= hits[hits.length - 1][1]) hits[hits.length - 1][1] = e;
    else hits.push([s, e]);
    if (hits.reduce((a, [x, y]) => a + (y - x), 0) > cap) break;
  }
  // ALWAYS prepend the release header — the fiscal period-end dateline ("...for the quarter ended
  // March 29, 2026" / "...thirteen weeks ended May 25, 2025") lives at the top, away from the comp
  // paragraph. Without it the model can't return periodEnd and the row never aligns to a column.
  const head = text.slice(0, 1300);
  if (!hits.length) return (head + "\n…\n" + text.slice(0, cap)).slice(0, cap);
  return (head + "\n…\n" + hits.map(([s, e]) => text.slice(s, e)).join("\n…\n")).slice(0, cap);
}

const SYSTEM =
  "You extract the COMPARABLE SALES metric (a.k.a. same-store sales / SSS / identical sales / like-for-like) from a retailer's or restaurant's quarterly earnings press release. Return the headline TOTAL-COMPANY comparable-sales figure for the MOST RECENT FISCAL QUARTER, on a ONE-YEAR basis. Rules: " +
  "Use the MOST RECENT FISCAL QUARTER (a ~3-month / 13-week period), NOT a full-year, annual, or year-to-date/52-week figure — if the release shows BOTH a quarter and a full-year comp, pick the QUARTER. " +
  "'comp' = total-company 1-year comparable-sales % change, SIGNED (e.g. 5.3 or -2.1). If a TOTAL/CONSOLIDATED/company-wide comparable-sales figure is given (even alongside per-brand or per-segment figures), put that TOTAL in 'comp' and the breakdown in 'segments'. Only if there is genuinely NO single company-wide comp (some multi-brand operators), set comp=null and fill 'segments'. " +
  "Do NOT return system-wide sales growth, net-sales growth, or total-revenue growth — ONLY the comparable/same-store/identical/like-for-like metric. " +
  "'basis': '1yr' for a normal YoY quarterly comp; '2yr-stack'|'ex-fx'|'reported' otherwise. " +
  "'metricLabel': the company's OWN verbatim term. 'definition': the disclosed measurement rule if stated, else null. " +
  "'periodEnd': the END date of that fiscal QUARTER, as ISO YYYY-MM-DD (e.g. 'quarter ended March 29, 2026' → '2026-03-29'; 'thirteen weeks ended May 25, 2025' → '2025-05-25'). 'fiscalLabel': a SHORT label like 'Q1 FY27' (max 12 chars). " +
  "'traffic'/'ticket': transactions/traffic and average-check/ticket/AUR decomposition if disclosed (signed), else null. 'segments': by brand/banner/region [{name,comp}] if disclosed, else []. 'twoYrStack': 2-year stacked comp if disclosed, else null. " +
  "'quote': the VERBATIM sentence or table fragment stating the headline comp. If you cannot find one, set comp=null and quote=null — NEVER invent a number. 'confidence': 'high' (explicit statement/table) | 'medium' (prose/inferred) | 'low' (ambiguous). " +
  "If the document discloses NO comparable-sales metric, return comp=null, segments=[], quote=null. Return a SINGLE JSON OBJECT, not an array. " + NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON (a single object): {"comp": number|null, "basis": string, "metricLabel": string|null, "definition": string|null, "periodEnd": string|null, "fiscalLabel": string|null, "traffic": number|null, "ticket": number|null, "segments": [{"name": string, "comp": number}], "twoYrStack": number|null, "quote": string|null, "confidence": string}';

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
// Restaurants/retail use many phrasings: comparable, same-store/-restaurant/-shop/-location, identical
// sales (grocery), like-for-like (intl), SSS/LFL. (Earlier this only matched "same store" → nulled
// valid comps for CAVA/WEN/DRI/BROS.) Still rejects "system-wide" / "net sales" / "total revenue".
const isCompMetric = (label?: string | null) =>
  !!label && /compar|same.?(store|restaurant|shop|location|site|cafe|salon)|identical|like.?for.?like|\bsss\b|\blfl\b/i.test(label);

interface Extracted extends Omit<SssPeriod, "fpEnd" | "source"> { periodEnd?: string | null; quote?: string | null }

async function extract(sym: string, text: string): Promise<Extracted | null> {
  const raw = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\nEarnings text for ${sym}:\n${grepWindows(text)}`, {
    model: PRO_MODEL,
    maxTokens: MAXTOK,
    reasoningEffort: "low",
  });
  if (!raw) return null;
  const o = Array.isArray(raw) ? raw[0] : raw; // the model sometimes wraps the object in an array
  if (!o || typeof o !== "object") return null;
  let comp = num(o.comp);
  const basis = typeof o.basis === "string" ? o.basis : "1yr";
  // Only a clean 1-yr comp on a real comparable-sales metric feeds the row.
  if (comp != null && (Math.abs(comp) > 60 || (basis && basis !== "1yr" && basis !== "reported") || !isCompMetric(o.metricLabel))) comp = null;
  const segments = Array.isArray(o.segments)
    ? o.segments.filter((s: any) => s && typeof s.name === "string" && num(s.comp) != null).map((s: any) => ({ name: String(s.name).slice(0, 40), comp: num(s.comp) as number }))
    : [];
  return {
    comp,
    basis,
    metricLabel: typeof o.metricLabel === "string" ? o.metricLabel.slice(0, 60) : undefined,
    definition: typeof o.definition === "string" ? o.definition.slice(0, 600) : null,
    periodEnd: typeof o.periodEnd === "string" ? o.periodEnd : null,
    fiscalLabel: typeof o.fiscalLabel === "string" ? o.fiscalLabel.slice(0, 16) : undefined,
    traffic: num(o.traffic),
    ticket: num(o.ticket),
    segments,
    twoYrStack: num(o.twoYrStack),
    quote: typeof o.quote === "string" ? o.quote.slice(0, 400) : null,
    confidence: ["high", "medium", "low"].includes(o.confidence) ? o.confidence : "medium",
  };
}

async function buildWatchSet(): Promise<{ sym: string; industry: string }[]> {
  const seen = new Map<string, string>();
  for (const u of UNIVERSES) {
    const snap = await loadSnapshot(u);
    for (const s of snap?.stocks ?? []) {
      if (!s.industry || seen.has(s.symbol)) continue;
      if (INDUSTRY ? s.industry === INDUSTRY : SSS_INDUSTRIES.has(s.industry)) seen.set(s.symbol, s.industry);
    }
  }
  let list = [...seen.entries()].map(([sym, industry]) => ({ sym, industry }));
  if (ONLY.length) list = list.filter((x) => ONLY.includes(x.sym));
  return list.sort((a, b) => a.sym.localeCompare(b.sym));
}

(async () => {
  if (!(await llmConfigured())) { console.error("✗ no LLM key (OPENROUTER_API_KEY). Aborting."); process.exit(1); }
  const data: SssData = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { generatedAt: "", byTicker: {} };
  const watch = await buildWatchSet();
  console.log(`watch-set: ${watch.length} names${INDUSTRY ? ` (${INDUSTRY})` : ""}${ONLY.length ? ` [ONLY ${ONLY.join(",")}]` : ""} · mode=${BACKFILL ? `backfill ${BACKFILL}q` : "incremental"}`);

  let touched = 0, calls = 0;
  for (const { sym, industry } of watch) {
    try {
      const { filings } = await getFilings(sym, 0, 90);
      const earnings = filings.filter((f) => f.isEarnings);
      if (!earnings.length) { console.log(`  ${sym}: no earnings 8-K`); continue; }
      const prior = data.byTicker[sym];
      const targets = BACKFILL ? earnings.slice(0, BACKFILL) : (prior?.lastAccession === earnings[0].acc ? [] : earnings.slice(0, 1));
      if (!targets.length) { console.log(`  ${sym}: up to date (${earnings[0].date})`); continue; }

      const periods: SssPeriod[] = BACKFILL ? [] : [...(prior?.periods ?? [])];
      for (const f of targets) {
        let text = "", src = { form: f.form, url: f.url, date: f.date };
        const ft = await getFilingText(sym, f.acc);
        if (ft && ft.text.length > 400) { text = ft.text; src.url = ft.url; }
        else if (!BACKFILL) { const doc = await getFilingDoc(sym, "10-Q"); if (doc) { text = doc.text; src = { form: doc.form, url: doc.url, date: doc.date }; } }
        if (!text) { console.log(`  ${sym}: no text for ${f.date}`); continue; }
        const ex = await extract(sym, text); calls++;
        if (!ex) { console.log(`  ${sym} ${f.date}: extract failed`); await sleep(150); continue; }
        const fpEnd = ex.periodEnd && !Number.isNaN(Date.parse(ex.periodEnd)) ? ex.periodEnd : null;
        if (!fpEnd) { console.log(`  ${sym} ${f.date}: no period-end → skip (comp ${ex.comp})`); await sleep(150); continue; }
        const { periodEnd, quote, ...rest } = ex;
        const period: SssPeriod = { fpEnd, ...rest, source: { ...src, quote: quote ?? null } };
        const ix = periods.findIndex((p) => p.fpEnd === fpEnd);
        if (ix >= 0) periods[ix] = period; else periods.push(period);
        console.log(`  ${sym} ${ex.fiscalLabel || f.date}: comp ${ex.comp ?? "—"}%${ex.traffic != null ? ` (T ${ex.traffic}/Tk ${ex.ticket})` : ""}${ex.segments?.length ? ` · ${ex.segments.length} seg` : ""}`);
        await sleep(150);
      }
      periods.sort((a, b) => b.fpEnd.localeCompare(a.fpEnd));
      const newest = periods.find((p) => p.metricLabel) || periods[0];
      if (periods.length) {
        data.byTicker[sym] = {
          metricLabel: newest?.metricLabel || "Comparable sales",
          definition: newest?.definition ?? null,
          lastAccession: earnings[0].acc,
          industry,
          periods: periods.slice(0, 16),
        } as SssTicker;
        touched++;
      }
    } catch (e: any) {
      console.log(`  ${sym}: ERROR ${String(e?.message || e).slice(0, 120)}`);
    }
    // Persist after every name so a long backfill survives an interrupt/timeout.
    data.generatedAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(data));
  }

  data.generatedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`\nWrote ${OUT} · ${touched} names updated · ${calls} LLM calls · ${Object.keys(data.byTicker).length} total in file`);
})();
