/**
 * International same-store / like-for-like (LFL) extractor → data/same-store-sales.json (the SAME file
 * the US extractor writes, keyed by Yahoo symbol). Phase 3: European (UK/RNS) retailers.
 *
 * Source: the issuer's quarterly RNS "trading statement" / interim / final results, fetched from
 * Investegate (lib/irText.ts). Extraction is LLM (chatJSON / PRO_MODEL) with an intl-tuned prompt —
 * UK/EU comps are phrased as like-for-like, LFL, comparable store sales, full-price sales (Next),
 * or organic growth, and a single release often carries BOTH a quarter and an H1/FY figure.
 *
 * Modes:
 *   - incremental (default): per name, skip if the newest results RNS id === stored lastAccession.
 *   - backfill: BACKFILL=4 walks the last N results announcements per name (run once, off-cron).
 * Knobs: ONLY=NXT,TSCO (ticker allowlist, matches the LSE ticker) · BACKFILL=4 · MAXTOK · TAKE.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "../lib/llm";
import { getLatestUkResults } from "../lib/irText";
import { INTL_COMPS } from "../lib/intlComps";
import type { SssData, SssPeriod, SssTicker } from "../lib/sameStoreSales";

// Load .env.local into process.env (without printing secrets).
try {
  const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const mm = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI provides env directly */ }

const OUT = join(process.cwd(), "data", "same-store-sales.json");
const BACKFILL = Number(process.env.BACKFILL || 0); // 0 = incremental; N = walk last N results RNS
const MAXTOK = Number(process.env.MAXTOK || 16000);
const TAKE = Number(process.env.TAKE || (BACKFILL || 1));
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Comp-metric keywords (broadened for UK/EU phrasings: full-price sales, organic, comparable store).
const KW = /like[- ]for[- ]like|\blfl\b|comparable (store |retail )?sales|same[- ]?(store|shop)|full[- ]?price sales|identical sales|organic (revenue|sales|growth)/i;
function grepWindows(text: string, pad = 1000, cap = 15000): string {
  const hits: [number, number][] = [];
  const re = new RegExp(KW.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = Math.max(0, m.index - pad), e = Math.min(text.length, m.index + pad);
    if (hits.length && s <= hits[hits.length - 1][1]) hits[hits.length - 1][1] = e;
    else hits.push([s, e]);
    if (hits.reduce((a, [x, y]) => a + (y - x), 0) > cap) break;
  }
  // Prepend the release header — the period dateline ("13 weeks to 26 April 2026") lives at the top.
  const head = text.slice(0, 1400);
  if (!hits.length) return (head + "\n…\n" + text.slice(0, cap)).slice(0, cap);
  return (head + "\n…\n" + hits.map(([s, e]) => text.slice(s, e)).join("\n…\n")).slice(0, cap);
}

const SYSTEM =
  "You extract the COMPARABLE / LIKE-FOR-LIKE (LFL) sales metric from a UK/European retailer's RNS trading statement or results release. Return the headline TOTAL-GROUP like-for-like figure for the MOST RECENT REPORTED PERIOD, on a ONE-YEAR basis. Rules: " +
  "Prefer the QUARTERLY trading-update figure (a ~13-week / Q1 / Q3 / first-quarter / third-quarter period) when the release shows one; only use a half-year/full-year LFL if no quarterly figure is given. NEVER return a full-year or year-to-date figure when a quarter is shown. " +
  "'comp' = total-group LFL % change, SIGNED (e.g. 3.4 or -1.2). UK/EU phrasings all count: 'like-for-like', 'LFL', 'comparable store sales', 'full price sales' (Next's measure), 'organic sales/revenue growth'. If a TOTAL/GROUP LFL is given alongside divisional ones, put the GROUP total in 'comp' and the divisions in 'segments'. " +
  "Do NOT return total sales growth, total revenue growth, or space/new-store contribution — ONLY the like-for-like / comparable / full-price figure. " +
  "'basis': '1yr' for a normal LFL; 'ex-fx'|'2yr-stack'|'reported' otherwise. Most UK LFL is reported (local-currency, ex-fuel where stated) — treat as '1yr'. " +
  "'metricLabel': the company's OWN verbatim term (e.g. 'Full price sales', 'Like-for-like sales (ex-fuel)', 'Comparable store sales'). 'definition': the disclosed measurement rule if stated, else null. " +
  "'periodEnd': the END date of that fiscal period, ISO YYYY-MM-DD ('13 weeks to 26 April 2026' → '2026-04-26'; 'quarter ended 3 May 2025' → '2025-05-03'). 'fiscalLabel': a SHORT label like 'Q1 FY27' (max 12 chars). " +
  "'traffic'/'ticket': transactions/volume and price/mix decomposition if disclosed (signed), else null. 'segments': by division/banner/region [{name,comp}] if disclosed, else []. 'twoYrStack': 2-year stacked LFL if disclosed, else null. " +
  "'quote': the VERBATIM sentence stating the headline LFL. If you cannot find one, set comp=null and quote=null — NEVER invent a number. 'confidence': 'high' (explicit statement) | 'medium' (prose/inferred) | 'low' (ambiguous). " +
  "If the document discloses NO like-for-like/comparable metric, return comp=null, segments=[], quote=null. Return a SINGLE JSON OBJECT, not an array. " + NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON (a single object): {"comp": number|null, "basis": string, "metricLabel": string|null, "definition": string|null, "periodEnd": string|null, "fiscalLabel": string|null, "traffic": number|null, "ticket": number|null, "segments": [{"name": string, "comp": number}], "twoYrStack": number|null, "quote": string|null, "confidence": string}';

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isCompMetric = (label?: string | null) =>
  !!label && /like.?for.?like|\blfl\b|compar|same.?(store|shop)|full.?price sales|identical|organic/i.test(label);

interface Extracted extends Omit<SssPeriod, "fpEnd" | "source"> { periodEnd?: string | null; quote?: string | null }

async function extract(sym: string, text: string, metricHint: string): Promise<Extracted | null> {
  const raw = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\nThe issuer's comp metric is typically: "${metricHint}".\n\nTrading-statement text for ${sym}:\n${grepWindows(text)}`, {
    model: PRO_MODEL,
    maxTokens: MAXTOK,
    reasoningEffort: "low",
  });
  if (!raw) return null;
  const o = Array.isArray(raw) ? raw[0] : raw;
  if (!o || typeof o !== "object") return null;
  let comp = num(o.comp);
  const basis = typeof o.basis === "string" ? o.basis : "1yr";
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

(async () => {
  if (!(await llmConfigured())) { console.error("✗ no LLM key (OPENROUTER_API_KEY). Aborting."); process.exit(1); }
  const data: SssData = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { generatedAt: "", byTicker: {} };
  let roster = INTL_COMPS;
  if (ONLY.length) roster = roster.filter((c) => ONLY.includes(c.lse) || ONLY.includes(c.yahoo));
  console.log(`intl comps: ${roster.length} names · mode=${BACKFILL ? `backfill ${BACKFILL}` : "incremental"}`);

  let touched = 0, calls = 0;
  for (const c of roster) {
    try {
      const docs = await getLatestUkResults(c.lse, TAKE);
      if (!docs.length) { console.log(`  ${c.lse}: no results RNS found`); continue; }
      const prior = data.byTicker[c.yahoo];
      const targets = BACKFILL ? docs : (prior?.lastAccession === docs[0].id ? [] : docs.slice(0, 1));
      if (!targets.length) { console.log(`  ${c.lse}: up to date (${docs[0].title})`); continue; }

      const periods: SssPeriod[] = BACKFILL ? [] : [...(prior?.periods ?? [])];
      for (const doc of targets) {
        const ex = await extract(c.yahoo, doc.text, c.metricHint); calls++;
        if (!ex) { console.log(`  ${c.lse} "${doc.title}": extract failed`); await sleep(150); continue; }
        const fpEnd = ex.periodEnd && !Number.isNaN(Date.parse(ex.periodEnd)) ? ex.periodEnd : null;
        if (!fpEnd) { console.log(`  ${c.lse} "${doc.title}": no period-end → skip (comp ${ex.comp})`); await sleep(150); continue; }
        const { periodEnd, quote, ...rest } = ex;
        const period: SssPeriod = { fpEnd, ...rest, source: { form: "RNS", url: doc.url, date: fpEnd, quote: quote ?? null } };
        const ix = periods.findIndex((p) => p.fpEnd === fpEnd);
        if (ix >= 0) periods[ix] = period; else periods.push(period);
        console.log(`  ${c.lse} ${ex.fiscalLabel || fpEnd}: comp ${ex.comp ?? "—"}%${ex.traffic != null ? ` (T ${ex.traffic}/Tk ${ex.ticket})` : ""}${ex.segments?.length ? ` · ${ex.segments.length} seg` : ""} [${ex.confidence}]`);
        await sleep(150);
      }
      periods.sort((a, b) => b.fpEnd.localeCompare(a.fpEnd));
      const newest = periods.find((p) => p.metricLabel) || periods[0];
      if (periods.length) {
        data.byTicker[c.yahoo] = {
          metricLabel: newest?.metricLabel || c.metricHint,
          definition: newest?.definition ?? null,
          lastAccession: docs[0].id,
          industry: c.industry,
          region: c.region,
          periods: periods.slice(0, 16),
        } as SssTicker;
        touched++;
      }
    } catch (e: any) {
      console.log(`  ${c.lse}: ERROR ${String(e?.message || e).slice(0, 120)}`);
    }
    data.generatedAt = new Date().toISOString();
    writeFileSync(OUT, JSON.stringify(data));
  }

  data.generatedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(data));
  console.log(`\nWrote ${OUT} · ${touched} intl names updated · ${calls} LLM calls · ${Object.keys(data.byTicker).length} total in file`);
})();
