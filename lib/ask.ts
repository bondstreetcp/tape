/**
 * "Ask about this company" — sends a question plus a compact, freshly-gathered
 * context pack (profile, valuation/margins/growth, analyst view, recent news) to
 * Google's Gemini API and returns a grounded answer. Needs a free key in
 * GEMINI_API_KEY (https://aistudio.google.com/app/apikey); without it the route
 * reports unconfigured and the UI explains how to add one.
 */
import { getCompanyStats } from "./companyStats";
import { getCompanyProfile } from "./companyProfile";
import { getNews } from "./news";
import { getFinancials, type FinPeriod } from "./financials";

const KEY = process.env.GEMINI_API_KEY;
// gemini-2.5-pro — the most capable model, with reasoning enabled (thinkingConfig
// below). Needs a billed API key (free tier returns HTTP 429 for pro); the user has
// prepay billing set up. Override with GEMINI_MODEL=gemini-2.5-flash if ever needed.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";

export const askConfigured = () => !!KEY;

const big = (v: number | null) =>
  v == null ? "n/a" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const r1 = (v: number | null) => (v == null ? "n/a" : v.toFixed(1));

export async function gatherContext(symbol: string, name = ""): Promise<{ name: string; text: string }> {
  const [stats, profile, news, fin] = await Promise.all([
    getCompanyStats(symbol).catch(() => null),
    getCompanyProfile(symbol).catch(() => null),
    getNews(name || symbol, 8).catch(() => []),
    getFinancials(symbol).catch(() => ({ annual: [] as FinPeriod[], quarterly: [] as FinPeriod[] })),
  ]);
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
  const [stats, fin] = await Promise.all([
    getCompanyStats(symbol).catch(() => null),
    getFinancials(symbol).catch(() => ({ annual: [] as FinPeriod[], quarterly: [] as FinPeriod[] })),
  ]);
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

export async function askGemini(
  question: string,
  ctx: { name: string; text: string },
  history: { q: string; a: string }[] = [],
): Promise<AskResult | null> {
  if (!KEY) return null;
  const system =
    `You are a sharp, helpful equity-research analyst answering questions about ${ctx.name}. ` +
    `Use the DATA below for the company's fundamentals (cite specific numbers), AND search the web for current information — recent news, this week's developments, latest analyst sentiment, current events — so answers are up to date, not limited to filings. ` +
    `Lead with the direct answer, then back it with specifics — a focused paragraph or two, going deeper only when the question genuinely warrants it. Be analytical and concrete (numbers, drivers, comparisons), not generic. Do NOT just say you need more data — combine the data, the web, and your own knowledge; if one figure is missing, reason around it. ` +
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
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      // Google Search grounding so the answer reflects current web info, not just
      // the filing context. ENABLE dynamic reasoning (thinkingBudget -1) for sharper
      // analysis — thinking shares the output budget, so give it a large
      // maxOutputTokens so the reasoning can't truncate the final answer (the old
      // thinkingBudget:0 disabled reasoning, which is why answers felt shallow).
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: -1 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j: any = await res.json();
  const cand = j?.candidates?.[0];
  const answer = (cand?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
  if (!answer) return null;
  const sources: AskSource[] = (cand?.groundingMetadata?.groundingChunks || [])
    .map((c: any) => c?.web)
    .filter((w: any) => w?.uri)
    .map((w: any) => ({ title: w.title || w.uri, uri: w.uri }))
    .slice(0, 6);
  return { answer, sources };
}

/** Focused summary of a provided source text (no web grounding) — e.g. an earnings-call
 *  transcript or an SEC filing. Reasoning on; strictly grounded in the supplied text.
 *  `maxChars` bounds how much of the source is sent (filings are long, so they pass a
 *  much larger cap than the ~45k default). */
export async function summarizeText(title: string, instruction: string, text: string, maxChars = 45000): Promise<AskResult | null> {
  if (!KEY) return null;
  const system =
    `You are a sharp equity-research analyst. Follow the instruction precisely and base everything ` +
    `STRICTLY on the provided source text — do not invent figures or quotes. Use clean, concise markdown.`;
  const prompt = `${instruction}\n\n=== SOURCE: ${title} ===\n${text.slice(0, maxChars)}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: -1 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j: any = await res.json();
  const answer = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
  return answer ? { answer, sources: [] } : null;
}
