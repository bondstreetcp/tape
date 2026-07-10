import { NextRequest, NextResponse } from "next/server";
import { tickerToCik, getSubmissions, fetchWithRetry, htmlToText } from "@/lib/edgar";
import { chatJSON, FLASH_MODEL, NO_ADVICE, llmConfigured } from "@/lib/llm";
import { numberGroundedIn } from "@/lib/llmValidate";
import type { CompensationResponse, ExecComp, CompMetric, CompYear } from "@/lib/execComp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Executive & director compensation drilled from the company's own filings: the DEF 14A proxy
// (Summary Compensation Table = up to 3 years of history, CD&A = HOW pay is earned, perquisite
// footnotes, director table); S-1 for a recent IPO; Form 10 for a spin. GROUNDED like exec-bios:
// per-person rows must sit near that person's surname, every dollar figure must literally appear in
// the filing text, and anything undisclosed comes back null — never invented.

const SYSTEM =
  "You extract EXECUTIVE COMPENSATION data from a company's SEC filing text (a DEF 14A proxy, or the Executive Compensation section of an S-1 / Form 10) as JSON. " +
  "1) execs: each named executive officer in the Summary Compensation Table with EVERY fiscal year shown (up to 3): salary, bonus, stock awards, option awards, non-equity incentive plan compensation, all other compensation, total — exact dollar amounts as plain numbers (no $ or commas). Use null for a column the table doesn't show or leaves blank. " +
  "2) bonusMetrics: the ANNUAL cash incentive design from the Compensation Discussion & Analysis. Return the PERFORMANCE METRICS INSIDE the plan — never just the plan's name ('MIP'/'AIP' alone is WRONG). Each metric row = the measure itself (e.g. 'Organic revenue growth', 'Adjusted EBITDA', 'Free cash flow', 'Pre-tax income', 'Individual objectives') with its weighting % where stated and one short 'detail' note (target/threshold/max, or the plan it belongs to). " +
  "3) ltiMetrics: the LONG-TERM equity incentive design, same rule — the metrics INSIDE the PSU/performance plan (e.g. 'Relative TSR vs S&P 500', 'EPS CAGR', 'ROIC'), each with weighting % where stated and vesting terms in 'detail' (e.g. '3-year cliff'). Add one row per INSTRUMENT only to convey the mix (e.g. metric 'PSUs', detail '60% of LTI, 3-year performance period'). " +
  "4) payMix: one sentence on the disclosed pay mix / at-risk share, if stated. 5) perks: notable perquisites from the All Other Compensation footnotes (aircraft, security, financial planning, 401(k) match...) with who receives them. " +
  "6) directors: annual board cash retainer and annual equity grant value where stated, plus a short structure note. 7) sayOnPay: the most recent say-on-pay support percentage, if stated. " +
  "CRITICAL: copy ONLY what the text states — never estimate, compute, or use outside knowledge. Missing/undisclosed → null or empty array. Echo names exactly as printed. " +
  NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON: {"execs":[{"name":string,"title":string|null,"years":[{"year":number,"salary":number|null,"bonus":number|null,"stock":number|null,"options":number|null,"nonEquity":number|null,"other":number|null,"total":number|null}]}],' +
  '"bonusMetrics":[{"metric":string,"weightPct":number|null,"detail":string|null}],"ltiMetrics":[{"metric":string,"weightPct":number|null,"detail":string|null}],' +
  '"payMix":string|null,"perks":[{"who":string|null,"item":string}],"directors":{"cashRetainer":number|null,"equityAnnual":number|null,"note":string|null}|null,"sayOnPay":string|null}';

/** Fetch a filing's PRIMARY document as text — the FULL document (a proxy's comp tables sit ~page
 * 69, far beyond the default 80k-char cap that truncated them away entirely). */
async function fetchPrimary(cik: string, acc: string, doc: string): Promise<{ url: string; text: string } | null> {
  if (!doc) return null;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, "")}/${doc}`;
  try {
    const t = htmlToText(await (await fetchWithRetry(url)).text(), 1_500_000);
    return t.length > 1000 ? { url, text: t } : null;
  } catch { return null; }
}

/** Cut a window at the BEST match of `re` — proxies list every heading in a table of contents first,
 * so the first occurrence of "Summary Compensation Table" is usually the TOC line, ~60k chars before
 * the real table. Score each occurrence by the density of `scoreRe` in the following text and take
 * the densest: $-figures find TABLES, incentive words find the CD&A PROSE (weights/targets live in
 * prose, not tables). `back` pulls in narrative just before the heading (a director table's retainer
 * amounts are often described right above it). */
const DOLLARS = /\$\s?\d|\d{3},\d{3}/g;
const INCENTIVE_WORDS = /weight|target|payout|metric|threshold|maximum|performance measure|incentive/gi;
function section(text: string, re: RegExp, len: number, opts: { back?: number; scoreRe?: RegExp; first?: boolean; minScore?: number } = {}): string {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const scoreRe = opts.scoreRe ?? DOLLARS;
  let best: { i: number; score: number } | null = null;
  for (let m = g.exec(text); m; m = g.exec(text)) {
    const probe = text.slice(m.index, m.index + Math.min(len, 10000));
    const score = (probe.match(new RegExp(scoreRe.source, scoreRe.flags.includes("g") ? scoreRe.flags : scoreRe.flags + "g")) || []).length;
    // first-mode: the FIRST occurrence clearing the score floor is the real section START. Long
    // proxies repeat the section name as a page running-header every ~10k chars, so "densest
    // occurrence" can anchor MID-section (DAL: picked a page header 64k in → the window held only
    // the grants tables and none of the metric prose). TOC lines score ~0–1; a real start scores
    // higher because the section's own content follows it.
    if (opts.first) {
      if (score >= (opts.minScore ?? 3)) { best = { i: m.index, score }; break; }
    } else if (!best || score > best.score) best = { i: m.index, score };
    if (g.lastIndex === m.index) g.lastIndex++; // zero-width safety
  }
  return best ? text.slice(Math.max(0, best.i - (opts.back ?? 0)), best.i + len) : "";
}

/** Latest comp source: DEF 14A → S-1 (recent IPO) → Form 10 (spin). Returns targeted sections. */
async function gatherSource(symbol: string): Promise<{ url: string; date: string; form: string; text: string } | null> {
  const cik = await tickerToCik(symbol).catch(() => null);
  if (!cik) return null;
  const sub = await getSubmissions(cik).catch(() => null);
  const r = sub?.filings?.recent;
  if (!r?.form) return null;
  const latest = (forms: string[]) => {
    for (let i = 0; i < r.form.length; i++) if (forms.includes(r.form[i])) return { form: r.form[i], acc: r.accessionNumber[i], date: r.filingDate[i], doc: r.primaryDocument[i] };
    return null;
  };

  for (const forms of [["DEF 14A"], ["S-1/A", "S-1"], ["10-12B/A", "10-12B"]]) {
    const f = latest(forms);
    if (!f) continue;
    const ft = await fetchPrimary(cik, f.acc, f.doc);
    if (!ft || ft.text.length < 4000) continue;
    // Targeted windows — CD&A (the "how": scored by incentive-keyword density, weights live in
    // prose), the SCT + footnotes + directors (scored by $-density, they're tables).
    let text =
      section(ft.text, /compensation discussion (and|&) analysis/i, 90000, { scoreRe: INCENTIVE_WORDS, first: true }) +
      "\n\n" + section(ft.text, /summary compensation table/i, 16000, { back: 1000 }) +
      "\n\n" + section(ft.text, /all other compensation/i, 7000) +
      "\n\n" + section(ft.text, /\bdirector compensation\b/i, 9000, { back: 3000 }) +
      "\n\n" + section(ft.text, /say[- ]on[- ]pay/i, 3000, { scoreRe: /%/g });
    if (text.replace(/\s/g, "").length < 3000) text = section(ft.text, /executive compensation/i, 60000, { scoreRe: INCENTIVE_WORDS }) || ft.text.slice(0, 60000);
    return { url: ft.url, date: f.date, form: f.form, text };
  }
  return null;
}

// ── Grounding helpers (exec-bios doctrine, comp-shaped) ───────────────────────────────────────────
const surnameOf = (n: string) => n.toLowerCase().replace(/[.,]/g, "").trim().split(/\s+/).slice(-1)[0] ?? "";
/** Windows around each surname occurrence — SCT rows + footnotes sit close to the name. */
function nameWindows(textLower: string, surname: string, back = 300, fwd = 3500): [number, number][] {
  if (surname.length < 3) return [];
  const wins: [number, number][] = [];
  let i = textLower.indexOf(surname);
  while (i >= 0 && wins.length < 80) { wins.push([Math.max(0, i - back), i + fwd]); i = textLower.indexOf(surname, i + 1); }
  return wins;
}
const inWindows = (needle: string, textLower: string, wins: [number, number][]) => wins.some(([s, e]) => textLower.slice(s, e).includes(needle));
/** A metric/perk string is grounded when its distinctive words all appear in the filing text. */
function phraseGrounded(str: string, textLower: string): boolean {
  const words = str.toLowerCase().replace(/[^a-z0-9\s%-]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
  if (!words.length) return false;
  return words.every((w) => textLower.includes(w));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const base = (extra: Partial<CompensationResponse>): CompensationResponse =>
    ({ symbol: sym, source: null, execs: [], bonusMetrics: [], ltiMetrics: [], payMix: null, perks: [], directors: null, sayOnPay: null, ...extra });
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (!(await llmConfigured())) return NextResponse.json(base({ note: "Compensation extraction needs the LLM configured." }), noStore);
  const src = await gatherSource(sym);
  if (!src) return NextResponse.json(base({ note: "No proxy (DEF 14A), S-1 or Form 10 with compensation found on EDGAR." }), noStore);

  const prompt = `${SCHEMA}\n\nFILING TEXT (${src.form}, filed ${src.date}):\n${src.text}`;
  // reasoningEffort stays LOW: this is guarded schema extraction, and higher reasoning eats the
  // output budget and truncates the JSON (the refresh-desk-note incident class). maxTokens gives
  // the big multi-table answer real headroom instead.
  const ask = () => chatJSON<any>(SYSTEM, prompt, { model: FLASH_MODEL, maxTokens: 6000, reasoningEffort: "low" }).catch(() => null);
  let out = await ask();
  // Flash occasionally returns the tables but skips the CD&A metrics (or vice versa) — one retry
  // recovers most of that variance, and the 12h success-cache makes this a rare event.
  const thin = (o: any) => !o || !Array.isArray(o.execs) || !o.execs.length || ((!Array.isArray(o.bonusMetrics) || !o.bonusMetrics.length) && (!Array.isArray(o.ltiMetrics) || !o.ltiMetrics.length));
  if (thin(out)) {
    const retry = await ask();
    if (!out || (retry && !thin(retry))) out = retry ?? out;
  }
  if (!out) return NextResponse.json(base({ note: "Extraction failed — try again." }), noStore);

  const textLower = src.text.toLowerCase();
  const yrNow = new Date().getUTCFullYear();
  const gNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v !== 0 && numberGroundedIn(v, src.text) ? v : null);

  // Execs: name must appear in the text; every $ figure must ground in the FULL text AND (for the
  // row to survive) the year must sit near the person's name. Wrong beats missing — drop liberally.
  const execs: ExecComp[] = [];
  for (const e of Array.isArray(out.execs) ? out.execs : []) {
    if (!e?.name || typeof e.name !== "string") continue;
    const sn = surnameOf(e.name);
    const wins = nameWindows(textLower, sn);
    if (!wins.length) continue;
    const years: CompYear[] = [];
    for (const y of Array.isArray(e.years) ? e.years : []) {
      const year = typeof y?.year === "number" && y.year >= yrNow - 5 && y.year <= yrNow ? y.year : null;
      if (!year || !inWindows(String(year), textLower, wins)) continue;
      const row: CompYear = {
        year,
        salary: gNum(y.salary), bonus: gNum(y.bonus), stock: gNum(y.stock), options: gNum(y.options),
        nonEquity: gNum(y.nonEquity), other: gNum(y.other), total: gNum(y.total),
      };
      if (row.total != null || row.salary != null) years.push(row);
    }
    if (!years.length) continue;
    years.sort((a, b) => b.year - a.year);
    execs.push({ name: e.name.trim(), title: typeof e.title === "string" && e.title.trim() ? e.title.trim() : null, years: years.slice(0, 3) });
    if (execs.length >= 6) break;
  }

  const metrics = (arr: any): CompMetric[] =>
    (Array.isArray(arr) ? arr : [])
      .filter((m) => m && typeof m.metric === "string" && m.metric.trim() && phraseGrounded(m.metric, textLower))
      .map((m) => ({
        metric: m.metric.trim(),
        weightPct: typeof m.weightPct === "number" && m.weightPct > 0 && m.weightPct <= 100 && numberGroundedIn(m.weightPct, src.text) ? m.weightPct : null,
        detail: typeof m.detail === "string" && m.detail.trim() ? m.detail.trim().slice(0, 180) : null,
      }))
      .slice(0, 8);

  const perks = (Array.isArray(out.perks) ? out.perks : [])
    .filter((p: any) => p && typeof p.item === "string" && p.item.trim() && phraseGrounded(p.item, textLower))
    .map((p: any) => ({ who: typeof p.who === "string" && p.who.trim() ? p.who.trim() : null, item: p.item.trim().slice(0, 160) }))
    .slice(0, 8);

  const d = out.directors;
  const directors = d && typeof d === "object"
    ? { cashRetainer: gNum(d.cashRetainer), equityAnnual: gNum(d.equityAnnual), note: typeof d.note === "string" && d.note.trim() ? d.note.trim().slice(0, 200) : null }
    : null;

  const resp = base({
    source: { url: src.url, date: src.date, form: src.form },
    execs,
    bonusMetrics: metrics(out.bonusMetrics),
    ltiMetrics: metrics(out.ltiMetrics),
    payMix: typeof out.payMix === "string" && out.payMix.trim() && phraseGrounded(out.payMix, textLower) ? out.payMix.trim().slice(0, 240) : null,
    perks,
    directors: directors && (directors.cashRetainer != null || directors.equityAnnual != null || directors.note) ? directors : null,
    sayOnPay: typeof out.sayOnPay === "string" && out.sayOnPay.trim() && phraseGrounded(out.sayOnPay, textLower) ? out.sayOnPay.trim().slice(0, 120) : null,
  });
  const any = resp.execs.length || resp.bonusMetrics.length || resp.ltiMetrics.length;
  if (!any) resp.note = "The filing didn't yield extractable compensation tables.";
  // Comp changes annually → cache hard on success; never cache an empty/failed read.
  return NextResponse.json(resp, { headers: { "Cache-Control": any ? "public, s-maxage=43200, stale-while-revalidate=604800" : "no-store" } });
}
