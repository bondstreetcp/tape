/**
 * Turn a per-ticker stack of extracted research docs into (1) a deterministic consensus
 * (rating tally, price-target range, and the forward-EPS battleground that drives the PT
 * spread) and (2) an LLM narrative — consensus read, where the Street diverges, what to
 * watch into the catalyst, and what you might be missing. The deterministic part is exact;
 * the narrative adds the judgement.
 */
import type { StoredDoc, ResearchEstimate } from "./types";
import { searchChunks, getDoc } from "./store";
import { embedQuery } from "./embed";
import { chatText, NO_ADVICE } from "../llm";

export interface MetricRow { source: string; date: string; value: number | null; priorValue: number | null; unit: string | null; vsConsensus: string | null }
export interface Consensus {
  docCount: number;
  ratings: { rating: string; count: number }[];
  priceTargets: { source: string; date: string; target: number; prior: number | null }[];
  ptStats: { min: number; max: number; median: number } | null;
  battlegrounds: { label: string; rows: MetricRow[] }[]; // e.g. FY27 EPS, F3Q26 Rev
  entitlements: string[]; // distinct watermarks present
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function pick(doc: StoredDoc, metricRe: RegExp, periodRe: RegExp): ResearchEstimate | undefined {
  return doc.estimates.find((e) => metricRe.test(e.metric) && periodRe.test(e.period));
}

function battleground(docs: StoredDoc[], label: string, metricRe: RegExp, periodRe: RegExp): { label: string; rows: MetricRow[] } | null {
  const rows: MetricRow[] = [];
  for (const d of docs) {
    const e = pick(d, metricRe, periodRe);
    if (e && e.value != null) rows.push({ source: d.source, date: d.publishDate, value: e.value, priorValue: e.priorValue, unit: e.unit ?? null, vsConsensus: e.vsConsensus });
  }
  return rows.length >= 2 ? { label, rows } : null;
}

export function consensus(docs: StoredDoc[]): Consensus {
  const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const ratingMap = new Map<string, number>();
  for (const d of docs) if (d.rating) ratingMap.set(titleCase(d.rating), (ratingMap.get(titleCase(d.rating)) ?? 0) + 1);
  const pts = docs.filter((d) => d.priceTarget != null).map((d) => ({ source: d.source, date: d.publishDate, target: d.priceTarget!, prior: d.priceTargetPrior }));
  const ptVals = pts.map((p) => p.target);
  const bg = [
    battleground(docs, "FY27 / CY27 EPS", /EPS/i, /FY27|CY27|F27|C27/i),
    battleground(docs, "FY26 EPS", /EPS/i, /FY26|F26/i),
    battleground(docs, "Next-quarter EPS", /EPS/i, /F3Q|3Q|MayQ|FQ3/i),
    battleground(docs, "Next-quarter revenue", /Rev/i, /F3Q|3Q|MayQ|FQ3/i),
  ].filter(Boolean) as { label: string; rows: MetricRow[] }[];
  return {
    docCount: docs.length,
    ratings: [...ratingMap.entries()].map(([rating, count]) => ({ rating, count })).sort((a, b) => b.count - a.count),
    priceTargets: pts.sort((a, b) => b.target - a.target),
    ptStats: ptVals.length ? { min: Math.min(...ptVals), max: Math.max(...ptVals), median: median(ptVals) } : null,
    battlegrounds: bg,
    entitlements: [...new Set(docs.map((d) => d.entitlement).filter(Boolean) as string[])],
  };
}

/** Compact each doc to the fields the synthesis model needs (keeps the prompt small). */
function digest(docs: StoredDoc[]): string {
  return docs.map((d) => {
    const est = d.estimates.slice(0, 8).map((e) => `${e.metric} ${e.period}: ${e.value ?? "?"}${e.unit ?? ""}${e.priorValue != null ? ` (was ${e.priorValue})` : ""}${e.vsConsensus ? ` [${e.vsConsensus}]` : ""}`).join("; ");
    return [
      `### ${d.source} — ${d.publishDate} — ${d.rating ?? "research"}${d.priceTarget != null ? ` — PT $${d.priceTarget}${d.priceTargetPrior != null ? ` (was $${d.priceTargetPrior})` : ""}` : ""}`,
      d.targetBasis ? `Target basis: ${d.targetBasis}` : "",
      `Thesis: ${d.thesis.join(" | ")}`,
      d.risks.length ? `Risks: ${d.risks.join(" | ")}` : "",
      d.catalysts.length ? `Catalysts: ${d.catalysts.join(" | ")}` : "",
      d.managementInsights?.length ? `Management/expert color: ${d.managementInsights.join(" | ")}` : "",
      est ? `Estimates: ${est}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

export async function synthesize(docs: StoredDoc[]): Promise<string | null> {
  if (docs.length === 0) return null;
  const ticker = docs[0].ticker;
  const system =
    `You are a buy-side analyst reading a stack of sell-side research notes on ${ticker}. Synthesize them — do NOT summarize each one. Use tight markdown sections:\n` +
    `**Consensus read** — the agreed-upon view (rating skew, PT range, the shared thesis) in 2-3 sentences.\n` +
    `**Where they diverge** — the real disagreements and the outlier(s); call out who is most/least aggressive and on what (especially the forward-EPS spread, which usually drives the PT spread more than the multiple).\n` +
    `**Into the catalyst** — what to watch at the next event and the specific bogey (guide vs Street vs these brokers).\n` +
    `**What you might be missing** — risks or datapoints the bulls underweight, or where consensus could be wrong; be a skeptic.\n` +
    `Be specific with numbers from the notes. Don't give a personal buy/sell recommendation.`;
  const prompt = `=== NOTES ON ${ticker} ===\n${digest(docs)}`;
  const out = await chatText(system, prompt, { temperature: 0.3, maxTokens: 8192 });
  return out || null;
}

/** Full-text Q&A over the corpus: grounds the answer in the actual report PROSE (not just
 *  the extracted summary), so it can surface specifics the structured fields don't capture.
 *  RAG-lite — at a few notes per ticker the full text fits in context (capped, newest-first);
 *  a larger corpus would chunk + retrieve via pgvector. Falls back to a doc's digest if its
 *  full text wasn't stored. */
export async function searchCorpus(docs: StoredDoc[], question: string): Promise<string | null> {
  if (docs.length === 0) return null;
  const ticker = docs[0].ticker;
  let budget = 170_000; // ~43k tokens of report text across the ticker's notes
  const blocks: string[] = [];
  for (const d of docs) { // newest-first
    const body = (d.text && d.text.length > 200) ? d.text.slice(0, 55_000) : digest([d]);
    if (budget - body.length < 0 && blocks.length) break;
    blocks.push(`=== ${d.source} — ${d.publishDate} — ${d.title} ===\n${body}`);
    budget -= body.length;
  }
  const prompt =
    `You are a buy-side analyst answering a question using ONLY the ${ticker} research reports below. ` +
    `Ground every claim in the reports and attribute it to the source firm; quote a short phrase where it sharpens the point. ` +
    `Synthesize across reports where they agree or disagree. If the reports don't address the question, say so plainly.\n\n` +
    `Question: ${question}\n\n${blocks.join("\n\n")}`;
  const out = await chatText("You are a buy-side equity-research analyst. " + NO_ADVICE, prompt, { temperature: 0.2, maxTokens: 4096 });
  return out || null;
}

// ---- Idea generation: cross-corpus actionable signals -----------------------------

export interface DocSignal {
  id: string; ticker: string; company: string; source: string; date: string;
  rating: string | null; ratingChanged: boolean;
  pt: number | null; ptChangePct: number | null;
  topRevision: { metric: string; period: string; changePct: number } | null;
  mgmtColor: number; // # of management/expert takeaways
  score: number;     // movement / conviction score for ranking
}

const pctChange = (v: number, prior: number) => (prior ? (v / prior - 1) * 100 : 0);

export function signalsFor(d: StoredDoc): DocSignal {
  const ptChangePct = d.priceTarget != null && d.priceTargetPrior ? pctChange(d.priceTarget, d.priceTargetPrior) : null;
  const ratingChanged = !!(d.rating && d.ratingPrior && d.rating.toLowerCase() !== d.ratingPrior.toLowerCase());
  let topRevision: DocSignal["topRevision"] = null;
  for (const e of d.estimates) {
    if (e.value != null && e.priorValue) {
      const ch = pctChange(e.value, e.priorValue);
      if (!topRevision || Math.abs(ch) > Math.abs(topRevision.changePct)) topRevision = { metric: e.metric, period: e.period, changePct: ch };
    }
  }
  const mgmtColor = d.managementInsights?.length ?? 0;
  const score = Math.max(Math.abs(ptChangePct ?? 0), Math.abs(topRevision?.changePct ?? 0)) + (ratingChanged ? 60 : 0) + mgmtColor * 12;
  return { id: d.id, ticker: d.ticker, company: d.company, source: d.source, date: d.publishDate, rating: d.rating, ratingChanged, pt: d.priceTarget, ptChangePct, topRevision, mgmtColor, score };
}

/** Every note ranked by how hard it's moving / how much conviction it carries. */
export function actionableSignals(docs: StoredDoc[]): DocSignal[] {
  return docs.map(signalsFor).sort((a, b) => b.score - a.score);
}

/** Idea-generation pass across the WHOLE corpus: what's actionable and why. */
export async function actionableScan(docs: StoredDoc[]): Promise<string | null> {
  if (docs.length === 0) return null;
  const lines = actionableSignals(docs).map((s) => "- " + [
    `${s.ticker} — ${s.source} (${s.date}) — ${s.rating ?? "research"}`,
    s.ptChangePct != null ? `PT ${s.ptChangePct >= 0 ? "+" : ""}${s.ptChangePct.toFixed(0)}% to $${s.pt}` : "",
    s.ratingChanged ? "RATING CHANGED" : "",
    s.topRevision ? `${s.topRevision.metric} ${s.topRevision.period} revised ${s.topRevision.changePct >= 0 ? "+" : ""}${s.topRevision.changePct.toFixed(0)}%` : "",
    s.mgmtColor ? `${s.mgmtColor} management/expert takeaway(s)` : "",
  ].filter(Boolean).join("; "));
  const color = docs.filter((d) => d.managementInsights?.length).map((d) => `${d.ticker} (${d.source}): ${d.managementInsights.join(" | ")}`);
  const prompt =
    `You are a buy-side PM scanning sell-side research for IDEA GENERATION. From the signals below, surface the most ACTIONABLE items — names where the Street is re-rating hard (large price-target or estimate revisions, rating changes), where management/expert access adds conviction, or where there's a sharp debate/outlier worth a look. Be selective and rank by actionability. For each: **Ticker** — the signal in one line — why it's actionable — and the one thing to check next. End with any cross-cutting theme.\n\n` +
    `=== SIGNALS (pre-ranked by movement) ===\n${lines.join("\n")}\n\n` +
    (color.length ? `=== MANAGEMENT / EXPERT COLOR ===\n${color.join("\n")}\n` : "");
  const out = await chatText("You are a buy-side PM scanning sell-side research for idea generation. " + NO_ADVICE, prompt, { temperature: 0.3, maxTokens: 4096 });
  return out || null;
}

// ---- Semantic search across the whole corpus (pgvector retrieval) ------------------

export interface SearchHit { docId: string; ticker: string; source: string; date: string; snippet: string; score: number }

/** Embed the query, retrieve the most relevant passages across ALL notes (or one ticker),
 *  and answer grounded in them with source citations. The cross-corpus idea-gen surface:
 *  "find me research that says X" regardless of which name it's filed under. */
export async function corpusSearch(query: string, ticker?: string): Promise<{ answer: string | null; hits: SearchHit[] }> {
  const qe = await embedQuery(query);
  if (!qe) return { answer: null, hits: [] };
  const chunks = await searchChunks(qe, ticker, 14);
  if (!chunks.length) return { answer: null, hits: [] };
  const ids = [...new Set(chunks.map((c) => c.docId))];
  const docs = await Promise.all(ids.map((id) => getDoc(id)));
  const byId = new Map(docs.filter(Boolean).map((d) => [d!.id, d!]));
  const hits: SearchHit[] = chunks.map((c) => {
    const d = byId.get(c.docId);
    return { docId: c.docId, ticker: c.ticker, source: d?.source || "?", date: d?.publishDate || "", snippet: c.text, score: c.score };
  });
  const ctx = hits.map((h, i) => `[${i + 1}] ${h.ticker} · ${h.source} (${h.date}):\n${h.snippet}`).join("\n\n");
  const prompt =
    `Answer the question using ONLY these research passages retrieved from across the corpus. Cite the ticker + source firm for each point; synthesize where multiple passages bear on it. If they don't address the question, say so.\n\n` +
    `Question: ${query}\n\n=== PASSAGES ===\n${ctx}`;
  const answer = await chatText("You are a buy-side equity-research analyst. " + NO_ADVICE, prompt, { temperature: 0.2, maxTokens: 3072 });
  return { answer: answer || null, hits };
}
