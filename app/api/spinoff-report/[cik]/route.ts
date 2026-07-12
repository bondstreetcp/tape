import { NextRequest, NextResponse } from "next/server";
import { getSubmissions, fetchWithRetry, htmlToText } from "@/lib/edgar";
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "@/lib/llm";
import type { SpinoffReport, SpinoffFinancials } from "@/lib/spinoffReport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A generalist's briefing drilled from the SpinCo's Form 10 (10-12B) — the registration statement is
// written to educate an investor who's never heard of the company, so it carries the whole picture.
// We section-window the Business / Industry / Competition / Customers / Suppliers / Separation / Risk
// parts of the (huge) information statement and let the PRO model synthesize a structured brief.
// GROUNDED: named competitors must appear in the filing; nothing is invented. It's the ISSUER'S own
// account — the honest framing the UI carries.

const SYSTEM =
  "You brief an INDUSTRY-GENERALIST investor on a company being spun off, using ONLY the text of its SEC Form 10 (10-12B) registration statement. The goal: get someone who doesn't know this industry up to speed fast. Return JSON. " +
  "whatItIs: 2-3 plain sentences on what the business actually does. whySpun: why the parent is separating it (the stated rationale). howItMakesMoney: the revenue model / main segments. " +
  "industry: 3-5 sentences on HOW THE INDUSTRY WORKS for a newcomer — its structure, what drives demand, size/growth if the filing states it, cyclicality, and the key dynamics. competitivePosition: where this company sits and what (if anything) differentiates it. " +
  "competitors: an array of the SPECIFIC competitors NAMED in the filing (company names only; [] if none named — never guess). customers: who buys (end-markets, and any customer-concentration the filing discloses). suppliers: the key inputs / suppliers and any commodity or single-source exposure. " +
  "moats: array of durable advantages the filing claims (scale, IP, switching costs, regulatory — short phrases). risks: array of the 3-6 industry/competitive/value-chain risks that most matter (short phrases, not boilerplate). watchItems: 2-4 concrete things a generalist should track from here. " +
  "financials: {revenue, growth, profitability, note} — copy the most recent figures VERBATIM from the filing (e.g. revenue '$1.24 billion (FY2025)', growth '+8% YoY', profitability 'operating margin ~15%'); null any you can't find. Note carve-out/pro-forma caveats. " +
  "CRITICAL: use ONLY what the filing states — never add outside knowledge, never invent a competitor, number, or market-share figure. This is the issuer's own account; write it faithfully, not promotionally. " +
  NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON: {"whatItIs":string|null,"whySpun":string|null,"howItMakesMoney":string|null,"industry":string|null,"competitivePosition":string|null,' +
  '"competitors":string[],"customers":string|null,"suppliers":string|null,"moats":string[],"risks":string[],"watchItems":string[],' +
  '"financials":{"revenue":string|null,"growth":string|null,"profitability":string|null,"note":string|null}|null}';

/** Cut a window at the densest occurrence of `re` (a Form 10's real section, not its table-of-contents
 * line) — scored by keyword density in the following text. `first` takes the first occurrence above a
 * score floor instead (for a section whose heading repeats as a running header). */
function section(text: string, re: RegExp, len: number, opts: { back?: number; scoreRe?: RegExp; first?: boolean; minScore?: number } = {}): string {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const scoreRe = opts.scoreRe ?? /\b(market|industry|customer|competitor|revenue|product|segment|demand|growth|supplier)\b/gi;
  let best: { i: number; score: number } | null = null;
  for (let m = g.exec(text); m; m = g.exec(text)) {
    const probe = text.slice(m.index, m.index + Math.min(len, 9000));
    const score = (probe.match(new RegExp(scoreRe.source, scoreRe.flags.includes("g") ? scoreRe.flags : scoreRe.flags + "g")) || []).length;
    if (opts.first) { if (score >= (opts.minScore ?? 4)) { best = { i: m.index, score }; break; } }
    else if (!best || score > best.score) best = { i: m.index, score };
    if (g.lastIndex === m.index) g.lastIndex++;
  }
  return best ? text.slice(Math.max(0, best.i - (opts.back ?? 0)), best.i + len) : "";
}

/** Latest Form 10 for a CIK → the info statement text (primary doc + the largest HTML exhibit, which
 * is where a spin's real disclosure lives), full-length (htmlToText's default cap hides deep sections). */
async function gatherForm10(cik: string): Promise<{ url: string; date: string; form: string; text: string; parent: string | null } | null> {
  const sub = await getSubmissions(cik).catch(() => null);
  const r = sub?.filings?.recent;
  if (!r?.form) return null;
  let idx = -1;
  for (let i = 0; i < r.form.length; i++) if (r.form[i] === "10-12B" || r.form[i] === "10-12B/A") { idx = i; break; }
  if (idx < 0) return null;
  const acc = r.accessionNumber[idx].replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}`;
  let text = "";
  try {
    const dir = await (await fetchWithRetry(`${base}/index.json`, 2)).json();
    const items: any[] = dir?.directory?.item || [];
    const htmls = items.filter((f) => /\.html?$/i.test(f.name) && !/^R\d+\.htm/i.test(f.name)).sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
    const picks = [...new Set([r.primaryDocument[idx], htmls[0]?.name].filter(Boolean))].slice(0, 2);
    for (const name of picks) {
      const res = await fetchWithRetry(`${base}/${name}`, 2).catch(() => null);
      if (res?.ok) text += "\n\n" + htmlToText(await res.text(), 1_200_000);
    }
  } catch { /* fall through */ }
  if (text.replace(/\s/g, "").length < 4000) return null;
  return { url: `${base}/${r.primaryDocument[idx]}`, date: r.filingDate[idx], form: r.form[idx], text, parent: null };
}

// Named competitors are a STRUCTURED list in the filing ("competitors are/include A, B and C.",
// "we compete with A, B and C.") — pull them by regex over the FULL text (grounded by construction,
// and robust to which window the section extractor happened to land on). Merged with the LLM's list.
function namedCompetitors(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:competitors\s+(?:are|include|:|such as(?: those)?)|\bcompete(?:s)?\s+(?:with|against))\s+([A-Z][^.]{5,260}?)\./g;
  // Reject possessive phrases and generic descriptors — "Enviri's business segments", "our other
  // divisions" etc. are separation-context noise, not named rivals.
  const bad = /['’]|\b(businesses?|segments?|operations?|subsidiar|affiliate|divisions?|portfolios?|products?|services?|markets?|industr|customers?|suppliers?|regions?)\b/i;
  for (let m = re.exec(text); m && out.size < 12; m = re.exec(text)) {
    for (const raw of m[1].split(/,|\band\b|\bas well as\b/)) {
      const name = raw.trim().replace(/^(the|other|various|certain|numerous|several|many|both|its|our)\s+/i, "").replace(/\s+(inc|corp|corporation|group|company|co|plc|ltd|systems)\.?$/i, "").trim();
      if (name.length >= 2 && name.length <= 46 && /^[A-Z0-9]/.test(name) && !bad.test(name) && !/^(we|our|its|their|his|her|they|companies|manufacturers?|distributors?|competitors?|others?|both|each|firms?|players?|vendors?|businesses)$/i.test(name)) out.add(name);
    }
  }
  return [...out];
}

const clean = (s: unknown, max = 900): string | null => (typeof s === "string" && s.trim() ? s.trim().slice(0, max) : null);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
/** A named entity is grounded when its distinctive words (≥4 chars) all appear in the filing text. */
function grounded(name: string, textLower: string): boolean {
  const words = norm(name).split(" ").filter((w) => w.length >= 4 && !["corporation", "company", "incorporated", "holdings", "group", "limited"].includes(w));
  if (!words.length) return norm(name).length >= 3 && textLower.includes(norm(name)); // short/acronym names
  return words.every((w) => textLower.includes(w));
}
const strList = (arr: unknown, textLower: string | null, cap: number, ground = false): string[] =>
  (Array.isArray(arr) ? arr : [])
    .map((x) => clean(x, 120))
    .filter((x): x is string => !!x && (!ground || !textLower || grounded(x, textLower)))
    .slice(0, cap);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ cik: string }> }) {
  const { cik: cikRaw } = await params;
  const cik = String(cikRaw).replace(/\D/g, "");
  const base = (extra: Partial<SpinoffReport>): SpinoffReport =>
    ({ cik, spinco: "", parent: null, source: null, whatItIs: null, whySpun: null, howItMakesMoney: null, industry: null, competitivePosition: null, competitors: [], customers: null, suppliers: null, moats: [], risks: [], watchItems: [], financials: null, ...extra });
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (!cik) return NextResponse.json(base({ note: "Missing CIK." }), noStore);
  if (!(await llmConfigured())) return NextResponse.json(base({ note: "The briefing needs the LLM configured." }), noStore);

  const src = await gatherForm10(cik);
  if (!src) return NextResponse.json(base({ note: "No Form 10 (10-12B) with readable text found on EDGAR for this filer." }), noStore);

  // Window the sections that matter for a generalist, then hand the PRO model the combined text.
  const s = (re: RegExp, len: number, o: Parameters<typeof section>[3] = {}) => section(src.text, re, len, o);
  const packed = [
    s(/(reasons for the (separation|spin|distribution)|the separation|why .{0,12}separat)/i, 6000, { first: true }),
    s(/\b(our business|business overview|overview\b|item\s*1\.?\s*business)/i, 16000, { first: true }),
    s(/\b(our industry|industry overview|market overview|industry background)/i, 12000, { first: true }),
    // The COMPETITION business section (where rivals are named), scored by competitive-discussion
    // density so it doesn't land on the generic "failure to compete" risk-factor block; plus a tight
    // window anchored right on the naming sentence ("we compete with…", "our competitors include…").
    s(/\bcompetiti(on|ve)\b/i, 11000, { scoreRe: /\bcompet|\brival|\bpeer|market (share|leader)|companies (such as|including|like|that)/gi }),
    s(/(we (primarily )?compete (with|against)|our (primary |principal |main )?competitors (include|are|such as)|principal competitors|competitors include)/i, 3500, { first: true, minScore: 1, back: 200 }),
    s(/\b(our customers|customers\b|customer concentration|end[- ]markets)/i, 5000),
    s(/\b(suppliers|raw materials|supply chain|sources? of supply)/i, 5000),
    s(/\brisk factors\b/i, 14000, { scoreRe: /\bcompetit|industry|customer|supplier|demand|cyclic|regulat|concentrat/gi }),
  ].filter((x) => x.replace(/\s/g, "").length > 300).join("\n\n=====\n\n").slice(0, 95000);
  if (packed.replace(/\s/g, "").length < 3000) return NextResponse.json(base({ source: { url: src.url, date: src.date, form: src.form }, note: "The Form 10 didn't yield the sections needed for a briefing." }), { headers: { "Cache-Control": "no-store" } });

  // reasoningEffort low keeps this LIVE call inside the 60s function budget; the detailed prompt
  // guides the extraction. PRO model — this is analytical synthesis, not mechanical extraction.
  const out = await chatJSON<any>(SYSTEM, `Form 10 for CIK ${cik} (filed ${src.date}):\n\n${packed}\n\n${SCHEMA}`, { model: PRO_MODEL, maxTokens: 5000, reasoningEffort: "low" }).catch(() => null);
  if (!out) return NextResponse.json(base({ source: { url: src.url, date: src.date, form: src.form }, note: "Briefing generation failed — try again." }), { headers: { "Cache-Control": "no-store" } });

  const textLower = src.text.toLowerCase();
  const fin = out.financials && typeof out.financials === "object"
    ? ({ revenue: clean(out.financials.revenue, 80), growth: clean(out.financials.growth, 80), profitability: clean(out.financials.profitability, 100), note: clean(out.financials.note, 200) } as SpinoffFinancials)
    : null;

  const resp = base({
    source: { url: src.url, date: src.date, form: src.form },
    whatItIs: clean(out.whatItIs),
    whySpun: clean(out.whySpun),
    howItMakesMoney: clean(out.howItMakesMoney),
    industry: clean(out.industry, 1400),
    competitivePosition: clean(out.competitivePosition),
    // Code-extracted named rivals (grounded by construction) first, then any GROUNDED extras the LLM
    // found — deduped case-insensitively. Both are backed by the filing text; nothing invented.
    competitors: (() => {
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const c of [...namedCompetitors(src.text), ...strList(out.competitors, textLower, 12, true)]) {
        const k = c.toLowerCase();
        if (!seen.has(k)) { seen.add(k); merged.push(c); }
      }
      return merged.slice(0, 12);
    })(),
    customers: clean(out.customers),
    suppliers: clean(out.suppliers),
    moats: strList(out.moats, null, 6),
    risks: strList(out.risks, null, 8),
    watchItems: strList(out.watchItems, null, 5),
    financials: fin && (fin.revenue || fin.growth || fin.profitability) ? fin : null,
  });
  const any = resp.whatItIs || resp.industry || resp.competitors.length;
  if (!any) resp.note = "The Form 10 didn't yield an extractable briefing.";
  // Form 10s change rarely (amendments over months) → cache hard on success; never cache a failure.
  return NextResponse.json(resp, { headers: { "Cache-Control": any ? "public, s-maxage=86400, stale-while-revalidate=1209600" : "no-store" } });
}
