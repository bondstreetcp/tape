/**
 * "Before the print" — the join between the INGESTED SELL-SIDE RESEARCH corpus and the earnings desk's
 * quant read, answering the actual question: does the functionally-private research ADD INFORMATION
 * VALUE beyond what's public/priced, and what does the blend say to do into the print?
 *
 * Doctrine: CODE decides, the model narrates. computePreprint() is a pure, documented rule set over
 * two explicitly separated axes —
 *   PUBLIC/PRICED: what anyone can see (Yahoo consensus lean, PT upside, revision breadth, the card's
 *   positioning lean, a sandbagging guidance history) — the baseline the research must beat.
 *   PRIVATE RESEARCH: what only the ingested notes carry (fresh ratings/PTs, explicit above/below-
 *   Street estimate stances, management/expert-access color, fresh re-ratings).
 * The headline is the informationValue verdict; the action ∈ add/trim/hedge/hold is derived from the
 * research lean with the options-richness read coloring HOW to express it. The LLM pass (narrate) only
 * explains the computed result — it can never change the label.
 *
 * The pure core takes narrow inputs (constructible in tests); the server wrapper adapts real docs/quant.
 */
import type { StoredDoc } from "./types";
import { signalsFor } from "./synthesize";
import { chatJSON, NO_ADVICE, PRO_MODEL } from "../llm";

export const RESEARCH_FRESH_D = 60; // a note older than this is stale context, not a live stance
const DAY = 86_400_000;
const clamp2 = (n: number): number => Math.max(-2, Math.min(2, n));
const sgn = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);

export interface AxisSignal { label: string; lean: -1 | 0 | 1 }

export interface InformationValue {
  noteCount: number; // all notes on the ticker
  freshCount: number; // notes ≤ RESEARCH_FRESH_D old — the live stances
  freshestNoteDate: string | null;
  mgmtColorCount: number; // direct management/expert-access takeaways across fresh notes
  divergences: string[]; // explicit above/below-Street estimate stances stated in fresh notes
  ptRevisions: number; // fresh notes that moved their price target
  verdict: "adds edge" | "confirms consensus" | "no incremental signal";
}

export interface PreprintRead {
  action: "add" | "trim" | "hedge" | "hold";
  confidence: "high" | "medium" | "low";
  researchScore: number; // -2..+2 — the private-research lean
  publicScore: number; // -2..+2 — the public/priced baseline
  researchAxis: AxisSignal[];
  publicAxis: AxisSignal[];
  infoValue: InformationValue;
  volNote: string | null; // how the options market colors the EXPRESSION of the action
}

/** The public/priced side, from data anyone has (Yahoo consensus + the card's own reads). */
export interface PublicInputs {
  recommendationMean: number | null; // Yahoo 1 (strong buy) … 5 (sell)
  targetMean: number | null;
  price: number | null;
  epsUp30d: number | null; // upcoming-quarter revision breadth
  epsDown30d: number | null;
  tradeLean: "bullish" | "bearish" | null; // the earnings card's positioning lean
  sandbagger: boolean | null; // beats-its-own-guide history (guides conservatively)
  richnessVerdict: "rich" | "cheap" | "fair" | null; // options implied vs realized move
  putsBid: boolean | null; // options skew: downside hedging bid
}

// Classify a rating EXCLUSIVELY: a compound/odd extraction matching both directions counts as neither
// (double-counting one doc on both sides fabricated a lean). Regexes cover the real broker vocab —
// incl. Accumulate/Top Pick/Conviction (bullish) and Cautious/Avoid (bearish).
const buyish = /buy|outperform|overweight|positive|accumulate|top pick|conviction|\badd\b/i;
const sellish = /sell|underperform|underweight|negative|reduce|cautious|avoid/i;
const rateClass = (r: string): 1 | -1 | 0 => {
  const b = buyish.test(r), s = sellish.test(r);
  return b && !s ? 1 : s && !b ? -1 : 0;
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; // true median — upper-middle on even counts biased the axis
};

export function computePreprint(docs: StoredDoc[], pub: PublicInputs, now = Date.now()): PreprintRead {
  const fresh = docs.filter((d) => now - Date.parse(d.publishDate) <= RESEARCH_FRESH_D * DAY && !Number.isNaN(Date.parse(d.publishDate)));
  const freshest = docs.map((d) => d.publishDate).filter((d) => !Number.isNaN(Date.parse(d))).sort().pop() ?? null;

  // ── research axis (fresh notes only — a stale stance is context, not a signal) ──
  const researchAxis: AxisSignal[] = [];
  const rated = fresh.filter((d) => d.rating);
  if (rated.length) {
    const cls = rated.map((d) => rateClass(d.rating!));
    const b = cls.filter((x) => x === 1).length, s = cls.filter((x) => x === -1).length;
    // The majority-side count must also EXCEED the other side — sell notes are rare enough that one
    // matters (n/3 threshold), but a perfectly split corpus must read neutral, not sellish.
    const lean = b >= Math.max(1, (2 * rated.length) / 3) && b > s ? 1 : s >= Math.max(1, rated.length / 3) && s > b ? -1 : 0;
    researchAxis.push({ label: `${b}/${rated.length} fresh notes rated buy-side${s ? `, ${s} sell-side` : ""}`, lean: lean as -1 | 0 | 1 });
  }
  const pts = fresh.filter((d) => d.priceTarget != null).map((d) => d.priceTarget!);
  if (pts.length && pub.price != null && pub.price > 0) {
    const med = median(pts);
    const up = med / pub.price - 1;
    researchAxis.push({ label: `broker PT median $${med} (${up >= 0 ? "+" : ""}${(up * 100).toFixed(0)}% vs price)`, lean: up >= 0.15 ? 1 : up <= 0 ? -1 : 0 });
  }
  const sigs = fresh.map(signalsFor);
  // |change| > 300% is the same unit-inconsistency guard signalsFor applies to estimates — one typo'd
  // prior PT ($10 → $150 = +1400%) must not fabricate the revision lean or an "adds edge" verdict.
  const ptRevs = sigs.filter((x) => x.ptChangePct != null && Math.abs(x.ptChangePct) >= 2 && Math.abs(x.ptChangePct) <= 300);
  if (ptRevs.length) {
    const net = ptRevs.reduce((a, x) => a + (x.ptChangePct as number), 0);
    researchAxis.push({ label: `${ptRevs.length} fresh PT revision(s), net ${net >= 0 ? "+" : ""}${net.toFixed(0)}%`, lean: Math.abs(net) >= 5 ? sgn(net) : 0 });
  }
  // Explicit above/below-Street stances in the notes' estimate rows — the sharpest divergence signal.
  const divergences: string[] = [];
  let divNet = 0;
  for (const d of fresh) {
    for (const e of d.estimates) {
      if (!e.vsConsensus) continue;
      if (/above|ahead/i.test(e.vsConsensus)) { divergences.push(`${d.source}: ${e.metric} ${e.period} ${e.vsConsensus}`); divNet++; }
      else if (/below|under/i.test(e.vsConsensus)) { divergences.push(`${d.source}: ${e.metric} ${e.period} ${e.vsConsensus}`); divNet--; }
    }
  }
  if (divergences.length) researchAxis.push({ label: `${divergences.length} explicit vs-Street estimate stance(s)`, lean: sgn(divNet) });
  const mgmtColorCount = fresh.reduce((a, d) => a + (d.managementInsights?.length ?? 0), 0);
  const researchScore = fresh.length ? clamp2(researchAxis.reduce((a, x) => a + x.lean, 0)) : 0;

  // ── public/priced axis — the baseline the research must beat ──
  const publicAxis: AxisSignal[] = [];
  if (pub.recommendationMean != null) publicAxis.push({ label: `Street consensus ${pub.recommendationMean.toFixed(1)} (1=strong buy…5=sell)`, lean: pub.recommendationMean <= 2.2 ? 1 : pub.recommendationMean >= 3.5 ? -1 : 0 });
  if (pub.targetMean != null && pub.price != null && pub.price > 0) {
    const up = pub.targetMean / pub.price - 1;
    publicAxis.push({ label: `consensus PT ${up >= 0 ? "+" : ""}${(up * 100).toFixed(0)}% vs price`, lean: up >= 0.15 ? 1 : up <= 0 ? -1 : 0 });
  }
  if (pub.epsUp30d != null && pub.epsDown30d != null && pub.epsUp30d + pub.epsDown30d > 0) {
    const lean = pub.epsUp30d > 2 * pub.epsDown30d ? 1 : pub.epsDown30d > 2 * pub.epsUp30d ? -1 : 0;
    publicAxis.push({ label: `estimate revisions ${pub.epsUp30d} up / ${pub.epsDown30d} down (30d)`, lean: lean as -1 | 0 | 1 });
  }
  if (pub.tradeLean) publicAxis.push({ label: `options positioning lean ${pub.tradeLean}`, lean: pub.tradeLean === "bullish" ? 1 : -1 });
  if (pub.sandbagger) publicAxis.push({ label: "beats its own guide (sandbagger)", lean: 1 });
  const publicScore = clamp2(publicAxis.reduce((a, x) => a + x.lean, 0));

  // ── the information-value verdict — the headline ──
  const verdict: InformationValue["verdict"] =
    fresh.length === 0 ? "no incremental signal"
      : mgmtColorCount + divergences.length + ptRevs.length > 0 ? "adds edge"
        : "confirms consensus";
  const infoValue: InformationValue = { noteCount: docs.length, freshCount: fresh.length, freshestNoteDate: freshest, mgmtColorCount, divergences: divergences.slice(0, 6), ptRevisions: ptRevs.length, verdict };

  // ── action — driven by the RESEARCH lean (the private edge is the thing being tested); the options
  // read colors the EXPRESSION. No fresh research → hold: this card never manufactures a research edge.
  let action: PreprintRead["action"];
  if (fresh.length === 0) action = "hold";
  else if (researchScore >= 1) action = "add";
  else if (researchScore <= -1) action = "trim";
  else if (pub.richnessVerdict === "rich" && pub.putsBid) action = "hedge"; // no directional edge; event risk priced AND bid → protect
  else action = "hold";

  // Agreement between the two axes raises conviction; disagreement is precisely the interesting case
  // (the private view fighting the priced setup) but warrants a smaller size — lower confidence.
  const aligned = sgn(researchScore) !== 0 && sgn(researchScore) === sgn(publicScore);
  const opposed = sgn(researchScore) !== 0 && sgn(publicScore) !== 0 && sgn(researchScore) !== sgn(publicScore);
  const confidence: PreprintRead["confidence"] =
    Math.abs(researchScore) >= 2 && aligned && fresh.length >= 2 ? "high" : opposed || fresh.length === 1 ? "low" : "medium";

  const volNote =
    pub.richnessVerdict === "rich" ? "Options price the move RICH vs history — express any add with defined risk; a premium-seller is paid to fade the move."
      : pub.richnessVerdict === "cheap" ? "Options price the move CHEAP vs history — owning the move (calls/straddle) is a favorable expression."
        : pub.richnessVerdict === "fair" ? "Options price the move roughly in line with history." : null;

  return { action, confidence, researchScore, publicScore, researchAxis, publicAxis, infoValue, volNote };
}

/** One PRO pass that NARRATES the computed read — grounded in the notes' theses + the quant line. The
 *  action label is code-owned; the model explains it and may flag tension, never override it. */
export async function narratePreprint(
  sym: string,
  read: PreprintRead,
  docs: StoredDoc[],
  sig: string,
  opts: { bounded?: boolean } = {},
): Promise<{ oneLiner: string; why: string } | null> {
  const fresh = docs.filter((d) => Date.now() - Date.parse(d.publishDate) <= RESEARCH_FRESH_D * DAY);
  const digest = (fresh.length ? fresh : docs.slice(0, 4)).map((d) =>
    `### ${d.source} — ${d.publishDate} — ${d.rating ?? "research"}${d.priceTarget != null ? ` — PT $${d.priceTarget}` : ""}\nThesis: ${d.thesis.slice(0, 4).join(" | ")}${d.managementInsights?.length ? `\nManagement/expert color: ${d.managementInsights.slice(0, 3).join(" | ")}` : ""}`,
  ).join("\n\n");
  const SYSTEM =
    "You are the desk's analyst explaining a pre-earnings positioning read that the terminal's RULES already computed. The action label and scores are FIXED — your job is the WHY: synthesize the research notes' theses against the quant setup into a tight rationale a PM can act on. If the research lean and the priced setup disagree, say so plainly — that tension is the point. " +
    "'oneLiner' = one sentence: the read in desk shorthand. 'why' = 3-5 sentences of grounded reasoning citing the specific notes (by firm) and quant signals. Never state a different action than the computed one. " +
    NO_ADVICE;
  const ctx =
    `Ticker ${sym}, reporting soon. COMPUTED READ (fixed): action=${read.action.toUpperCase()}, confidence=${read.confidence}, research lean ${read.researchScore >= 0 ? "+" : ""}${read.researchScore}, public lean ${read.publicScore >= 0 ? "+" : ""}${read.publicScore}, information value: ${read.infoValue.verdict}. ` +
    `Research signals: ${read.researchAxis.map((x) => x.label).join("; ") || "none"}. Public signals: ${read.publicAxis.map((x) => x.label).join("; ") || "none"}. ${read.volNote ?? ""}\n\n` +
    (sig ? `QUANT SIGNALS: ${sig.slice(0, 1200)}\n\n` : "") +
    `=== INGESTED RESEARCH NOTES ===\n${digest.slice(0, 12_000)}\n\n` +
    'Return ONLY JSON: {"oneLiner": string, "why": string}';
  const t = opts.bounded ? { retries: 2, timeoutMs: 35_000 } : {};
  const out = await chatJSON<{ oneLiner?: string; why?: string }>(SYSTEM, ctx, { maxTokens: 1600, model: PRO_MODEL, reasoningEffort: "low", ...t });
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return out && (s(out.why) || s(out.oneLiner)) ? { oneLiner: s(out.oneLiner), why: s(out.why) } : null;
}
