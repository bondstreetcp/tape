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

const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export const askConfigured = () => !!KEY;

const big = (v: number | null) =>
  v == null ? "n/a" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const r1 = (v: number | null) => (v == null ? "n/a" : v.toFixed(1));

export async function gatherContext(symbol: string, name = ""): Promise<{ name: string; text: string }> {
  const [stats, profile, news] = await Promise.all([
    getCompanyStats(symbol).catch(() => null),
    getCompanyProfile(symbol).catch(() => null),
    getNews(name || symbol, 8).catch(() => []),
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
  if (news.length) text += `Recent news headlines:\n${news.map((n) => `- ${n.title} (${n.publisher})`).join("\n")}\n`;
  return { name: display, text };
}

export async function askGemini(question: string, ctx: { name: string; text: string }): Promise<string | null> {
  if (!KEY) return null;
  const prompt =
    `You are a precise equity-research assistant. Answer the user's question about ${ctx.name} using ONLY the context below. ` +
    `Be concise (2–5 sentences), specific, and cite the relevant numbers. If the context doesn't contain the answer, say so and note what data would be needed. ` +
    `Do not give personalized investment advice or a buy/sell recommendation.\n\n` +
    `=== CONTEXT ===\n${ctx.text}\n=== END CONTEXT ===\n\nQUESTION: ${question}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j: any = await res.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}
