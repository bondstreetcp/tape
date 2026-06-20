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
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

export async function askGemini(question: string, ctx: { name: string; text: string }): Promise<string | null> {
  if (!KEY) return null;
  const prompt =
    `You are a sharp, helpful equity-research analyst. Give a direct, substantive answer to the user's question about ${ctx.name}. ` +
    `Ground every quantitative claim in the DATA below and cite the specific numbers. You may also draw on your general knowledge of the company, its products, its industry, and how financial metrics work to add useful interpretation and context. ` +
    `Write 3–6 sentences. Do NOT just say you need more data — work with what's provided plus your own knowledge and give your best analytical answer; if one specific figure is missing, reason around it and answer the spirit of the question. ` +
    `Explain and analyze freely, but don't give a personalized buy/sell/hold recommendation.\n\n` +
    `=== DATA on ${ctx.name} ===\n${ctx.text}\n=== END DATA ===\n\nQUESTION: ${question}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // gemini-2.5-flash "thinks" by default and that thinking eats the output
      // budget (answers got truncated mid-sentence). Disable it and give the
      // answer real room so responses are complete.
      generationConfig: { temperature: 0.4, maxOutputTokens: 900, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j: any = await res.json();
  return j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
}
