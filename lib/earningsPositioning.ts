/**
 * "What are the options positioned for?" — a plain-English AI read of the options setup into an earnings
 * print, built ONLY from the quant already computed for the Earnings tab (lib/earningsQuant.ts). It
 * translates the jargon (priced move, rich/cheap premium, skew, max-pain/walls, historical hit rate) into
 * what the options market is positioned for and what that suggests about the likely outcome/risk — with
 * the standing caveat that positioning is hedging + flow, not a forecast. Served by ?part=posread.
 *
 * All figures arrive in DISPLAY units (percent / vol-points), resolved by the route from computeQuant, so
 * there is no unit ambiguity here.
 */
import { chatJSON, NO_ADVICE } from "./llm";
import { narrative, narrativeList } from "./llmValidate";

export interface PositioningFacts {
  company: string;
  impliedMovePct: number | null;
  eventMovePct: number | null;
  dte: number | null;
  richnessVerdict: string | null; // rich | cheap | fair
  richnessRatio: number | null; // implied ÷ realized
  richnessAvgRealizedPct: number | null;
  skewVolPts: number | null; // signed; + = puts bid (downside hedging), − = calls bid
  maxPainVsSpotPct: number | null; // signed %
  callWall: number | null;
  putWall: number | null;
  atmIVpct: number | null;
  ivHvRatio: number | null;
  straddleExceeded: number | null;
  straddleTotal: number | null;
  longPremiumVerdict: string | null; // favorable | neutral | unfavorable
  termBackwardated: boolean | null;
  pastAvgAbsMovePct: number | null;
  pastUpRate: number | null; // fraction 0..1
  pastN: number | null;
}

export interface PositioningRead {
  tldr: string;
  lean: "bullish" | "bearish" | "two-sided" | "neutral";
  points: string[];
  caveat: string;
}

const f1 = (n: number | null | undefined) => (n == null ? null : n.toFixed(1));

/** Assemble the human-readable fact sheet the model reasons over — omit anything we don't have. */
function factSheet(f: PositioningFacts): string {
  const L: (string | false | null)[] = [
    f.impliedMovePct != null &&
      `Priced move: the options imply ±${f1(f.impliedMovePct)}% by expiry${f.dte != null ? ` (${f.dte}d out)` : ""}${f.eventMovePct != null ? `; the isolated earnings-event move is ±${f1(f.eventMovePct)}%` : ""}.`,
    f.richnessVerdict &&
      `Rich/cheap: premium screens ${f.richnessVerdict.toUpperCase()}${f.richnessRatio != null ? ` — implied is ${f.richnessRatio.toFixed(2)}× the ${f.richnessAvgRealizedPct != null ? `~${f1(f.richnessAvgRealizedPct)}% ` : ""}it has actually moved on recent prints` : ""}.`,
    f.skewVolPts != null &&
      `Skew: ATM ${f.skewVolPts > 0 ? "puts bid" : "calls bid"} by ${Math.abs(f.skewVolPts).toFixed(1)} vol pts (${f.skewVolPts > 0 ? "downside-hedging / protective demand" : "upside-call demand"}).`,
    f.maxPainVsSpotPct != null &&
      `Max pain: ${f.maxPainVsSpotPct >= 0 ? "+" : ""}${f1(f.maxPainVsSpotPct)}% vs spot${f.putWall != null || f.callWall != null ? `; open-interest walls at ${f.putWall != null ? `put $${f.putWall.toFixed(0)}` : ""}${f.putWall != null && f.callWall != null ? " / " : ""}${f.callWall != null ? `call $${f.callWall.toFixed(0)}` : ""}` : ""}.`,
    f.atmIVpct != null &&
      `Vol: ATM IV ${f.atmIVpct.toFixed(0)}%${f.ivHvRatio != null ? `, ${f.ivHvRatio.toFixed(1)}× realized (HV20)` : ""}.`,
    f.termBackwardated != null &&
      `Term structure: ${f.termBackwardated ? "backwardated — a clear discrete event premium in the front expiry" : "not backwardated — little standalone event premium"}.`,
    f.straddleTotal != null && f.straddleTotal > 0 &&
      `History: the actual move EXCEEDED the priced straddle ${f.straddleExceeded}/${f.straddleTotal} of the last prints.`,
    f.longPremiumVerdict &&
      `A long-premium (buy-the-straddle) trade screens ${f.longPremiumVerdict.toUpperCase()} here.`,
    f.pastAvgAbsMovePct != null &&
      `Recent prints moved ±${f1(f.pastAvgAbsMovePct)}% on average${f.pastUpRate != null ? `, closing up ${Math.round(f.pastUpRate * 100)}% of the time` : ""}${f.pastN ? ` (last ${f.pastN})` : ""}.`,
  ];
  return L.filter(Boolean).join("\n");
}

export async function buildPositioningRead(f: PositioningFacts): Promise<PositioningRead | null> {
  const sheet = factSheet(f);
  if (sheet.split("\n").length < 2) return null; // too little to say anything honest

  const SYSTEM =
    "You are an options strategist explaining an earnings setup to a smart generalist investor in PLAIN ENGLISH. " +
    "Using ONLY the options-positioning facts provided — never invent numbers, a direction the facts don't support, or a fundamental catalyst — explain what the options market is POSITIONED for and what that suggests about the likely outcome / risk for THIS print. " +
    "Translate the jargon: what the priced move means in dollars-of-risk terms, whether the market is OVER- or UNDER-paying for the move (rich vs cheap) and what that implies, what the skew says about which side is being hedged or chased, and what max-pain / OI walls imply about pinning or magnets. " +
    "Be concrete and balanced; if the signals conflict, say so. Positioning reflects hedging and flow, NOT a prediction — and you must not tell the reader what to trade. " +
    NO_ADVICE;
  const SCHEMA =
    'Return ONLY JSON: {"tldr":string (ONE sentence — what the options are positioned for),' +
    '"lean":"bullish"|"bearish"|"two-sided"|"neutral" (the directional TILT the positioning leans; use "two-sided" when a large move is priced with no clear direction, "neutral" when the setup is unremarkable),' +
    '"points":string[] (2-4 short plain-English sentences translating the setup — no bullet symbols),' +
    '"caveat":string (ONE sentence reminding that positioning is hedging/flow, not a forecast)}';

  const out = await chatJSON<{ tldr?: string; lean?: string; points?: unknown; caveat?: string }>(
    SYSTEM,
    `Company: ${f.company}\n\nOPTIONS POSITIONING FACTS:\n${sheet}\n\n${SCHEMA}`,
    { maxTokens: 700, reasoningEffort: "low" },
  );
  // narrative(): a "…" shell in the tldr or the points is no read at all (lib/llmValidate)
  const tldr = narrative(out?.tldr, 320);
  if (!out || !tldr || !Array.isArray(out.points)) return null;
  const lean = ["bullish", "bearish", "two-sided", "neutral"].includes(String(out.lean)) ? (out.lean as PositioningRead["lean"]) : "neutral";
  const points = narrativeList(out.points, 4, 280);
  if (!points.length) return null;
  return {
    tldr,
    lean,
    points,
    caveat: narrative(out.caveat, 260) || "Options positioning reflects hedging and flow, not a forecast of the result.",
  };
}
