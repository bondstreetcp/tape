/**
 * "Ask about this company" — sends a question plus a compact, freshly-gathered
 * context pack (profile, valuation/margins/growth, analyst view, recent news) to
 * Google's Gemini API and returns a grounded answer. Needs a free key in
 * GEMINI_API_KEY (https://aistudio.google.com/app/apikey); without it the route
 * reports unconfigured and the UI explains how to add one.
 */
import { loadCompanyBundle } from "./companyCache";
import { getNews } from "./news";
import { type FinPeriod } from "./financials";
import { chatText, NO_ADVICE } from "./llm";
import { recordUsage } from "./llmUsage";
import { deadline, isDeadline } from "./deadline";

const KEY = process.env.GEMINI_API_KEY;
// gemini-3.1-pro-preview — sharpest model in the bake-off (more sources, segment-level
// detail) with reasoning enabled (thinkingConfig below). Needs a billed API key; the
// Google Search grounding is free for the first 5,000 queries/month (then $14/1K), so
// at our volume the search — the dominant cost — is effectively free. It's a PREVIEW
// model: roll back instantly with GEMINI_MODEL=gemini-2.5-pro if it changes/rate-limits.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-pro-preview";
// The rescue model when the primary times out or Google is overloaded: still search-grounded,
// reliably answers in single-digit seconds with thinking off. A flash answer beats a red error.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash";

// Per-attempt deadlines. Their SUM (plus gatherContext) must stay inside the 60s the four caller
// routes advertise via maxDuration: on Vercel a function killed at 60s answers with a raw 5xx —
// which the client renders as JSON-parse gibberish, strictly worse than a degraded answer.
// Env-tunable so a live box can be adjusted (and the rescue path exercised) without a deploy.
const PRIMARY_MS = Number(process.env.ASK_PRIMARY_TIMEOUT_MS) || 40_000;
const RESCUE_MS = Number(process.env.ASK_RESCUE_TIMEOUT_MS) || 15_000;

export const askConfigured = () => !!KEY;

const big = (v: number | null) =>
  v == null ? "n/a" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const r1 = (v: number | null) => (v == null ? "n/a" : v.toFixed(1));

export async function gatherContext(symbol: string, name = ""): Promise<{ name: string; text: string }> {
  // stats/profile/financials from the baked per-stock cache (local on a hit); only news stays live.
  const [bundle, news] = await Promise.all([
    loadCompanyBundle(symbol),
    getNews(name || symbol, 8).catch(() => []),
  ]);
  const { stats, profile, financials: fin } = bundle;
  const display = name || symbol;
  let text = `Company: ${display} (${symbol})\n`;
  if (profile) {
    text += `Sector: ${profile.sector ?? "n/a"}; Industry: ${profile.industry ?? "n/a"}; Employees: ${profile.employees ?? "n/a"}; HQ: ${profile.location ?? "n/a"}.\n`;
    if (profile.description) text += `Business: ${profile.description.slice(0, 1400)}\n`;
    if (profile.officers?.length) text += `Key execs: ${profile.officers.slice(0, 5).map((o) => `${o.name} (${o.title})`).join("; ")}.\n`;
  }
  if (stats) {
    text += `Price ${stats.price == null ? "n/a" : "$" + stats.price.toFixed(2)}. Market cap ${big(stats.marketCap)}, EV ${big(stats.enterpriseValue)}. `;
    text += `Valuation: trailing P/E ${r1(stats.trailingPE)}, fwd P/E ${r1(stats.forwardPE)}, P/S ${r1(stats.priceToSales)}, EV/EBITDA ${r1(stats.evToEbitda)}, PEG ${r1(stats.pegRatio)}, beta ${r1(stats.beta)}.\n`;
    text += `Margins: gross ${pct(stats.grossMargins)}, operating ${pct(stats.operatingMargins)}, net ${pct(stats.profitMargins)}. ROE ${pct(stats.returnOnEquity)}, ROA ${pct(stats.returnOnAssets)}. `;
    text += `Growth (YoY): revenue ${pct(stats.revenueGrowth)}, earnings ${pct(stats.earningsGrowth)}. Debt/equity ${r1(stats.debtToEquity)}, FCF ${big(stats.freeCashflow)}, dividend yield ${pct(stats.dividendYield)}.\n`;
    text += `Analysts: consensus ${stats.recommendationKey ?? "n/a"} (${stats.numAnalysts ?? "?"} analysts), mean target ${stats.targetMean == null ? "n/a" : "$" + stats.targetMean.toFixed(0)} (range ${stats.targetLow == null ? "?" : "$" + stats.targetLow.toFixed(0)}–${stats.targetHigh == null ? "?" : "$" + stats.targetHigh.toFixed(0)}). Fwd EPS ${stats.forwardEps == null ? "n/a" : "$" + stats.forwardEps.toFixed(2)}.\n`;
    if (stats.surprises?.length) {
      const s = stats.surprises[stats.surprises.length - 1];
      text += `Latest EPS surprise: ${s.surprisePercent == null ? "n/a" : (s.surprisePercent * 100).toFixed(1) + "%"} (${s.quarter}).\n`;
    }
  }
  if (fin?.annual?.length) {
    const recent = fin.annual.slice(-4);
    const fnum = (p: FinPeriod, ks: string[]) => {
      for (const k of ks) { const v = p[k]; if (typeof v === "number") return v; }
      return null;
    };
    const series = (label: string, ks: string[], fmt: (v: number) => string) => {
      const xs = recent.map((p) => { const v = fnum(p, ks); return v == null ? null : `FY${p.date.slice(2, 4)} ${fmt(v)}`; }).filter(Boolean);
      return xs.length ? `${label}: ${xs.join(" → ")}.` : "";
    };
    const lines = [
      series("Revenue", ["totalRevenue"], big),
      series("Operating income", ["operatingIncome"], big),
      series("Net income", ["netIncome", "netIncomeCommonStockholders"], big),
      series("Free cash flow", ["freeCashFlow"], big),
      series("Diluted EPS", ["dilutedEPS"], (v) => `$${v.toFixed(2)}`),
    ].filter(Boolean);
    if (lines.length) text += `Annual financial trend (oldest→newest):\n${lines.join("\n")}\n`;
  }
  if (news.length) text += `Recent news headlines:\n${news.map((n) => `- ${n.title} (${n.publisher})`).join("\n")}\n`;
  return { name: display, text };
}

/** A compact reported-financials block (valuation, margins, growth, and the multi-year
 *  income-statement / cash-flow trend) from our structured market data — handy to pair
 *  with a filing's narrative when the filing's own financial-statement tables aren't in
 *  the extracted text. Returns "" if nothing useful is available. */
export async function financialSnapshot(symbol: string): Promise<string> {
  const { stats, financials: fin } = await loadCompanyBundle(symbol);
  let text = "";
  if (stats) {
    text += `Market cap ${big(stats.marketCap)}, EV ${big(stats.enterpriseValue)}. `;
    text += `Valuation: trailing P/E ${r1(stats.trailingPE)}, fwd P/E ${r1(stats.forwardPE)}, P/S ${r1(stats.priceToSales)}, EV/EBITDA ${r1(stats.evToEbitda)}.\n`;
    text += `Margins: gross ${pct(stats.grossMargins)}, operating ${pct(stats.operatingMargins)}, net ${pct(stats.profitMargins)}. ROE ${pct(stats.returnOnEquity)}. `;
    text += `Growth (YoY): revenue ${pct(stats.revenueGrowth)}, earnings ${pct(stats.earningsGrowth)}. Net debt/EBITDA proxy: debt/equity ${r1(stats.debtToEquity)}, FCF ${big(stats.freeCashflow)}.\n`;
    if (stats.surprises?.length) {
      const s = stats.surprises[stats.surprises.length - 1];
      text += `Latest EPS surprise: ${s.surprisePercent == null ? "n/a" : (s.surprisePercent * 100).toFixed(1) + "%"} (${s.quarter}).\n`;
    }
  }
  if (fin?.annual?.length) {
    const recent = fin.annual.slice(-5);
    const fnum = (p: FinPeriod, ks: string[]) => {
      for (const k of ks) { const v = p[k]; if (typeof v === "number") return v; }
      return null;
    };
    const series = (label: string, ks: string[], fmt: (v: number) => string) => {
      const xs = recent.map((p) => { const v = fnum(p, ks); return v == null ? null : `FY${p.date.slice(2, 4)} ${fmt(v)}`; }).filter(Boolean);
      return xs.length ? `${label}: ${xs.join(" → ")}.` : "";
    };
    const lines = [
      series("Revenue", ["totalRevenue"], big),
      series("Operating income", ["operatingIncome"], big),
      series("Net income", ["netIncome", "netIncomeCommonStockholders"], big),
      series("Free cash flow", ["freeCashFlow"], big),
      series("Diluted EPS", ["dilutedEPS"], (v) => `$${v.toFixed(2)}`),
    ].filter(Boolean);
    if (lines.length) text += `Annual trend (oldest→newest):\n${lines.join("\n")}\n`;
  }
  return text;
}

export interface AskSource { title: string; uri: string }
export interface AskResult { answer: string; sources: AskSource[] }

// ── Concurrency hardening ────────────────────────────────────────────────────────────────────────
// In-flight COALESCING: identical concurrent asks — two viewers hitting the same company/deal at once,
// or a double-click / double component-mount — share ONE upstream call instead of racing two. That race
// was the "it didn't populate, needed a second click when you both hit it" report: two 40s search-
// grounded calls competing on the same key, one 429-ing or having its result discarded. The map is keyed
// by the full request identity and cleared when the call settles, so a later identical ask (or a retry
// after an error) still runs fresh — this dedups CONCURRENT duplicates only, it never caches an answer.
const inflight = new Map<string, Promise<AskResult | null>>();
function askKey(model: string, question: string, ctxText: string, history: { q: string; a: string }[]): string {
  const s = `${model} ${question} ${ctxText} ${history.map((h) => h.q + "" + h.a).join("")}`;
  let hash = 0; // cheap 32-bit rolling hash — only needs to be stable and collide solely for identical requests
  for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0;
  return `${model}:${question.length}:${ctxText.length}:${hash >>> 0}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function askGemini(
  question: string,
  ctx: { name: string; text: string },
  history: { q: string; a: string }[] = [],
  opts: { model?: string } = {},
): Promise<AskResult | null> {
  if (!KEY) return null;
  const key = askKey(opts.model || MODEL, question, ctx.text, history);
  const existing = inflight.get(key);
  if (existing) return existing; // coalesce onto the identical call already in flight
  const run = askGeminiInner(question, ctx, history, opts).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function askGeminiInner(
  question: string,
  ctx: { name: string; text: string },
  history: { q: string; a: string }[] = [],
  opts: { model?: string } = {},
): Promise<AskResult | null> {
  if (!KEY) return null;
  const system =
    `You are a sharp, helpful equity-research analyst answering questions about ${ctx.name}. ` +
    `Use the DATA below for the company's fundamentals (cite specific numbers), AND use Google Search for whatever the question needs. That includes CURRENT info (recent news, this week's developments, latest analyst sentiment) but EQUALLY past events when the question is about a prior period — e.g. "why was the stock down in February", "what happened last quarter", "what drove the move in March": search for the stock's move in that period and what caused it (the earnings reaction, a guidance change, a downgrade, a deal, a macro event), and explain it. ` +
    `Mind earnings TIMING when attributing a move: companies report either before the open or after the close, and results released AFTER the close don't drive that day's regular-session move — a stock that fell during the session and then beat after the close did NOT "sell the news" that day (the drop pre-dated the print; the earnings reaction is after-hours and the next session). Separate the pre-report session move (macro/sector/positioning) from the earnings reaction. ` +
    `You HAVE web search — so NEVER reply that you "don't have that data", that it's "outside the provided data", or that you can't see historical prices: search for it and reason from what you find. ` +
    `Lead with the direct answer, then back it with specifics — a focused paragraph or two, going deeper only when the question genuinely warrants it. Be analytical and concrete (numbers, drivers, comparisons), not generic. Combine the data, the web, and your own knowledge; if one figure is missing, reason around it. ` +
    `This is a multi-turn conversation: treat each new question as a follow-up that may refer to earlier ones. ` +
    `Explain and analyze freely, but don't give a personalized buy/sell/hold recommendation.\n\n` +
    `=== DATA on ${ctx.name} ===\n${ctx.text}\n=== END DATA ===`;
  // Prior Q&A as conversation turns so follow-ups have context.
  const contents = [
    ...history.flatMap((h) => [
      { role: "user", parts: [{ text: h.q }] },
      { role: "model", parts: [{ text: h.a }] },
    ]),
    { role: "user", parts: [{ text: question }] },
  ];
  // ⚠ The slowest call in the app BY DESIGN — Google Search grounding plus an unbounded thinking
  // budget — and until now the only thing bounding it was `export const maxDuration = 60` in its four
  // callers, which is a Vercel directive and enforces NOTHING under `next start`. Behind the tunnel
  // the viewer got a 524 at ~100s while this kept running to completion with the answer discarded.
  //
  // One attempt against one deadline turned out to be brittle in the other direction: the preview
  // model under load blew the 50s bound (observed 2026-08-04, INTC "key risks") and the DOMException's
  // own text — "The operation was aborted due to timeout" — travelled through the route's catch into
  // the UI in red. So: a LADDER, in the same degrade-don't-error spirit as feedGuard. Pro with dynamic
  // thinking gets PRIMARY_MS; if it times out or Google is overloaded, flash with thinking off gets
  // RESCUE_MS — it answers search-grounded questions in single-digit seconds, and a flash answer is
  // strictly better than an apology. Only when BOTH fail does the user see an error, and then a
  // human one.
  const attempt = async (model: string, ms: number, thinkingBudget: number): Promise<AskResult | null> => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`, {
      method: "POST",
      signal: deadline(ms),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        // Google Search grounding so the answer reflects current web info, not just
        // the filing context. On the primary, ENABLE dynamic reasoning (thinkingBudget
        // -1) for sharper analysis — thinking shares the output budget, so give it a
        // large maxOutputTokens so the reasoning can't truncate the final answer (the
        // old thinkingBudget:0 disabled reasoning, which is why answers felt shallow).
        // The rescue runs with thinking OFF (0) — speed is the whole point there.
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget } },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const j: any = await res.json();
    const um = j?.usageMetadata;
    if (um) recordUsage(model, um.promptTokenCount || 0, (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0));
    const cand = j?.candidates?.[0];
    const answer = (cand?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
    if (!answer) return null;
    const sources: AskSource[] = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c: any) => c?.web)
      .filter((w: any) => w?.uri)
      .map((w: any) => ({ title: w.title || w.uri, uri: w.uri }))
      .slice(0, 6);
    return { answer, sources };
  };

  // Primary model: the caller can override (the desk-note batch runs the cheap search-grounded flash to
  // keep its per-run bill down; the live per-view Ask leaves it unset → the sharper default). The rescue
  // stays FALLBACK_MODEL either way.
  const primaryModel = opts.model || MODEL;
  let firstErr: any;
  try {
    return await attempt(primaryModel, PRIMARY_MS, -1);
  } catch (e: any) {
    firstErr = e;
    // A pure rate-limit (429) is usually a momentary burst — often the very "you both hit it" case that
    // coalescing can't catch (two DIFFERENT questions, or separate serverless instances). Give the SHARP
    // model one quick second shot after a short jittered backoff before dropping to flash. A real
    // quota/config error 429s again fast and falls through to the rescue; a deadline or 5xx skips the
    // retry (re-running a slow/broken call just burns the route's 60s budget) and goes straight to it.
    if (/Gemini 429/.test(String(e?.message || e))) {
      await sleep(700 + Math.floor(Math.random() * 500));
      try { return await attempt(primaryModel, Math.min(PRIMARY_MS, 22_000), -1); }
      catch (eRetry: any) { firstErr = eRetry; }
    }
  }
  // Rescue only what a different/faster model can actually cure: a deadline, a 429, a 5xx. A 400 or 403
  // is OUR configuration (bad key, bad model name) — flash would fail identically, and the retry would
  // bury the one message that says what to fix.
  const cureable = isDeadline(firstErr) || /Gemini (429|5\d\d)/.test(String(firstErr?.message || firstErr));
  if (!cureable) throw firstErr;
  console.warn(`askGemini: ${primaryModel} ${isDeadline(firstErr) ? `timed out at ${PRIMARY_MS}ms` : String(firstErr?.message || firstErr).slice(0, 80)} — rescuing with ${FALLBACK_MODEL}`);
  try {
    return await attempt(FALLBACK_MODEL, RESCUE_MS, 0);
  } catch (e2: any) {
    // Both attempts dead. Say so like a person — the raw DOMException text is what the user
    // screenshot showed, and it reads like a stack trace, not an answer.
    if (isDeadline(e2) || /Gemini (429|5\d\d)/.test(String(e2?.message || e2)))
      throw new Error("The AI took too long to answer — Google's models are busy right now. Try again in a moment.");
    throw e2;
  }
}

/** Focused summary of a provided source text (no web grounding) — e.g. an earnings-call
 *  transcript or an SEC filing. Reasoning on; strictly grounded in the supplied text.
 *  `maxChars` bounds how much of the source is sent (filings are long, so they pass a
 *  much larger cap than the ~45k default). */
export async function summarizeText(title: string, instruction: string, text: string, maxChars = 45000): Promise<AskResult | null> {
  // No GEMINI_API_KEY gate — this now runs on lib/llm (OpenRouter/GLM), which
  // resolves its own key from env or .env.local.
  const system =
    `You are a sharp equity-research analyst. Follow the instruction precisely and base everything ` +
    `STRICTLY on the provided source text — do not invent figures or quotes. If the source looks truncated, ` +
    `empty, or unrelated to the request, say so briefly rather than padding with generic commentary. ` +
    `Use clean, concise markdown. ${NO_ADVICE}`;
  const truncated = text.length > maxChars;
  const prompt = `${instruction}\n\n=== SOURCE: ${title} ===\n${text.slice(0, maxChars)}${truncated ? "\n\n[SOURCE TRUNCATED — text continues beyond this point]" : ""}`;
  const answer = await chatText(system, prompt, { maxTokens: 8192 });
  return answer ? { answer, sources: [] } : null;
}
