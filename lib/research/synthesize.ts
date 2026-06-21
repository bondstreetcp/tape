/**
 * Turn a per-ticker stack of extracted research docs into (1) a deterministic consensus
 * (rating tally, price-target range, and the forward-EPS battleground that drives the PT
 * spread) and (2) an LLM narrative — consensus read, where the Street diverges, what to
 * watch into the catalyst, and what you might be missing. The deterministic part is exact;
 * the narrative adds the judgement.
 */
import type { StoredDoc, ResearchEstimate } from "./types";

const MODEL = () => process.env.GEMINI_MODEL || "gemini-2.5-pro";

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
      est ? `Estimates: ${est}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}

export async function synthesize(docs: StoredDoc[]): Promise<string | null> {
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY || docs.length === 0) return null;
  const ticker = docs[0].ticker;
  const system =
    `You are a buy-side analyst reading a stack of sell-side research notes on ${ticker}. Synthesize them — do NOT summarize each one. Use tight markdown sections:\n` +
    `**Consensus read** — the agreed-upon view (rating skew, PT range, the shared thesis) in 2-3 sentences.\n` +
    `**Where they diverge** — the real disagreements and the outlier(s); call out who is most/least aggressive and on what (especially the forward-EPS spread, which usually drives the PT spread more than the multiple).\n` +
    `**Into the catalyst** — what to watch at the next event and the specific bogey (guide vs Street vs these brokers).\n` +
    `**What you might be missing** — risks or datapoints the bulls underweight, or where consensus could be wrong; be a skeptic.\n` +
    `Be specific with numbers from the notes. Don't give a personal buy/sell recommendation.`;
  const prompt = `${system}\n\n=== NOTES ON ${ticker} ===\n${digest(docs)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: -1 } } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const j: any = await res.json();
  const out = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
  return out || null;
}

/** Full-text Q&A over the corpus: grounds the answer in the actual report PROSE (not just
 *  the extracted summary), so it can surface specifics the structured fields don't capture.
 *  RAG-lite — at a few notes per ticker the full text fits in context (capped, newest-first);
 *  a larger corpus would chunk + retrieve via pgvector. Falls back to a doc's digest if its
 *  full text wasn't stored. */
export async function searchCorpus(docs: StoredDoc[], question: string): Promise<string | null> {
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY || docs.length === 0) return null;
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
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: -1 } } }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const j: any = await res.json();
  return (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join(" ").trim() || null;
}
