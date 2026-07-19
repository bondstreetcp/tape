import { NextRequest, NextResponse } from "next/server";
import { promises as fsp } from "fs";
import path from "path";
import { tickerToCik } from "@/lib/edgar";
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "@/lib/llm";
import { section, clean, strList, norm, phraseGrounded } from "@/lib/filingSections";
import { gatherForm10, gather10K } from "@/lib/spinoffFilings";
import { listDocs, normTicker } from "@/lib/research/store";
import { pipelineParentTicker, type SpinoffsData, type SpinPipelineRow } from "@/lib/spinoffs";
import type { TwoEntityPreview, SpinEntity, SpinMechanics } from "@/lib/spinoffPreview";
import { raceTimeout } from "@/lib/earningsPreview";
import type { StoredDoc } from "@/lib/research/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// TWO-ENTITY spin preview — "run a report on the two." A spin creates two investable entities, but the
// Form 10 speaks only for the SpinCo and the RemainCo never files one. This route fuses:
//   1. the SpinCo's Form 10 (business + separation mechanics + pro-forma),
//   2. the PARENT's own 10-K (the to-be-spun segment's financials live in ITS segment note, and the
//      RemainCo is the parent minus that segment),
//   3. the ingested Research Desk corpus on the parent, when present (broker/analyst-day notes carry
//      the standalone economics — margins vs inventory turns vs ROE — that filings rarely frame).
// Grounding, honestly stated: CODE verifies the mechanics DATES (substring-grounded against the Form
// 10 text — a wrong date is worse than no date) and requires researchRead to NAME an ingested source;
// the ratio/financials/narrative fields rely on the prompt's verbatim-with-source discipline (like the
// sibling briefing routes), clearly labelled in the UI as the issuers'/brokers' own accounts.

const SYSTEM =
  "You brief a professional investor on an upcoming SPIN-OFF as TWO investable entities, side by side, using ONLY the supplied texts: the SpinCo's SEC Form 10, the parent's 10-K, and (when present) ingested broker/analyst-day research notes. Return JSON. " +
  "mechanics: {ratio, recordDate, distributionDate, whenIssued, note} — the distribution terms VERBATIM-ish from the Form 10 (e.g. '1 SpinCo share per 2 parent shares held', 'record date July 20, 2026'); null anything the texts don't state. " +
  "remainco / spinco — for EACH entity: whatItIs (2-3 plain sentences; the remainco = the parent MINUS the spun business), " +
  "financials (segment/standalone revenue + margin figures copied from the texts, each labelled with its source, e.g. 'FY25 segment revenue $X.XB, operating margin ~Y% (parent 10-K)'; null if not stated), " +
  "economics (the BUSINESS-MODEL economics: margin structure, capital/inventory intensity, growth drivers, returns — e.g. a distribution business runs thin margins but fast inventory turns and high returns on capital; use the research notes for return-on-capital framing when supplied, labelled), " +
  "whyOwnIt (the investor case for THIS piece), risks (2-4 short phrases that most matter for THIS piece). " +
  "contrast: 3-4 sentences directly comparing the two — who gets the growth, who gets the margin, who gets the balance-sheet load, and what kind of buyer each suits. This is the heart of the brief. " +
  "watchItems: 2-4 concrete things to track into and after the distribution (indexing flows, when-issued levels, initial guidance, leverage). " +
  "researchRead: ONLY if research notes are supplied — 2-3 sentences on what the notes ADD beyond the filings (analyst-day targets, standalone margin/ROE frames, ratings), citing the firm; null if no notes are supplied. " +
  "CRITICAL: use ONLY the supplied texts. Never invent a figure, date, ratio, or claim. Label every figure's source. Where the texts are silent, return null rather than guessing. " +
  NO_ADVICE;

const SCHEMA =
  '\n\nReturn ONLY JSON with EXACTLY these keys: {"mechanics":{"ratio":string|null,"recordDate":string|null,"distributionDate":string|null,"whenIssued":string|null,"note":string|null}|null,' +
  '"remainco":{"whatItIs":string|null,"financials":string|null,"economics":string|null,"whyOwnIt":string|null,"risks":string[]}|null,' +
  '"spinco":{"whatItIs":string|null,"financials":string|null,"economics":string|null,"whyOwnIt":string|null,"risks":string[]}|null,' +
  '"contrast":string|null,"watchItems":string[],"researchRead":string|null}';

// Compact research digest (the preprint pattern): structured fields only, newest-first, capped.
function researchDigest(docs: StoredDoc[]): string {
  return docs.slice(0, 6).map((d) => {
    const est = d.estimates.slice(0, 6).map((e) => `${e.metric} ${e.period}: ${e.value ?? "?"}${e.unit ?? ""}${e.vsConsensus ? ` [${e.vsConsensus}]` : ""}`).join("; ");
    return [
      `### ${d.source} — ${d.publishDate} — ${d.rating ?? "research"}${d.priceTarget != null ? ` — PT $${d.priceTarget}` : ""}`,
      `Thesis: ${d.thesis.slice(0, 4).join(" | ")}`,
      d.managementInsights?.length ? `Management/analyst-day color: ${d.managementInsights.slice(0, 4).join(" | ")}` : "",
      est ? `Estimates: ${est}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n").slice(0, 12_000);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ cik: string }> }) {
  const { cik: cikRaw } = await params;
  const cik = String(cikRaw).replace(/\D/g, "").padStart(10, "0");
  const base = (extra: Partial<TwoEntityPreview>): TwoEntityPreview =>
    ({ cik, parent: { name: "", ticker: null }, spinco: { name: "", ticker: null }, sources: [], hasResearch: false, mechanics: null, remainco: null, spincoEntity: null, contrast: null, watchItems: [], researchRead: null, ...extra });
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (!cik.replace(/0/g, "")) return NextResponse.json(base({ note: "Missing CIK." }), noStore);
  if (!(await llmConfigured())) return NextResponse.json(base({ note: "The preview needs the LLM configured." }), noStore);

  // Anchor on the pipeline row (the button only renders on pipeline rows, and it carries the grounded
  // spinco/parent names + the hand-verified parent-ticker override).
  const data = await fsp.readFile(path.join(process.cwd(), "data", "spinoffs.json"), "utf8").then((s) => JSON.parse(s) as SpinoffsData).catch(() => null);
  const row: SpinPipelineRow | undefined = (data?.pipeline ?? []).find((p) => p.cik.replace(/\D/g, "").padStart(10, "0") === cik);
  if (!row) return NextResponse.json(base({ note: "This filer isn't in the spin pipeline." }), noStore);
  const parentTicker = pipelineParentTicker(row);
  if (!row.parent || !parentTicker) return NextResponse.json(base({ spinco: { name: row.spinco, ticker: row.ticker }, note: "The parent's ticker isn't grounded yet — the two-entity view needs it to read the parent's own filings." }), noStore);

  // Every live fetch bounded (no platform ceiling on the self-hosted origin). t0 anchors HERE — before
  // the gathers — so the retry budget below accounts for gather time and the whole handler stays under
  // the ≤60s wall-clock ceiling (anchoring after the gathers let the worst case reach ~75s).
  // docs sentinel: null = the research store couldn't be checked in time (slow DB) — DISTINCT from []
  // (checked, genuinely empty), because the UI's "no notes ingested — upload them" hint must only show
  // when the corpus is KNOWN empty, and a raced-out check must not be cached as a thin success.
  const t0 = Date.now();
  const [form10, parent10K, docs] = await Promise.all([
    raceTimeout(gatherForm10(cik).catch(() => null), 20_000, null),
    raceTimeout(tickerToCik(parentTicker).then((c) => (c ? gather10K(c) : null)).catch(() => null), 20_000, null),
    raceTimeout(listDocs(normTicker(parentTicker)).catch(() => null as StoredDoc[] | null), 8_000, null as StoredDoc[] | null),
  ]);
  if (!form10 && !parent10K) return NextResponse.json(base({ parent: { name: row.parent, ticker: parentTicker }, spinco: { name: row.spinco, ticker: row.ticker }, note: "Neither the Form 10 nor the parent's 10-K yielded readable text from EDGAR." }), noStore);
  const docList = docs ?? [];

  // Section-window each source (the huge filings won't fit whole).
  const w = (text: string, re: RegExp, len: number, o: Parameters<typeof section>[3] = {}) => section(text, re, len, o);
  const f10 = form10
    ? [
      w(form10.text, /(reasons for the (separation|spin|distribution)|the separation|why .{0,12}separat)/i, 5000, { first: true }),
      // The distribution MECHANICS — ratio / record date / distribution date / when-issued market.
      w(form10.text, /(record date|distribution ratio|shares? of (our|spinco)? ?common stock for (each|every)|when[- ]issued)/i, 6000, { first: true, back: 400 }),
      w(form10.text, /\b(our business|business overview|overview\b|item\s*1\.?\s*business)/i, 12000, { first: true }),
      w(form10.text, /(unaudited pro forma|pro forma (combined|condensed)|capitalization)/i, 6000, { first: true }),
      w(form10.text, /\brisk factors\b/i, 7000, { scoreRe: /\bcompetit|customer|supplier|demand|leverage|indebted|separat/gi }),
    ].filter((x) => x.replace(/\s/g, "").length > 300).join("\n\n---\n\n")
    : "";
  const p10k = parent10K
    ? [
      w(parent10K.text, /\b(item\s*1\.?\s*business|business overview|our business)/i, 10000, { first: true }),
      // The segment note — where the to-be-spun business's ACTUAL revenue/profit live.
      w(parent10K.text, /(segment (results|information|reporting|data)|reportable segments?)/i, 10000, { scoreRe: /segment|revenue|operating (income|profit)|margin/gi }),
      w(parent10K.text, /(management.s discussion|results of operations)/i, 8000, { scoreRe: /segment|revenue|operating (income|profit)|margin|distribution|products/gi }),
    ].filter((x) => x.replace(/\s/g, "").length > 300).join("\n\n---\n\n")
    : "";
  const research = docList.length ? researchDigest(docList) : "";
  const packed = [
    f10 && `===== SPINCO FORM 10 (${row.spinco}, filed ${form10!.date}) =====\n${f10}`,
    p10k && `===== PARENT 10-K (${row.parent} / ${parentTicker}, filed ${parent10K!.date}) =====\n${p10k}`,
    research && `===== INGESTED RESEARCH NOTES on ${parentTicker} (broker/analyst-day) =====\n${research}`,
  ].filter(Boolean).join("\n\n").slice(0, 95_000);
  if (packed.replace(/\s/g, "").length < 3000) return NextResponse.json(base({ parent: { name: row.parent, ticker: parentTicker }, spinco: { name: row.spinco, ticker: row.ticker }, note: "The filings didn't yield the sections needed for a two-entity read." }), noStore);

  const ctx = `Spin-off: ${row.parent} (${parentTicker}) is separating ${row.spinco}${row.ticker ? ` (expected ticker ${row.ticker})` : ""}.${row.business ? ` The business being spun: ${row.business}.` : ""}\n\n${packed}${SCHEMA}`;
  // The model occasionally returns a parsed-but-EMPTY shell on this large context (observed live: two
  // null-shell replies, then two perfect ones, same prompt). chatJSON only retries parse failures, not
  // shape failures — so retry the SHAPE here, budget-aware against t0 (which includes the gathers, so
  // the whole handler is capped at ~55s + parse overhead — inside the ≤60s ceiling). The <25s gate
  // fires exactly when the null-shell happens: a fast, cheap first reply.
  const hasShape = (o: any) => !!(o && (clean(o.remainco?.whatItIs) || clean(o.spinco?.whatItIs) || clean(o.contrast) || clean(o.mechanics?.ratio)));
  let out = await raceTimeout(
    chatJSON<any>(SYSTEM, ctx, { model: PRO_MODEL, maxTokens: 6000, reasoningEffort: "low", retries: 1, timeoutMs: 35_000 }),
    38_000,
    null,
  );
  if (!hasShape(out) && Date.now() - t0 < 25_000) {
    const left = 55_000 - (Date.now() - t0);
    // The nudge only claims what was actually supplied — asserting "segment financials" when the
    // parent 10-K raced out would order the model to find content that isn't there.
    const supplied = [f10 && "the separation mechanics and the SpinCo's business (Form 10)", p10k && "the parent's business and segment financials (10-K)", research && "the broker notes"].filter(Boolean).join(", ");
    out = await raceTimeout(
      chatJSON<any>(SYSTEM, ctx + `\n\nYour previous reply was empty or off-schema. Populate the fields from the supplied texts — they contain ${supplied}.`, { model: PRO_MODEL, maxTokens: 6000, reasoningEffort: "low", retries: 1, timeoutMs: Math.min(30_000, Math.max(5_000, left - 2_000)) }),
      left,
      null,
    );
  }
  if (!out) return NextResponse.json(base({ parent: { name: row.parent, ticker: parentTicker }, spinco: { name: row.spinco, ticker: row.ticker }, note: "Preview generation failed — try again." }), noStore);

  const entity = (v: any, role: SpinEntity["role"], name: string, ticker: string | null): SpinEntity | null =>
    v && typeof v === "object"
      ? { name, ticker, role, whatItIs: clean(v.whatItIs), financials: clean(v.financials, 400), economics: clean(v.economics, 600), whyOwnIt: clean(v.whyOwnIt, 500), risks: strList(v.risks, null, 4) }
      : null;
  // Mechanics DATES are code-grounded: the exact date phrase must appear in the Form 10 text (via
  // phraseGrounded — a scattered-word match won't do). A hallucinated distribution date is worse than
  // no date. The ratio/whenIssued/note stay prompt-disciplined (their phrasing legitimately varies).
  const f10Norm = form10 ? norm(form10.text) : "";
  const groundedDate = (v: unknown): string | null => {
    const d = clean(v, 60);
    return d && f10Norm && phraseGrounded(d, f10Norm) ? d : null;
  };
  const mech: SpinMechanics | null = out.mechanics && typeof out.mechanics === "object"
    ? { ratio: clean(out.mechanics.ratio, 160), recordDate: groundedDate(out.mechanics.recordDate), distributionDate: groundedDate(out.mechanics.distributionDate), whenIssued: clean(out.mechanics.whenIssued, 200), note: clean(out.mechanics.note, 240) }
    : null;
  // researchRead must NAME one of the ingested sources — the cheap check that stops the model from
  // laundering filing facts into a "the research says" clause.
  const rr = docList.length ? clean(out.researchRead, 500) : null;
  const researchRead = rr && docList.some((d) => rr.toLowerCase().includes(d.source.toLowerCase().slice(0, 8))) ? rr : null;

  const resp = base({
    parent: { name: row.parent, ticker: parentTicker },
    spinco: { name: row.spinco, ticker: row.ticker },
    sources: [
      form10 && { label: `${row.spinco} Form 10`, url: form10.url, date: form10.date },
      parent10K && { label: `${row.parent} ${parent10K.form}`, url: parent10K.url, date: parent10K.date },
    ].filter(Boolean) as TwoEntityPreview["sources"],
    // null = the store couldn't be checked (raced out) — the client's "no notes ingested" hint only
    // renders on an explicit false.
    hasResearch: docs === null ? null : docList.length > 0,
    mechanics: mech && (mech.ratio || mech.recordDate || mech.distributionDate) ? mech : null,
    remainco: entity(out.remainco, "remainco", row.parent, parentTicker),
    spincoEntity: entity(out.spinco, "spinco", row.spinco, row.ticker),
    contrast: clean(out.contrast, 900),
    watchItems: strList(out.watchItems, null, 5),
    researchRead,
  });
  const any = resp.remainco?.whatItIs || resp.spincoEntity?.whatItIs || resp.contrast || resp.mechanics?.ratio;
  if (!any) resp.note = "The filings didn't yield an extractable two-entity read.";
  // Cache 3h ONLY when the read is COMPLETE (both filings + the research check resolved) — a degraded
  // read (one filing raced out, or the corpus couldn't be checked) is still returned but no-store, so
  // a transient hiccup never pins a thin/mislabelled read for 3h. Fresh research uploads enrich the
  // read same-day for the same reason. Failures are never cached.
  const complete = !!(form10 && parent10K && docs !== null);
  return NextResponse.json(resp, { headers: { "Cache-Control": any && complete ? "public, s-maxage=10800, stale-while-revalidate=86400" : "no-store" } });
}
