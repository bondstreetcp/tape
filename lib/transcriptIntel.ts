/**
 * Transcript intelligence (Sentieo/AlphaSense-style): tracks how often
 * management mentions given themes across recent earnings calls, and scores the
 * tone of each call with a finance-specific sentiment lexicon (general-purpose
 * lexicons mislabel words like "liability" or "cost" — this is Loughran-McDonald
 * inspired, the standard for 10-K/earnings text).
 */
import { getRecentTranscripts, type FullTranscript } from "./transcripts";

// Finance-positive / -negative tone words. "risk/uncertain/may/could" are kept
// OUT of negative (they're boilerplate safe-harbor language) and tracked
// separately as hedging/uncertainty.
const POSITIVE = new Set(
  ("able accelerate accelerated accelerating accomplish achieve achieved achievement advance advantage attractive benefit best better boost breakthrough bullish compelling confident confidence deliver delivered delivering durable efficient efficiency encouraged exceed exceeded exceeding exceptional excited excellent expand expanded expanding expansion favorable gain gains good great grow growing growth healthy improve improved improvement improving increase increased increasing innovate innovation innovative lead leader leadership leading momentum opportunity opportunities optimistic outperform outperformed outstanding pleased positive profitable profitability progress proud record records resilient robust solid strong stronger strength strengthen strengthened succeed success successful surpass terrific tremendous traction upside win winning")
    .split(" "),
);
const NEGATIVE = new Set(
  ("adverse adversely challenge challenged challenges challenging concern concerned concerns decline declined declines declining decrease decreased decreasing deficit deteriorate deteriorated deterioration difficult difficulty disappoint disappointed disappointing disappointment disrupt disrupted disruption downturn drag fail failed failure headwind headwinds hurt impair impaired impairment litigation lawsuit loss losses negative pressure pressured pressures recall recession restructuring shortfall slow slowdown slower slowing soft softer softening softness struggle struggled underperform underperformed unfavorable volatile volatility weak weakness weaker worse worsen worsening writedown miss missed cautious caution decelerate decelerated decelerating")
    .split(" "),
);
const UNCERTAINTY = new Set(
  ("approximately assume assumed assumption believe contingent could depend depends depending estimate expect fluctuate fluctuation may maybe might possible possibly potential potentially predict probable risk risks risky uncertain uncertainty uncertainties likely unlikely anticipate perhaps indefinite tentative")
    .split(" "),
);

export const DEFAULT_KEYWORDS = ["AI", "demand", "pricing", "margins", "China", "tariff", "guidance", "macro"];

export interface CallPoint {
  date: string | null;
  quarter: string;
  url: string;
  words: number;
  keyword: Record<string, number>;
  pos: number;
  neg: number;
  unc: number;
  tone: number; // (pos - neg) / (pos + neg), −1..1
}

export interface TranscriptIntel {
  available: boolean;
  symbol: string;
  keywords: string[];
  calls: CallPoint[]; // oldest → newest
  note?: string;
}

function quarterLabel(t: FullTranscript): string {
  const m = t.title.match(/Q[1-4]\s*'?\s*\d{2,4}|Q[1-4]\s+\d{4}|(?:first|second|third|fourth)\s+quarter\s+\d{4}/i);
  if (m) return m[0].replace(/\s+/g, " ");
  return t.date ? t.date.slice(0, 7) : "—";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function analyzeOne(t: FullTranscript, keywords: string[]): CallPoint {
  const lower = t.text.toLowerCase();
  const words = lower.match(/[a-z][a-z'-]*/g) || [];
  let pos = 0, neg = 0, unc = 0;
  for (const w of words) {
    if (POSITIVE.has(w)) pos++;
    else if (NEGATIVE.has(w)) neg++;
    if (UNCERTAINTY.has(w)) unc++;
  }
  const keyword: Record<string, number> = {};
  for (const kw of keywords) {
    const re = new RegExp(`\\b${esc(kw.toLowerCase())}\\b`, "g");
    keyword[kw] = (lower.match(re) || []).length;
  }
  return {
    date: t.date,
    quarter: quarterLabel(t),
    url: t.url,
    words: words.length,
    keyword,
    pos,
    neg,
    unc,
    tone: pos + neg ? (pos - neg) / (pos + neg) : 0,
  };
}

export async function getTranscriptIntel(symbol: string, name = "", keywords = DEFAULT_KEYWORDS, n = 6): Promise<TranscriptIntel> {
  const kws = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 10);
  try {
    const transcripts = await getRecentTranscripts(symbol, name, n);
    if (transcripts.length < 2)
      return { available: false, symbol, keywords: kws, calls: [], note: "Need at least two recent earnings-call transcripts to chart a trend." };
    const calls = transcripts.map((t) => analyzeOne(t, kws)).reverse(); // oldest → newest
    return { available: true, symbol, keywords: kws, calls };
  } catch {
    return { available: false, symbol, keywords: kws, calls: [], note: "Couldn't load recent transcripts." };
  }
}
